import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    calendarEvent: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    userPreference: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockCalendarEventFindMany = prisma.calendarEvent.findMany as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockUserPreferenceFindUnique = prisma.userPreference.findUnique as Mock;

function createGetRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/today/calendar?${searchParams.toString()}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockCalendarEventFindMany.mockResolvedValue([]);
  mockTaskFindMany.mockResolvedValue([]);
  // Clarity Phase 3d — resolveUserTimezone falls back to DEFAULT_DISPLAY_TIMEZONE
  // (America/New_York) when there's no stored preference, same as an un-mocked real DB row.
  mockUserPreferenceFindUnique.mockResolvedValue(null);
});

describe('GET /api/today/calendar', () => {
  it('returns the day timed events with their REAL start/end (no assumed duration)', async () => {
    mockCalendarEventFindMany
      .mockResolvedValueOnce([
        {
          event_id: 'm1',
          title: 'Chris — call',
          starts_at: new Date('2026-07-21T13:00:00.000Z'),
          ends_at: new Date('2026-07-21T21:05:00.000Z'), // real 8hr05m duration, NOT 30min
          all_day: false,
        },
      ])
      .mockResolvedValueOnce([
        { starts_at: new Date('2026-07-21T13:00:00.000Z'), ends_at: new Date('2026-07-21T21:05:00.000Z'), all_day: false },
      ]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.date).toBe('2026-07-21');
    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0].title).toBe('Chris — call');
    expect(body.meetings[0].id).toBe('m1');
    const durationMs =
      new Date(body.meetings[0].end).getTime() - new Date(body.meetings[0].start).getTime();
    expect(durationMs).toBe(8 * 60 * 60_000 + 5 * 60_000); // real 8h05m, proves no 30min assumption
  });

  it('excludes all-day events from meetings[] and returns them in allDay[]', async () => {
    mockCalendarEventFindMany
      .mockResolvedValueOnce([
        {
          event_id: 'allday-1',
          title: 'Home',
          starts_at: new Date('2026-07-21T00:00:00.000Z'),
          ends_at: new Date('2026-07-22T00:00:00.000Z'),
          all_day: true,
        },
        {
          event_id: 'm1',
          title: 'Standup',
          starts_at: new Date('2026-07-21T13:00:00.000Z'),
          ends_at: new Date('2026-07-21T13:30:00.000Z'),
          all_day: false,
        },
      ])
      .mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0].id).toBe('m1');
    expect(body.allDay).toHaveLength(1);
    expect(body.allDay[0].id).toBe('allday-1');
    expect(body.allDay[0].title).toBe('Home');
  });

  it('returns a 5-day week strip starting at the requested date, as raw counts (no encoding)', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    expect(body.week).toHaveLength(5);
    expect(body.week[0].date).toBe('2026-07-21');
    expect(body.week[4].date).toBe('2026-07-25');
    for (const day of body.week) {
      expect(day).toHaveProperty('meeting_minutes');
      expect(day).toHaveProperty('meetings_count');
      expect(day).toHaveProperty('due_tasks_count');
      expect(day).not.toHaveProperty('packed');
      expect(day).not.toHaveProperty('fill_percent');
    }
  });

  it('defaults to today when no date param is given', async () => {
    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.timezone).toBe('America/New_York'); // resolveUserTimezone's fallback
  });

  it('counts due tasks per day within the week window', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([
      { due_date: new Date('2026-07-22T12:00:00.000Z') },
      { due_date: new Date('2026-07-22T18:00:00.000Z') },
    ]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    const day22 = body.week.find((d: { date: string }) => d.date === '2026-07-22');
    expect(day22.due_tasks_count).toBe(2);
  });

  it('week meeting_minutes sums real per-event duration + the 20-minute prep + the 15-minute recovery buffer', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      // Clarity Phase 5 — a single 60-minute meeting, isolated (well clear of its own
      // day's start), on 2026-07-22: 20min prep + 60 real minutes + 15min buffer = 95.
      { starts_at: new Date('2026-07-22T13:00:00.000Z'), ends_at: new Date('2026-07-22T14:00:00.000Z'), all_day: false },
    ]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    const day22 = body.week.find((d: { date: string }) => d.date === '2026-07-22');
    expect(day22.meeting_minutes).toBe(95);
    expect(day22.meetings_count).toBe(1);
  });

  it('excludes all-day events from meetings_count and meeting_minutes in the week strip', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { starts_at: new Date('2026-07-22T00:00:00.000Z'), ends_at: new Date('2026-07-23T00:00:00.000Z'), all_day: true },
    ]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    const day22 = body.week.find((d: { date: string }) => d.date === '2026-07-22');
    expect(day22.meetings_count).toBe(0);
    expect(day22.meeting_minutes).toBe(0);
  });
});

// Clarity Phase 5 — the Soothsayer requests 7 forward days from this same endpoint via an
// optional `days` param; the Today header's own week strip (5 days) stays the untouched
// default.
describe('GET /api/today/calendar — days param', () => {
  it('defaults to a 5-day week when days is absent (unchanged)', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    expect(body.week).toHaveLength(5);
  });

  it('honors days=7 (the Soothsayer\'s window)', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21', days: '7' }));
    const body = await res.json();

    expect(body.week).toHaveLength(7);
    expect(body.week[0].date).toBe('2026-07-21');
    expect(body.week[6].date).toBe('2026-07-27');
  });

  it('falls back to the default for an out-of-range or non-numeric days value', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);
    const resInvalid = await GET(createGetRequest({ date: '2026-07-21', days: 'not-a-number' }));
    expect((await resInvalid.json()).week).toHaveLength(5);

    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);
    const resTooBig = await GET(createGetRequest({ date: '2026-07-21', days: '999' }));
    expect((await resTooBig.json()).week).toHaveLength(5);
  });
});

// Clarity Phase 3d — the actual bug report: an 8pm-ET event is already "tomorrow" in
// UTC, so a literal-UTC day window either excluded it from "today" entirely or placed
// it at the wrong hour on the time-shape once it WAS included. These tests capture the
// REAL `where` clause values the route passes to calendarEvent.findMany (the earlier
// tests in this file mock the DB layer and never actually inspect those bounds) to
// prove the day window is genuinely ET-correct, not just re-checking the pure utility
// in isolation.
describe('GET /api/today/calendar — per-user timezone day bounds', () => {
  it('the 8pm-ET boundary: America/New_York day bounds for 2026-07-21 span local midnight to local midnight, not UTC midnight to UTC midnight', async () => {
    mockUserPreferenceFindUnique.mockResolvedValue({ timezone: 'America/New_York' });
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    await GET(createGetRequest({ date: '2026-07-21' }));

    const dayWhere = mockCalendarEventFindMany.mock.calls[0][0].where.starts_at as { gte: Date; lte: Date };
    // Midnight EDT on 2026-07-21 = 2026-07-21T04:00:00.000Z; midnight EDT on 2026-07-22
    // minus 1ms = 2026-07-22T03:59:59.999Z. NOT '2026-07-21T00:00:00Z'/'...T23:59:59Z'
    // (the literal-UTC bug), which would exclude an 8pm ET event entirely.
    expect(dayWhere.gte.toISOString()).toBe('2026-07-21T04:00:00.000Z');
    expect(dayWhere.lte.toISOString()).toBe('2026-07-22T03:59:59.999Z');

    // The exact reported scenario: an 8pm ET meeting on 2026-07-21 (= 2026-07-22T00:00:00Z,
    // already "tomorrow" in UTC) must fall INSIDE these bounds.
    const eightPmET = new Date('2026-07-22T00:00:00.000Z');
    expect(eightPmET.getTime()).toBeGreaterThanOrEqual(dayWhere.gte.getTime());
    expect(eightPmET.getTime()).toBeLessThanOrEqual(dayWhere.lte.getTime());
  });

  it('mirror case: Asia/Karachi (UTC+5, no DST) day bounds roll over in the OPPOSITE direction from ET', async () => {
    mockUserPreferenceFindUnique.mockResolvedValue({ timezone: 'Asia/Karachi' });
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    await GET(createGetRequest({ date: '2026-07-21' }));

    const dayWhere = mockCalendarEventFindMany.mock.calls[0][0].where.starts_at as { gte: Date; lte: Date };
    // Midnight PKT on 2026-07-21 = 2026-07-20T19:00:00.000Z; midnight PKT on 2026-07-22
    // minus 1ms = 2026-07-21T18:59:59.999Z.
    expect(dayWhere.gte.toISOString()).toBe('2026-07-20T19:00:00.000Z');
    expect(dayWhere.lte.toISOString()).toBe('2026-07-21T18:59:59.999Z');

    // The ET 8pm-boundary event from the test above (2026-07-22T00:00:00Z) must NOT
    // fall inside Karachi's 2026-07-21 window — proving this isn't just always "add a
    // buffer both ways", it's genuinely per-zone.
    const eightPmET = new Date('2026-07-22T00:00:00.000Z');
    expect(eightPmET.getTime()).toBeGreaterThan(dayWhere.lte.getTime());
  });

  it('resolves a distinct timezone per request based on the requesting user, not a cached/global value', async () => {
    mockCalendarEventFindMany.mockResolvedValue([]);
    mockTaskFindMany.mockResolvedValue([]);

    mockUserPreferenceFindUnique.mockResolvedValueOnce({ timezone: 'America/New_York' });
    const resNY = await GET(createGetRequest({ date: '2026-07-21' }));
    const bodyNY = await resNY.json();
    expect(bodyNY.timezone).toBe('America/New_York');

    mockUserPreferenceFindUnique.mockResolvedValueOnce({ timezone: 'Asia/Karachi' });
    const resKarachi = await GET(createGetRequest({ date: '2026-07-21' }));
    const bodyKarachi = await resKarachi.json();
    expect(bodyKarachi.timezone).toBe('Asia/Karachi');
  });
});
