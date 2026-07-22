import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/services/user-timezone', () => ({
  resolveUserTimezone: vi.fn().mockResolvedValue('America/New_York'),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    todayPick: { findMany: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    arc: { findMany: vi.fn() },
    oracleSession: { findMany: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { resolveUserTimezone } from '@/lib/services/user-timezone';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockResolveUserTimezone = vi.mocked(resolveUserTimezone);
const mockTodayPickFindMany = prisma.todayPick.findMany as Mock;
const mockCalendarEventFindMany = prisma.calendarEvent.findMany as Mock;
const mockArcFindMany = prisma.arc.findMany as Mock;
const mockOracleSessionFindMany = prisma.oracleSession.findMany as Mock;

function getRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/oracle/soothsayer?${searchParams.toString()}`);
}

function arcFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'arc-1',
    name: 'Demo Arc',
    description: null,
    client_id: null,
    client: null,
    project_id: null,
    project: null,
    origin_session_external_id: null,
    closed_at: null,
    snoozed_until: null,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    updated_at: new Date('2026-07-01T00:00:00.000Z'),
    tasks: [{ status: 'not_started' }, { status: 'done' }],
    ...overrides,
  };
}

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    external_id: 'ext-1',
    title: 'A live session',
    status: 'idle',
    remote_url: null,
    goal: null,
    cwd: '/home/mike/project',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'admin-1', role: 'admin', email: 'admin@indelible.agency' });
  mockRequireRole.mockImplementation(() => {});
  // vi.resetAllMocks() wipes the vi.mock() factory's own mockResolvedValue default too —
  // re-set it here every test, not just once at module load.
  mockResolveUserTimezone.mockResolvedValue('America/New_York');
  // Per-day picks: no picks by default (kept simple — the day-column shaping itself is
  // covered by /api/today's own test suite via the SAME shared shapeTodayPicks helper).
  // The picked-ids sweeps (item_type=arc / item_type=session) are distinguished by their
  // where-clause shape, since all three query shapes share this one mocked function.
  mockTodayPickFindMany.mockImplementation((args: { where?: { item_type?: string } }) => {
    if (args?.where?.item_type === 'arc') return Promise.resolve([]);
    if (args?.where?.item_type === 'session') return Promise.resolve([]);
    return Promise.resolve([]);
  });
  mockCalendarEventFindMany.mockResolvedValue([]);
  mockArcFindMany.mockResolvedValue([]);
  mockOracleSessionFindMany.mockResolvedValue([]);
});

describe('GET /api/oracle/soothsayer — auth', () => {
  it('is admin-gated', async () => {
    await GET(getRequest());
    expect(mockRequireRole).toHaveBeenCalledWith(expect.anything(), ['admin']);
  });
});

describe('GET /api/oracle/soothsayer — day columns', () => {
  it('returns exactly 7 days (today + next 6)', async () => {
    const res = await GET(getRequest({ date: '2026-07-22' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.days).toHaveLength(7);
    expect(body.days[0].date).toBe('2026-07-22');
    expect(body.days[6].date).toBe('2026-07-28');
  });

  it('reports the resolved timezone', async () => {
    const res = await GET(getRequest());
    const body = await res.json();
    expect(body.timezone).toBe('America/New_York');
  });
});

describe('GET /api/oracle/soothsayer — no day assigned', () => {
  it('includes an open, un-snoozed arc with no future-or-today pick, with its progress_percent', async () => {
    mockArcFindMany.mockResolvedValue([arcFixture({ id: 'arc-open', tasks: [{ status: 'not_started' }, { status: 'done' }] })]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.unplanned.arcs).toHaveLength(1);
    expect(body.unplanned.arcs[0].id).toBe('arc-open');
    expect(body.unplanned.arcs[0].progress_percent).toBe(50);
  });

  it('excludes an arc that already has a future-or-today pick', async () => {
    mockArcFindMany.mockResolvedValue([arcFixture({ id: 'arc-picked' })]);
    mockTodayPickFindMany.mockImplementation((args: { where?: { item_type?: string } }) => {
      if (args?.where?.item_type === 'arc') return Promise.resolve([{ arc_id: 'arc-picked' }]);
      return Promise.resolve([]);
    });

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.unplanned.arcs).toHaveLength(0);
  });

  it('excludes a snoozed arc (snoozed_until in the future)', async () => {
    mockArcFindMany.mockResolvedValue([
      arcFixture({ id: 'arc-snoozed', snoozed_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.unplanned.arcs).toHaveLength(0);
  });

  it('excludes a complete arc (all tasks terminal)', async () => {
    mockArcFindMany.mockResolvedValue([
      arcFixture({ id: 'arc-done', tasks: [{ status: 'done' }, { status: 'abandoned' }] }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.unplanned.arcs).toHaveLength(0);
  });

  it('includes a live session with no future-or-today pick', async () => {
    mockOracleSessionFindMany.mockResolvedValue([sessionFixture({ external_id: 'ext-live' })]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.unplanned.sessions).toHaveLength(1);
    expect(body.unplanned.sessions[0].external_id).toBe('ext-live');
  });

  it('excludes a live session that already has a future-or-today pick', async () => {
    mockOracleSessionFindMany.mockResolvedValue([sessionFixture({ external_id: 'ext-picked' })]);
    mockTodayPickFindMany.mockImplementation((args: { where?: { item_type?: string } }) => {
      if (args?.where?.item_type === 'session') return Promise.resolve([{ session_external_id: 'ext-picked' }]);
      return Promise.resolve([]);
    });

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.unplanned.sessions).toHaveLength(0);
  });

  it('queries live sessions scoped to not ended/stale, not archived, most-recently-active first', async () => {
    await GET(getRequest());
    expect(mockOracleSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { notIn: ['ended', 'stale'] }, archived_at: null },
        orderBy: { last_event_at: 'desc' },
      })
    );
  });
});

describe('GET /api/oracle/soothsayer — snoozed', () => {
  it('includes an arc with snoozed_until in the future', async () => {
    mockArcFindMany.mockResolvedValue([
      arcFixture({ id: 'arc-snoozed', snoozed_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.snoozed.arcs).toHaveLength(1);
    expect(body.snoozed.arcs[0].id).toBe('arc-snoozed');
  });

  it('excludes an arc whose snoozed_until has already passed', async () => {
    mockArcFindMany.mockResolvedValue([
      arcFixture({ id: 'arc-expired', snoozed_until: new Date(Date.now() - 60_000) }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.snoozed.arcs).toHaveLength(0);
  });

  it('sorts snoozed arcs oldest-wake-date first', async () => {
    const now = Date.now();
    mockArcFindMany.mockResolvedValue([
      arcFixture({ id: 'wakes-later', snoozed_until: new Date(now + 5 * 24 * 60 * 60 * 1000) }),
      arcFixture({ id: 'wakes-sooner', snoozed_until: new Date(now + 1 * 24 * 60 * 60 * 1000) }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.snoozed.arcs.map((a: { id: string }) => a.id)).toEqual(['wakes-sooner', 'wakes-later']);
  });
});
