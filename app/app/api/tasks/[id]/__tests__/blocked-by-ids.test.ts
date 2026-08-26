import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';

// project-record-citadel-changes.md addendum (ruling 32) — PATCH /api/tasks/[id]
// blocked_by_ids connect/disconnect + cycle rejection. dependencies.ts is deliberately NOT
// mocked: these exercise the real areBlockersSatisfied/wouldCreateCycle predicates against
// the mocked prisma below, same convention as dependency-propagation.test.ts.

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
      updateMany: vi.fn(),
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

vi.mock('@/lib/calculations/status', () => ({
  canTransitionTaskStatus: vi.fn(() => true),
}));

vi.mock('@/lib/calculations/energy', () => ({
  calculateEstimatedMinutes: vi.fn((energy: number) => energy * 30),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

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

function existingTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    status: 'not_started',
    project_id: null,
    project: null,
    assignee_id: null,
    function_id: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    estimated_minutes: null,
    created_by_id: 'user-1',
    is_deleted: false,
    ...overrides,
  };
}

function updatedTaskResponse(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    title: 'Dependent Task',
    status: 'not_started',
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
    ...overrides,
  };
}

function blockerRow(id: string, status: string, approved: boolean, orderingOnly: boolean) {
  return { id, status, approved, project: { dependencies_ordering_only: orderingOnly } };
}

describe('PATCH /api/tasks/[id] — dependency wiring (blocked_by_ids)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'pm@test.com', role: 'pm' });
    mockEmailAskFindFirst.mockResolvedValue(null);
  });

  it('connect-blocks-dependent: connecting an unsatisfied blocker forces status to blocked', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ status: 'not_started' }));
    mockTaskFindMany
      .mockResolvedValueOnce([{ id: BLOCKER_ID }]) // existence check
      .mockResolvedValueOnce([{ blocked_by: [] }]) // wouldCreateCycle BFS — no cycle
      .mockResolvedValueOnce([blockerRow(BLOCKER_ID, 'in_progress', false, false)]); // unsatisfied
    mockTaskUpdate.mockResolvedValue(updatedTaskResponse({ status: 'blocked' }));

    const response = await PATCH(
      makeRequest({ blocked_by_ids: { connect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );

    expect(response.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          blocked_by: { connect: [{ id: BLOCKER_ID }] },
          status: 'blocked',
        }),
      })
    );
  });

  it('connecting an already-satisfied blocker does NOT force blocked status', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ status: 'in_progress' }));
    mockTaskFindMany
      .mockResolvedValueOnce([{ id: BLOCKER_ID }])
      .mockResolvedValueOnce([{ blocked_by: [] }])
      .mockResolvedValueOnce([blockerRow(BLOCKER_ID, 'done', true, false)]); // satisfied
    mockTaskUpdate.mockResolvedValue(updatedTaskResponse({ status: 'in_progress' }));

    const response = await PATCH(
      makeRequest({ blocked_by_ids: { connect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );

    expect(response.status).toBe(200);
    const call = mockTaskUpdate.mock.calls[0][0];
    expect(call.data.blocked_by).toEqual({ connect: [{ id: BLOCKER_ID }] });
    expect(call.data.status).toBeUndefined();
  });

  it('disconnect: removes the blocked_by relation without forcing a status change (release relies on the sweep)', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ status: 'blocked' }));
    mockTaskUpdate.mockResolvedValue(updatedTaskResponse({ status: 'blocked', blocked_by: [] }));

    const response = await PATCH(
      makeRequest({ blocked_by_ids: { disconnect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );

    expect(response.status).toBe(200);
    // Disconnect alone never touches the existence/cycle/satisfaction checks (those only
    // gate connect) — no findMany call should be issued at all.
    expect(mockTaskFindMany).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blocked_by: { disconnect: [{ id: BLOCKER_ID }] },
        }),
      })
    );
    // No bespoke unblock path here — status is left as-is for healBlockedTasks/the reactive
    // triggers to pick up.
    expect(mockTaskUpdate.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('cycle rejection: rejects a connect that would close a dependency loop with 422', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockTaskFindMany
      .mockResolvedValueOnce([{ id: BLOCKER_ID }]) // existence check passes
      // BLOCKER_ID already (transitively) depends on TASK_ID — closing the loop.
      .mockResolvedValueOnce([{ blocked_by: [{ id: TASK_ID }] }]);

    const response = await PATCH(
      makeRequest({ blocked_by_ids: { connect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/cycle/i);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('never forces blocked status onto an already-completed task', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ status: 'done' }));
    mockTaskFindMany
      .mockResolvedValueOnce([{ id: BLOCKER_ID }])
      .mockResolvedValueOnce([{ blocked_by: [] }])
      .mockResolvedValueOnce([blockerRow(BLOCKER_ID, 'not_started', false, false)]); // unsatisfied

    mockTaskUpdate.mockResolvedValue(updatedTaskResponse({ status: 'done' }));

    const response = await PATCH(
      makeRequest({ blocked_by_ids: { connect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );

    expect(response.status).toBe(200);
    expect(mockTaskUpdate.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('returns 404 when a connect id does not resolve to a real task', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockTaskFindMany.mockResolvedValueOnce([]); // existence check finds nothing

    const response = await PATCH(
      makeRequest({ blocked_by_ids: { connect: [BLOCKER_ID] } }),
      { params: makeParams() }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('One or more blocker tasks not found');
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });
});
