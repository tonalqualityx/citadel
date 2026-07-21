import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockCalendarEventFindMany = prisma.calendarEvent.findMany as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;

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

  it('week meeting_minutes sums real per-event duration + the 15-minute recovery buffer', async () => {
    mockCalendarEventFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      // A single 60-minute meeting on 2026-07-22: 60 real minutes + 15min buffer = 75.
      { starts_at: new Date('2026-07-22T13:00:00.000Z'), ends_at: new Date('2026-07-22T14:00:00.000Z'), all_day: false },
    ]);
    mockTaskFindMany.mockResolvedValueOnce([]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    const day22 = body.week.find((d: { date: string }) => d.date === '2026-07-22');
    expect(day22.meeting_minutes).toBe(75);
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
