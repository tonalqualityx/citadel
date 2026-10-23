import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

// PATCH /api/tasks/[id] with `status` sent alongside other fields. updateTaskSchema had no
// status field, so the combined path stripped it and returned 200 with the old status (the
// worker's close-out `{ status: 'done', needs_review: true }` never moved the task to done).
// A combined status change now goes through the same transition rules and side effects as a
// status-only PATCH. lib/calculations/status is deliberately NOT mocked: these exercise the
// real transition table.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    emailAsk: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatTaskResponse: vi.fn((task) => ({ ...task, time_spent_minutes: null })),
}));

vi.mock('@/lib/services/activity', () => ({
  logStatusChange: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

vi.mock('@/lib/services/notifications', () => ({
  notifyTaskAssigned: vi.fn(),
}));

vi.mock('@/lib/services/dependencies', () => ({
  unblockEligibleDependents: vi.fn(),
  reblockDependents: vi.fn(),
  areBlockersSatisfied: vi.fn(async () => true),
  wouldCreateCycle: vi.fn(async () => false),
}));

vi.mock('@/lib/calculations/energy', () => ({
  calculateEstimatedMinutes: vi.fn((energy: number) => energy * 30),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logStatusChange } from '@/lib/services/activity';
import {
  unblockEligibleDependents,
  reblockDependents,
  areBlockersSatisfied,
} from '@/lib/services/dependencies';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskUpdate = prisma.task.update as Mock;
const mockEmailAskFindFirst = prisma.emailAsk.findFirst as Mock;

const TASK_ID = 'task-1';
const BLOCKER_ID = '550e8400-e29b-41d4-a716-446655440020';

function makeRequest(body: object) {
  return new NextRequest(`http://localhost/api/tasks/${TASK_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const makeParams = () => Promise.resolve({ id: TASK_ID });

function existingTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    title: 'A task',
    status: 'in_progress',
    project_id: null,
    project: null,
    assignee_id: null,
    function_id: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    estimated_minutes: null,
    created_by_id: 'user-1',
    started_at: new Date('2026-10-01T00:00:00.000Z'),
    arc_id: null,
    source: 'internal',
    is_deleted: false,
    ...overrides,
  };
}

// The mocked update echoes back the existing row merged with what the route wrote.
function echoUpdate(existing: Record<string, unknown>) {
  mockTaskUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...existing,
    ...data,
    assignee: null,
    reviewer: null,
    approved_by: null,
    function: null,
    sop: null,
    created_by: null,
    blocked_by: [],
    blocking: [],
  }));
}

function given(overrides: Record<string, unknown> = {}) {
  const existing = existingTask(overrides);
  mockTaskFindUnique.mockResolvedValue(existing);
  echoUpdate(existing);
  return existing;
}

const updateData = () => mockTaskUpdate.mock.calls[0][0].data;

describe('PATCH /api/tasks/[id] — status sent with other fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'pm@test.com', role: 'pm' });
    mockEmailAskFindFirst.mockResolvedValue(null);
    vi.mocked(areBlockersSatisfied).mockResolvedValue(true);
  });

  it('applies { status: done, needs_review: true } instead of dropping the status', async () => {
    given();

    const response = await PATCH(makeRequest({ status: 'done', needs_review: true }), {
      params: makeParams(),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateData().status).toBe('done');
    expect(updateData().needs_review).toBe(true);
    expect(updateData().completed_at).toBeInstanceOf(Date);
    expect(body.status).toBe('done');
  });

  it('runs the status-only side effects: activity log and dependent unblocking', async () => {
    given();

    await PATCH(makeRequest({ status: 'done', needs_review: true }), { params: makeParams() });

    expect(logStatusChange).toHaveBeenCalledWith('user-1', 'task', TASK_ID, 'A task', 'in_progress', 'done');
    expect(unblockEligibleDependents).toHaveBeenCalledWith(TASK_ID);
  });

  it('rejects a disallowed transition with 400 and writes nothing', async () => {
    given({ status: 'not_started' });

    const response = await PATCH(makeRequest({ status: 'review', needs_review: true }), {
      params: makeParams(),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Cannot transition from not_started to review');
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('checks the transition before the dependency lookups (400, not 404)', async () => {
    given({ status: 'not_started' });
    mockTaskFindMany.mockResolvedValue([]); // the blocker id does not exist

    const response = await PATCH(
      makeRequest({ status: 'review', blocked_by_ids: { connect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );

    expect(response.status).toBe(400);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('treats a re-sent current status as no status change', async () => {
    const completedAt = new Date('2026-10-01T12:00:00.000Z');
    given({ status: 'done', completed_at: completedAt });

    const response = await PATCH(makeRequest({ status: 'done', needs_review: true }), {
      params: makeParams(),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateData().status).toBeUndefined();
    expect(updateData().completed_at).toBeUndefined();
    expect(updateData().needs_review).toBe(true);
    expect(logStatusChange).not.toHaveBeenCalled();
    expect(body.completion_nudge).toBeUndefined();
  });

  it('does not re-focus a task that is already in progress', async () => {
    given({ status: 'in_progress' });

    await PATCH(makeRequest({ status: 'in_progress', tags: ['x'] }), { params: makeParams() });

    expect(updateData().is_focus).toBeUndefined();
    expect(updateData().status).toBeUndefined();
  });

  it('rejects an unknown status value with 400 instead of ignoring it', async () => {
    given();

    const response = await PATCH(makeRequest({ status: 'finished', tags: ['x'] }), {
      params: makeParams(),
    });

    expect(response.status).toBe(400);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('sets started_at and focus when moving to in_progress with other fields', async () => {
    given({ status: 'not_started', started_at: null });

    await PATCH(makeRequest({ status: 'in_progress', tags: ['cockpit-owned'] }), {
      params: makeParams(),
    });

    expect(updateData().status).toBe('in_progress');
    expect(updateData().started_at).toBeInstanceOf(Date);
    expect(updateData().is_focus).toBe(true);
    expect(updateData().tags).toEqual(['cockpit-owned']);
  });

  it('lets an explicit is_focus in the same body win over the in_progress auto-focus', async () => {
    given({ status: 'not_started', started_at: null });

    await PATCH(makeRequest({ status: 'in_progress', is_focus: false }), { params: makeParams() });

    expect(updateData().is_focus).toBe(false);
  });

  it('clears completed_at and re-blocks dependents when reopening a done task', async () => {
    given({ status: 'done', completed_at: new Date() });

    await PATCH(makeRequest({ status: 'not_started', tags: ['client-sent-back'] }), {
      params: makeParams(),
    });

    expect(updateData().status).toBe('not_started');
    expect(updateData().completed_at).toBeNull();
    expect(reblockDependents).toHaveBeenCalledWith(TASK_ID);
  });

  it('returns the completion nudge when a combined update closes a task with an attached email', async () => {
    given();
    mockEmailAskFindFirst.mockResolvedValueOnce({
      thread_id: 'thread-1',
      subject: 'Re: proposal',
      from_email: 'jane@herba.com',
    });

    const response = await PATCH(makeRequest({ status: 'done', needs_review: true }), {
      params: makeParams(),
    });
    const body = await response.json();

    expect(body.completion_nudge).toEqual({
      thread_id: 'thread-1',
      subject: 'Re: proposal',
      from_email: 'jane@herba.com',
    });
  });

  it('leaves status untouched and runs no status side effects when status is absent', async () => {
    given();

    await PATCH(makeRequest({ needs_review: true }), { params: makeParams() });

    expect(updateData().status).toBeUndefined();
    expect(logStatusChange).not.toHaveBeenCalled();
    expect(unblockEligibleDependents).not.toHaveBeenCalled();
  });

  it('still forces blocked when an unsatisfied blocker is connected alongside an open status', async () => {
    given({ status: 'not_started' });
    mockTaskFindMany.mockResolvedValue([{ id: BLOCKER_ID }]);
    vi.mocked(areBlockersSatisfied).mockResolvedValue(false);

    await PATCH(
      makeRequest({ status: 'in_progress', blocked_by_ids: { connect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );

    expect(updateData().status).toBe('blocked');
    // A forced block is not a start: no started_at stamp, no auto-focus.
    expect(updateData().started_at).toBeUndefined();
    expect(updateData().is_focus).toBeUndefined();
  });

  it('does not force blocked over a requested move to done', async () => {
    given({ status: 'in_progress' });
    mockTaskFindMany.mockResolvedValue([{ id: BLOCKER_ID }]);
    vi.mocked(areBlockersSatisfied).mockResolvedValue(false);

    await PATCH(makeRequest({ status: 'done', blocked_by_ids: { connect: [BLOCKER_ID] } }), {
      params: makeParams(),
    });

    expect(updateData().status).toBe('done');
  });
});
