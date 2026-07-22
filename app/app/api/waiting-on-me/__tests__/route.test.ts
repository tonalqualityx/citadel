import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
    },
    oracleSession: {
      findMany: vi.fn(),
    },
    emailAsk: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockSessionFindMany = prisma.oracleSession.findMany as Mock;
const mockEmailAskFindMany = prisma.emailAsk.findMany as Mock;

function emailAsk(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: null,
    from_email: 'client@herba.com',
    subject: 'Site is down',
    gist: 'Client reports site is down',
    queue: 'do',
    severity: 'client_blocking',
    is_urgent: true,
    state: 'open',
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: new Date('2026-07-21T20:00:00.000Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function getRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/waiting-on-me?${searchParams.toString()}`);
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'A task',
    status: 'not_started',
    priority: 3,
    source_session_external_id: null,
    arc: null,
    due_date: null,
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    external_id: 'ext-1',
    waiting_on: 'Need a decision on X',
    status: 'waiting',
    ask_severity: 'internal',
    ask_queue: 'decide',
    arc: null,
    ...overrides,
  };
}

// Task findMany is called 5 times per request in a fixed order:
// focus, overdue, awaitingReview, blocked, openWithin14d
function mockTaskSweep({
  focus = [],
  overdue = [],
  awaitingReview = [],
  blocked = [],
  openWithin14d = [],
}: Partial<Record<'focus' | 'overdue' | 'awaitingReview' | 'blocked' | 'openWithin14d', unknown[]>> = {}) {
  mockTaskFindMany
    .mockResolvedValueOnce(focus)
    .mockResolvedValueOnce(overdue)
    .mockResolvedValueOnce(awaitingReview)
    .mockResolvedValueOnce(blocked)
    .mockResolvedValueOnce(openWithin14d);
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): this file chains 5 sequential
  // .mockResolvedValueOnce() calls per test, and clearAllMocks() does not drain a mock's
  // queued "once" implementations — only a full reset does, otherwise leftover queued
  // values from a prior test bleed into the next test's Promise.all() call order.
  vi.resetAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
  mockSessionFindMany.mockResolvedValue([]);
  // Base fallback (not Once): covers any of the 5 sweep calls a test doesn't override via
  // mockTaskSweep(...) — tests that call mockTaskSweep() themselves queue their own
  // Once-values on top of this, consumed first for that request's 5 calls.
  mockTaskFindMany.mockResolvedValue([]);
  mockEmailAskFindMany.mockResolvedValue([]);
});

describe('GET /api/waiting-on-me — Clarity Phase 4a crisis/intake', () => {
  it('returns an empty crisis array and a zero-count intake when there are no email asks', async () => {
    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.crisis).toEqual([]);
    expect(body.intake).toEqual({ count: 0, newest_at: null, items: [] });
  });

  it('shapes open+urgent asks into crisis, newest first', async () => {
    mockEmailAskFindMany
      .mockResolvedValueOnce([emailAsk({ id: 'urgent-1' })]) // crisis query
      .mockResolvedValueOnce([]); // intake query

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.crisis).toHaveLength(1);
    expect(body.crisis[0]).toMatchObject({ id: 'urgent-1', is_urgent: true, state: 'open' });
    expect(mockEmailAskFindMany).toHaveBeenNthCalledWith(1, {
      where: { state: 'open', is_urgent: true },
      orderBy: { received_at: 'desc' },
    });
  });

  it('shapes open+non-urgent asks into intake with count and newest_at', async () => {
    const newer = emailAsk({
      id: 'intake-newer',
      is_urgent: false,
      received_at: new Date('2026-07-21T22:00:00.000Z'),
    });
    const older = emailAsk({
      id: 'intake-older',
      is_urgent: false,
      received_at: new Date('2026-07-21T10:00:00.000Z'),
    });
    mockEmailAskFindMany
      .mockResolvedValueOnce([]) // crisis query
      .mockResolvedValueOnce([newer, older]); // intake query, orderBy desc already applied by the DB

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.intake.count).toBe(2);
    expect(body.intake.newest_at).toBe(newer.received_at.toISOString());
    expect(body.intake.items.map((i: { id: string }) => i.id)).toEqual(['intake-newer', 'intake-older']);
    expect(mockEmailAskFindMany).toHaveBeenNthCalledWith(2, {
      where: { state: 'open', is_urgent: false },
      orderBy: { received_at: 'desc' },
    });
  });

  it('never merges email asks into decide/answer/review/do', async () => {
    mockEmailAskFindMany
      .mockResolvedValueOnce([emailAsk({ id: 'urgent-1' })])
      .mockResolvedValueOnce([emailAsk({ id: 'intake-1', is_urgent: false })]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.decide).toEqual([]);
    expect(body.answer).toEqual([]);
    expect(body.review).toEqual([]);
    expect(body.do).toEqual([]);
    expect(body.meta.counts.total).toBe(0);
  });
});

describe('GET /api/waiting-on-me — auth scoping', () => {
  it('tech users default to their own feed', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'tech-1', role: 'tech', email: 'tech@example.com' });
    await GET(getRequest());

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignee_id: 'tech-1' }) })
    );
  });

  it('tech users are rejected (403) when requesting another user_id', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'tech-1', role: 'tech', email: 'tech@example.com' });
    const res = await GET(getRequest({ user_id: 'someone-else' }));
    expect(res.status).toBe(403);
  });

  it('pm/admin can view any user via user_id', async () => {
    await GET(getRequest({ user_id: 'other-user' }));

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignee_id: 'other-user' }) })
    );
  });

  it('pm/admin default to themselves when user_id is absent', async () => {
    await GET(getRequest());
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignee_id: 'user-123' }) })
    );
  });
});

describe('GET /api/waiting-on-me — grouping', () => {
  it('routes ordinary task-sweep results into `do`', async () => {
    mockTaskSweep({ focus: [task({ id: 'focus-1' })] });

    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.do).toHaveLength(1);
    expect(body.do[0].id).toBe('focus-1');
    expect(body.do[0].type).toBe('task');
    expect(body.review).toHaveLength(0);
  });

  it('routes awaiting-review task-sweep results into `review`', async () => {
    mockTaskSweep({ awaitingReview: [task({ id: 'review-1', status: 'done' })] });

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.review).toHaveLength(1);
    expect(body.review[0].id).toBe('review-1');
    expect(body.do).toHaveLength(0);
  });

  it('routes session asks by their ask_queue', async () => {
    mockSessionFindMany.mockResolvedValue([
      session({ id: 's-decide', ask_queue: 'decide' }),
      session({ id: 's-answer', ask_queue: 'answer' }),
      session({ id: 's-review', ask_queue: 'review' }),
      session({ id: 's-do', ask_queue: 'do' }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.decide.map((c: { id: string }) => c.id)).toEqual(['s-decide']);
    expect(body.answer.map((c: { id: string }) => c.id)).toEqual(['s-answer']);
    expect(body.review.map((c: { id: string }) => c.id)).toEqual(['s-review']);
    expect(body.do.map((c: { id: string }) => c.id)).toEqual(['s-do']);
  });

  it('defaults a session ask with no ask_queue to `do`', async () => {
    mockSessionFindMany.mockResolvedValue([session({ id: 's-null-queue', ask_queue: null })]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.do.map((c: { id: string }) => c.id)).toEqual(['s-null-queue']);
  });

  it('reports accurate meta.counts across all four groups', async () => {
    mockTaskSweep({ focus: [task({ id: 't1' })], awaitingReview: [task({ id: 't2', status: 'done' })] });
    mockSessionFindMany.mockResolvedValue([session({ id: 's1', ask_queue: 'decide' })]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.meta.counts).toEqual({ decide: 1, answer: 0, review: 1, do: 1, total: 3 });
  });

  it('session asks carry type, title, severity, and session_external_id', async () => {
    mockSessionFindMany.mockResolvedValue([
      session({ id: 's1', external_id: 'ext-xyz', waiting_on: 'Approve the deploy?', ask_severity: 'launch_blocking', ask_queue: 'decide' }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.decide[0]).toMatchObject({
      type: 'session_ask',
      title: 'Approve the deploy?',
      severity: 'launch_blocking',
      session_external_id: 'ext-xyz',
      task_id: null,
    });
  });

  it('task cards carry type, task_id, and priority', async () => {
    mockTaskSweep({ focus: [task({ id: 't1', priority: 2 })] });

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.do[0]).toMatchObject({
      type: 'task',
      task_id: 't1',
      priority: 2,
      session_external_id: null,
    });
  });

  it('includes arc info on a task card when the task has an arc', async () => {
    mockTaskSweep({ focus: [task({ id: 't1', arc: { id: 'arc-1', name: 'Growth Roadmap' } })] });

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.do[0].arc).toEqual({ id: 'arc-1', name: 'Growth Roadmap' });
  });

  it('queries live OracleSessions scoped to waiting_on set, not archived, not ended/stale', async () => {
    await GET(getRequest());

    expect(mockSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          waiting_on: { not: null },
          archived_at: null,
          status: { notIn: ['ended', 'stale'] },
        },
      })
    );
  });
});

describe('GET /api/waiting-on-me — cross-query dedup', () => {
  it('a task matching both focus and overdue is only emitted once (from the earlier query)', async () => {
    const shared = task({ id: 'shared-task', priority: 1 });
    mockTaskSweep({ focus: [shared], overdue: [task({ id: 'shared-task', priority: 5 })] });

    const res = await GET(getRequest());
    const body = await res.json();

    const matches = body.do.filter((c: { id: string }) => c.id === 'shared-task');
    expect(matches).toHaveLength(1);
    // Kept the FIRST (focus) query's version — priority 1, not overdue's 5.
    expect(matches[0].priority).toBe(1);
  });

  it('a task already emitted by focus does not also show up via awaiting-review', async () => {
    const shared = task({ id: 'shared-task-2' });
    mockTaskSweep({ focus: [shared], awaitingReview: [task({ id: 'shared-task-2' })] });

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.do.filter((c: { id: string }) => c.id === 'shared-task-2')).toHaveLength(1);
    expect(body.review.filter((c: { id: string }) => c.id === 'shared-task-2')).toHaveLength(0);
  });
});
