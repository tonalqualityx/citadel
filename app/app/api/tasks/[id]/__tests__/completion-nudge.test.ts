import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

// Clarity Phase 7 — the completion-nudge hook: PATCH /api/tasks/[id]'s status-only
// transition to 'done' includes `completion_nudge` in the response when the task has an
// attached email (directly via EmailAsk.task_id, or via its arc's EmailAsk.arc_id).
// Mocking pattern mirrors the sibling arc-update.test.ts in this same directory.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    emailAsk: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatTaskResponse: vi.fn((task) => ({
    ...task,
    time_spent_minutes: null,
  })),
}));

vi.mock('@/lib/services/activity', () => ({
  logStatusChange: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

vi.mock('@/lib/services/notifications', () => ({
  notifyTaskAssigned: vi.fn(),
}));

vi.mock('@/lib/calculations/status', () => ({
  canTransitionTaskStatus: vi.fn(() => true),
}));

vi.mock('@/lib/services/dependencies', () => ({
  unblockEligibleDependents: vi.fn(),
  reblockDependents: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockTaskUpdate = prisma.task.update as Mock;
const mockEmailAskFindFirst = prisma.emailAsk.findFirst as Mock;

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/tasks/task-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const makeParams = () => Promise.resolve({ id: 'task-1' });

function existingTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    status: 'in_progress',
    project: null,
    is_deleted: false,
    arc_id: null,
    started_at: new Date(),
    ...overrides,
  };
}

function updatedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    status: 'done',
    title: 'A task',
    project: null,
    assignee: null,
    assignee_id: null,
    reviewer: null,
    approved_by: null,
    function: null,
    sop: null,
    created_by: null,
    blocked_by: [],
    blocking: [],
    arc_id: null,
    arc: null,
    ...overrides,
  };
}

describe('PATCH /api/tasks/[id] — completion_nudge (Clarity Phase 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com', role: 'pm' });
    mockEmailAskFindFirst.mockResolvedValue(null);
  });

  it('includes completion_nudge when the task has a directly attached email', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockTaskUpdate.mockResolvedValue(updatedTask());
    mockEmailAskFindFirst.mockResolvedValueOnce({
      thread_id: 'thread-1',
      subject: 'Re: proposal',
      from_email: 'jane@herba.com',
    });

    const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.completion_nudge).toEqual({
      thread_id: 'thread-1',
      subject: 'Re: proposal',
      from_email: 'jane@herba.com',
    });
    expect(mockEmailAskFindFirst).toHaveBeenNthCalledWith(1, {
      where: { task_id: 'task-1' },
      orderBy: { received_at: 'desc' },
      select: { thread_id: true, subject: true, from_email: true },
    });
  });

  it('falls back to the arc\'s attached email when the task itself has none', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ arc_id: 'arc-1' }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ arc_id: 'arc-1', arc: { id: 'arc-1', name: 'Herba round' } }));
    mockEmailAskFindFirst
      .mockResolvedValueOnce(null) // direct task_id lookup: nothing
      .mockResolvedValueOnce({ thread_id: 'thread-2', subject: 'Re: kickoff', from_email: 'jane@herba.com' });

    const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.completion_nudge).toEqual({
      thread_id: 'thread-2',
      subject: 'Re: kickoff',
      from_email: 'jane@herba.com',
    });
    expect(mockEmailAskFindFirst).toHaveBeenNthCalledWith(2, {
      where: { arc_id: 'arc-1' },
      orderBy: { received_at: 'desc' },
      select: { thread_id: true, subject: true, from_email: true },
    });
  });

  it('prefers the direct task attachment over the arc\'s when both exist', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ arc_id: 'arc-1' }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ arc_id: 'arc-1' }));
    mockEmailAskFindFirst.mockResolvedValueOnce({
      thread_id: 'thread-direct',
      subject: 'Direct attach',
      from_email: 'direct@herba.com',
    });

    const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
    const body = await response.json();

    expect(body.completion_nudge).toEqual({
      thread_id: 'thread-direct',
      subject: 'Direct attach',
      from_email: 'direct@herba.com',
    });
    // Never falls through to the arc lookup once the direct one resolves.
    expect(mockEmailAskFindFirst).toHaveBeenCalledTimes(1);
  });

  it('omits completion_nudge when there is no attached email anywhere (task or arc)', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ arc_id: 'arc-1' }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ arc_id: 'arc-1' }));

    const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.completion_nudge).toBeUndefined();
  });

  it('does not query email_asks at all when the arc has no arc_id and the task has none directly', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockTaskUpdate.mockResolvedValue(updatedTask());
    mockEmailAskFindFirst.mockResolvedValueOnce(null); // direct lookup: nothing

    const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
    await response.json();

    // Only the direct task_id lookup runs — no arc_id to fall back to.
    expect(mockEmailAskFindFirst).toHaveBeenCalledTimes(1);
  });

  it('never fires on a no-op re-PATCH of an already-done task', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ status: 'done' }));
    mockTaskUpdate.mockResolvedValue(updatedTask());

    const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.completion_nudge).toBeUndefined();
    expect(mockEmailAskFindFirst).not.toHaveBeenCalled();
  });

  it('never fires on a transition to a non-done status', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ status: 'not_started' }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ status: 'in_progress' }));

    const response = await PATCH(makeRequest({ status: 'in_progress' }), { params: makeParams() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.completion_nudge).toBeUndefined();
    expect(mockEmailAskFindFirst).not.toHaveBeenCalled();
  });
});
