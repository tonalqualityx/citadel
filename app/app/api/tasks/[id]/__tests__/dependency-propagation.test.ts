import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    projectTeamAssignment: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatTaskResponse: vi.fn((task) => ({
    ...task,
    time_spent_minutes: null,
  })),
}));

// Mock activity logging
vi.mock('@/lib/services/activity', () => ({
  logStatusChange: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

// Mock notifications
vi.mock('@/lib/services/notifications', () => ({
  notifyTaskAssigned: vi.fn(),
}));

// Mock status calculation
vi.mock('@/lib/calculations/status', () => ({
  canTransitionTaskStatus: vi.fn(() => true),
}));

// Mock energy calculations
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
const mockTaskUpdateMany = prisma.task.updateMany as Mock;

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/tasks/task-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const makeParams = () => Promise.resolve({ id: 'task-1' });

// A fully-populated task as returned by prisma.task.update (shape consumed by formatTaskResponse)
function updatedTask(overrides: Record<string, any> = {}) {
  return {
    id: 'task-1',
    status: 'done',
    title: 'Blocker Task',
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

// Build a blocker entry as returned inside a dependent's `blocked_by` by unblockEligibleDependents.
function blocker(id: string, status: string, approved: boolean, orderingOnly: boolean | null) {
  return {
    id,
    status,
    approved,
    project: orderingOnly === null ? null : { dependencies_ordering_only: orderingOnly },
  };
}

// The exact query shape unblockEligibleDependents issues for the done-trigger.
const UNBLOCK_QUERY = {
  where: {
    blocked_by: { some: { id: 'task-1' } },
    status: 'blocked',
    is_deleted: false,
  },
  include: {
    blocked_by: {
      where: { is_deleted: false },
      select: {
        id: true,
        status: true,
        approved: true,
        project: { select: { dependencies_ordering_only: true } },
      },
    },
  },
};

describe('Task dependency propagation on status change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com', role: 'pm' });
  });

  describe('ordering-only project (dependencies_ordering_only: true)', () => {
    it('unblocks a dependent as soon as the blocker is done (no approval needed)', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask());

      // task-2 is blocked only by task-1, which is now done in an ordering-only project
      mockTaskFindMany.mockResolvedValueOnce([
        { id: 'task-2', status: 'blocked', blocked_by: [blocker('task-1', 'done', false, true)] },
      ]);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);

      expect(mockTaskFindMany).toHaveBeenCalledWith(UNBLOCK_QUERY);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-2'] } },
        data: { status: 'not_started' },
      });
    });

    it('does NOT unblock while another blocker is still incomplete', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask());

      // task-2 is blocked by task-1 (done) AND task-3 (still in progress)
      mockTaskFindMany.mockResolvedValueOnce([
        {
          id: 'task-2',
          status: 'blocked',
          blocked_by: [
            blocker('task-1', 'done', false, true),
            blocker('task-3', 'in_progress', false, true),
          ],
        },
      ]);

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });

    it('unblocks only the dependents whose blockers are all satisfied', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask());

      mockTaskFindMany.mockResolvedValueOnce([
        { id: 'task-2', status: 'blocked', blocked_by: [blocker('task-1', 'done', false, true)] },
        {
          id: 'task-4',
          status: 'blocked',
          blocked_by: [
            blocker('task-1', 'done', false, true),
            blocker('task-3', 'blocked', false, true),
          ],
        },
      ]);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-2'] } },
        data: { status: 'not_started' },
      });
    });
  });

  describe('approval-gated project (default, dependencies_ordering_only: false)', () => {
    it('does NOT unblock on done alone — preserves "don\'t build on unreviewed work"', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask());

      // task-1 is done but NOT yet approved, in an approval-gated project
      mockTaskFindMany.mockResolvedValueOnce([
        { id: 'task-2', status: 'blocked', blocked_by: [blocker('task-1', 'done', false, false)] },
      ]);

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Queried for dependents, but none unblocked because the blocker is unapproved
      expect(mockTaskFindMany).toHaveBeenCalledWith(UNBLOCK_QUERY);
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });

    it('treats a blocker with no project as approval-gated (done is not enough)', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask());

      mockTaskFindMany.mockResolvedValueOnce([
        { id: 'task-2', status: 'blocked', blocked_by: [blocker('task-1', 'done', false, null)] },
      ]);

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });

    it('unblocks the dependent once the blocker is approved', async () => {
      // Approval goes through the full-update path (body has `approved`, not `status`).
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'review',
        project: null,
        is_deleted: false,
        created_by_id: 'user-1',
        assignee_id: null,
        started_at: null,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask({ approved: true, status: 'review' }));

      // Now task-1 is done AND approved → its approval-gated dependent can proceed
      mockTaskFindMany.mockResolvedValueOnce([
        { id: 'task-2', status: 'blocked', blocked_by: [blocker('task-1', 'done', true, false)] },
      ]);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const response = await PATCH(makeRequest({ approved: true }), { params: makeParams() });
      expect(response.status).toBe(200);

      expect(mockTaskFindMany).toHaveBeenCalledWith(UNBLOCK_QUERY);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-2'] } },
        data: { status: 'not_started' },
      });
    });

    it('does not unblock dependents when approval is revoked (approved: false)', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'review',
        project: null,
        is_deleted: false,
        created_by_id: 'user-1',
        assignee_id: null,
        started_at: null,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask({ approved: false, status: 'review' }));

      const response = await PATCH(makeRequest({ approved: false }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Revoking approval must not trigger any unblock evaluation
      expect(mockTaskFindMany).not.toHaveBeenCalled();
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('when a completed blocker is reopened', () => {
    it('should re-block dependent tasks in active states', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'done',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask({ status: 'in_progress', completed_at: null }));

      mockTaskFindMany.mockResolvedValueOnce([{ id: 'task-2' }]);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const response = await PATCH(makeRequest({ status: 'in_progress' }), { params: makeParams() });
      expect(response.status).toBe(200);

      expect(mockTaskFindMany).toHaveBeenCalledWith({
        where: {
          blocked_by: { some: { id: 'task-1' } },
          status: { notIn: ['blocked', 'done', 'abandoned'] },
          is_deleted: false,
        },
        select: { id: true },
      });
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-2'] } },
        data: { status: 'blocked' },
      });
    });

    it('should NOT re-block tasks that are already done or abandoned', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'done',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask({ status: 'not_started', completed_at: null }));

      mockTaskFindMany.mockResolvedValueOnce([]);

      const response = await PATCH(makeRequest({ status: 'not_started' }), { params: makeParams() });
      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('when status changes but not involving done', () => {
    it('should NOT propagate when moving between active states', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'not_started',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask({ status: 'in_progress' }));

      const response = await PATCH(makeRequest({ status: 'in_progress' }), { params: makeParams() });
      expect(response.status).toBe(200);
      expect(mockTaskFindMany).not.toHaveBeenCalled();
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('when no dependent tasks exist', () => {
    it('should handle completing a task with no dependents gracefully', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });
      mockTaskUpdate.mockResolvedValue(updatedTask());

      mockTaskFindMany.mockResolvedValueOnce([]);

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });
  });
});
