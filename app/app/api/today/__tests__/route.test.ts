import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    todayPick: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    oracleSession: {
      findMany: vi.fn(),
    },
    arc: {
      findUnique: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
    charter: {
      findUnique: vi.fn(),
    },
    userPreference: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindMany = prisma.todayPick.findMany as Mock;
const mockCount = prisma.todayPick.count as Mock;
const mockCreate = prisma.todayPick.create as Mock;
const mockSessionFindMany = prisma.oracleSession.findMany as Mock;
const mockArcFindUnique = prisma.arc.findUnique as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockCharterFindUnique = prisma.charter.findUnique as Mock;
const mockUserPreferenceFindUnique = prisma.userPreference.findUnique as Mock;

function createGetRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/today?${searchParams.toString()}`);
}

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/today', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function pick(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pick-1',
    date: new Date('2026-07-21T00:00:00.000Z'),
    item_type: 'arc',
    arc_id: 'arc-1',
    arc: { id: 'arc-1', name: 'BRIC change round', closed_at: null, tasks: [{ status: 'done' }, { status: 'in_progress' }] },
    task_id: null,
    task: null,
    session_external_id: null,
    charter_id: null,
    charter: null,
    label: null,
    sort: 0,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockSessionFindMany.mockResolvedValue([]);
  // Clarity Phase 3d — resolveUserTimezone falls back to DEFAULT_DISPLAY_TIMEZONE
  // (America/New_York) when there's no stored preference, same as an un-mocked real DB row.
  mockUserPreferenceFindUnique.mockResolvedValue(null);
});

describe('GET /api/today', () => {
  it('returns picks joined with arc summary and derived primary action', async () => {
    mockFindMany.mockResolvedValue([pick()]);

    const res = await GET(createGetRequest({ date: '2026-07-21' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.date).toBe('2026-07-21');
    expect(body.timezone).toBe('America/New_York'); // resolveUserTimezone's fallback
    expect(body.picks).toHaveLength(1);
    expect(body.picks[0].arc).toEqual({ id: 'arc-1', name: 'BRIC change round', status: 'open', task_count: 2 });
    expect(body.picks[0].primary_action).toEqual({ kind: 'arc' });
    expect(body.meta.total).toBe(1);
    expect(body.meta.uncompleted).toBe(1);
  });

  it('defaults to today when no date param is given', async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await GET(createGetRequest());
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalled();
  });

  it('derives respond vs resume for session picks based on remote_url', async () => {
    mockFindMany.mockResolvedValue([
      pick({
        id: 'pick-2',
        item_type: 'session',
        arc_id: null,
        arc: null,
        session_external_id: 'sess-1',
      }),
    ]);
    mockSessionFindMany.mockResolvedValue([
      { external_id: 'sess-1', title: 'Clarity build', status: 'running', remote_url: 'https://remote/x', goal: 'Ship Phase 3' },
    ]);

    const res = await GET(createGetRequest());
    const body = await res.json();

    expect(body.picks[0].primary_action).toEqual({ kind: 'respond' });
    expect(body.picks[0].session.remote_url).toBe('https://remote/x');
  });

  it('falls back to resume when the session has no remote_url', async () => {
    mockFindMany.mockResolvedValue([
      pick({ id: 'pick-3', item_type: 'session', arc_id: null, arc: null, session_external_id: 'sess-2' }),
    ]);
    mockSessionFindMany.mockResolvedValue([
      { external_id: 'sess-2', title: 'Old session', status: 'idle', remote_url: null, goal: null },
    ]);

    const res = await GET(createGetRequest());
    const body = await res.json();

    expect(body.picks[0].primary_action).toEqual({ kind: 'resume' });
  });

  it('rejects a non-admin role with 403', async () => {
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });
});

// Clarity Phase 3d — the actual bug report: "today" used to be a plain UTC calendar
// day, so a session picked in the evening ET (already tomorrow in UTC) landed on the
// wrong date. Per-user resolution: the requesting user's own zone decides "today", not
// a global constant — proven with two different users/zones rolling over at different
// real-world instants.
describe('GET/POST /api/today — per-user timezone default-date resolution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the 8pm-ET boundary: at 8:00pm EDT (already midnight UTC, next day), a New York user\'s default date is still the ET day', async () => {
    // 8:00pm EDT on 2026-07-21 = 2026-07-22T00:00:00.000Z.
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    mockUserPreferenceFindUnique.mockResolvedValue({ timezone: 'America/New_York' });
    mockFindMany.mockResolvedValue([]);

    const res = await GET(createGetRequest()); // no date param — must default
    const body = await res.json();

    expect(body.date).toBe('2026-07-21'); // NOT '2026-07-22' (the UTC-day bug)
    expect(body.timezone).toBe('America/New_York');
  });

  it('mirror case: a Asia/Karachi user rolls over EARLIER than UTC, proving resolution is genuinely per-user', async () => {
    // 12:30am PKT on 2026-07-22 = 2026-07-21T19:30:00.000Z (Karachi is UTC+5, no DST) —
    // still afternoon/evening on 2026-07-21 in both UTC and America/New_York, but
    // already 2026-07-22 for a Karachi user.
    vi.setSystemTime(new Date('2026-07-21T19:30:00.000Z'));
    mockUserPreferenceFindUnique.mockResolvedValue({ timezone: 'Asia/Karachi' });
    mockFindMany.mockResolvedValue([]);

    const res = await GET(createGetRequest());
    const body = await res.json();

    expect(body.date).toBe('2026-07-22'); // Karachi's actual current day
    expect(body.timezone).toBe('Asia/Karachi');
  });

  it('POST without an explicit date writes the requester\'s own ET day at the 8pm-ET boundary', async () => {
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z')); // 8pm EDT, 2026-07-21
    mockUserPreferenceFindUnique.mockResolvedValue({ timezone: 'America/New_York' });
    mockCount.mockResolvedValue(0);
    mockCreate.mockResolvedValue(pick({ id: 'pick-tz', item_type: 'note', arc_id: null, arc: null, label: 'Evening note' }));

    await POST(createPostRequest({ item_type: 'note', label: 'Evening note' }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ date: new Date('2026-07-21T00:00:00.000Z') }) })
    );
  });

  it('GET and POST agree on the same default date for the same instant/user (write/read consistency)', async () => {
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    mockUserPreferenceFindUnique.mockResolvedValue({ timezone: 'America/New_York' });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockCreate.mockResolvedValue(pick({ id: 'pick-consistency' }));

    const getRes = await GET(createGetRequest());
    const getBody = await getRes.json();

    await POST(createPostRequest({ item_type: 'note', label: 'Consistency check' }));
    const writtenDate = (mockCreate.mock.calls[0][0] as { data: { date: Date } }).data.date;

    expect(getBody.date).toBe(writtenDate.toISOString().slice(0, 10));
  });
});

describe('POST /api/today', () => {
  it('creates an arc pick', async () => {
    mockCount.mockResolvedValue(0);
    mockArcFindUnique.mockResolvedValue({ id: 'arc-1' });
    mockCreate.mockResolvedValue(pick());

    const res = await POST(createPostRequest({ item_type: 'arc', arc_id: '550e8400-e29b-41d4-a716-446655440000' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.item_type).toBe('arc');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ item_type: 'arc', arc_id: '550e8400-e29b-41d4-a716-446655440000' }) })
    );
  });

  it('creates a note pick with only a label', async () => {
    mockCount.mockResolvedValue(0);
    mockCreate.mockResolvedValue(
      pick({ id: 'pick-note', item_type: 'note', arc_id: null, arc: null, label: 'Call the bank' })
    );

    const res = await POST(createPostRequest({ item_type: 'note', label: 'Call the bank' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.label).toBe('Call the bank');
  });

  it('rejects a pick with no ref for its type (400)', async () => {
    const res = await POST(createPostRequest({ item_type: 'arc' }));
    expect(res.status).toBe(400);
  });

  it('rejects a pick with two refs at once (400)', async () => {
    const res = await POST(
      createPostRequest({ item_type: 'arc', arc_id: '550e8400-e29b-41d4-a716-446655440000', task_id: '550e8400-e29b-41d4-a716-446655440001' })
    );
    expect(res.status).toBe(400);
  });

  it('rejects a note pick with an empty label (400)', async () => {
    const res = await POST(createPostRequest({ item_type: 'note', label: '' }));
    expect(res.status).toBe(400);
  });

  it('404s when arc_id does not exist', async () => {
    mockCount.mockResolvedValue(0);
    mockArcFindUnique.mockResolvedValue(null);

    const res = await POST(createPostRequest({ item_type: 'arc', arc_id: '550e8400-e29b-41d4-a716-446655440002' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Arc not found');
  });

  it('404s when task_id does not exist', async () => {
    mockCount.mockResolvedValue(0);
    mockTaskFindUnique.mockResolvedValue(null);

    const res = await POST(createPostRequest({ item_type: 'task', task_id: '550e8400-e29b-41d4-a716-446655440003' }));
    expect(res.status).toBe(404);
  });

  it('404s when charter_id does not exist', async () => {
    mockCount.mockResolvedValue(0);
    mockCharterFindUnique.mockResolvedValue(null);

    const res = await POST(createPostRequest({ item_type: 'lead', charter_id: '550e8400-e29b-41d4-a716-446655440004' }));
    expect(res.status).toBe(404);
  });

  it('rejects a 6th uncompleted pick for the date with 409', async () => {
    mockCount.mockResolvedValue(5);

    const res = await POST(createPostRequest({ item_type: 'note', label: 'One too many' }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/5 uncompleted picks/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('allows the 5th pick (at, not over, the cap boundary)', async () => {
    mockCount.mockResolvedValue(4);
    mockCreate.mockResolvedValue(pick({ id: 'pick-5', item_type: 'note', arc_id: null, arc: null, label: 'Fifth' }));

    const res = await POST(createPostRequest({ item_type: 'note', label: 'Fifth' }));
    expect(res.status).toBe(201);
  });
});
