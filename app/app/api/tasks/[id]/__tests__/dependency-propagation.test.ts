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

describe('Task dependency propagation on status change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com', role: 'pm' });
  });

  describe('when a blocker task is completed', () => {
    it('should unblock dependent tasks that have no other incomplete blockers', async () => {
      // Existing task is in_progress
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });

      // The updated task returned by prisma.task.update
      mockTaskUpdate.mockResolvedValue({
        id: 'task-1',
        status: 'done',
        title: 'Blocker Task',
        project: null,
        assignee: null,
        reviewer: null,
        approved_by: null,
        function: null,
        sop: null,
        created_by: null,
        blocked_by: [],
        blocking: [],
      });

      // Dependent tasks: task-2 is blocked by task-1, no other incomplete blockers
      mockTaskFindMany.mockResolvedValueOnce([
        {
          id: 'task-2',
          status: 'blocked',
          blocked_by: [], // no remaining incomplete blockers after filtering
        },
      ]);

      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Should have queried for dependent blocked tasks
      expect(mockTaskFindMany).toHaveBeenCalledWith({
        where: {
          blocked_by: { some: { id: 'task-1' } },
          status: 'blocked',
          is_deleted: false,
        },
        include: {
          blocked_by: {
            where: { status: { not: 'done' }, is_deleted: false },
            select: { id: true },
          },
        },
      });

      // Should unblock task-2
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-2'] } },
        data: { status: 'not_started' },
      });
    });

    it('should NOT unblock tasks that still have other incomplete blockers', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });

      mockTaskUpdate.mockResolvedValue({
        id: 'task-1',
        status: 'done',
        title: 'Blocker Task',
        project: null,
        assignee: null,
        reviewer: null,
        approved_by: null,
        function: null,
        sop: null,
        created_by: null,
        blocked_by: [],
        blocking: [],
      });

      // task-2 is blocked by task-1 AND task-3 (task-3 still incomplete)
      mockTaskFindMany.mockResolvedValueOnce([
        {
          id: 'task-2',
          status: 'blocked',
          blocked_by: [{ id: 'task-3' }], // task-3 still incomplete
        },
      ]);

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Should NOT call updateMany since task-2 still has incomplete blockers
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });

    it('should handle mix of unblockable and still-blocked tasks', async () => {
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        project: null,
        is_deleted: false,
      });

      mockTaskUpdate.mockResolvedValue({
        id: 'task-1',
        status: 'done',
        title: 'Blocker Task',
        project: null,
        assignee: null,
        reviewer: null,
        approved_by: null,
        function: null,
        sop: null,
        created_by: null,
        blocked_by: [],
        blocking: [],
      });

      // task-2 can be unblocked, task-4 still has task-3 blocking it
      mockTaskFindMany.mockResolvedValueOnce([
        {
          id: 'task-2',
          status: 'blocked',
          blocked_by: [], // all blockers done
        },
        {
          id: 'task-4',
          status: 'blocked',
          blocked_by: [{ id: 'task-3' }], // still blocked
        },
      ]);

      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Should only unblock task-2
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-2'] } },
        data: { status: 'not_started' },
      });
    });
  });

  describe('when a completed blocker is reopened', () => {
    it('should re-block dependent tasks in active states', async () => {
      // Existing task was done
      mockTaskFindUnique.mockResolvedValue({
        id: 'task-1',
        status: 'done',
        project: null,
        is_deleted: false,
      });

      mockTaskUpdate.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        title: 'Reopened Task',
        project: null,
        assignee: null,
        reviewer: null,
        approved_by: null,
        function: null,
        sop: null,
        created_by: null,
        blocked_by: [],
        blocking: [],
        completed_at: null,
      });

      // task-2 was unblocked and is now in not_started
      mockTaskFindMany.mockResolvedValueOnce([
        { id: 'task-2' },
      ]);

      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const response = await PATCH(makeRequest({ status: 'in_progress' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Should query for dependent tasks in active states
      expect(mockTaskFindMany).toHaveBeenCalledWith({
        where: {
          blocked_by: { some: { id: 'task-1' } },
          status: { notIn: ['blocked', 'done', 'abandoned'] },
          is_deleted: false,
        },
        select: { id: true },
      });

      // Should re-block task-2
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

      mockTaskUpdate.mockResolvedValue({
        id: 'task-1',
        status: 'not_started',
        title: 'Reopened Task',
        project: null,
        assignee: null,
        reviewer: null,
        approved_by: null,
        function: null,
        sop: null,
        created_by: null,
        blocked_by: [],
        blocking: [],
        completed_at: null,
      });

      // No tasks match because they're all done/abandoned/blocked already
      mockTaskFindMany.mockResolvedValueOnce([]);

      const response = await PATCH(makeRequest({ status: 'not_started' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Should NOT call updateMany
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

      mockTaskUpdate.mockResolvedValue({
        id: 'task-1',
        status: 'in_progress',
        title: 'Task',
        project: null,
        assignee: null,
        reviewer: null,
        approved_by: null,
        function: null,
        sop: null,
        created_by: null,
        blocked_by: [],
        blocking: [],
      });

      // propagateBlockingStatus should not query for dependents
      const response = await PATCH(makeRequest({ status: 'in_progress' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Should not query for dependents or call updateMany
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

      mockTaskUpdate.mockResolvedValue({
        id: 'task-1',
        status: 'done',
        title: 'Task',
        project: null,
        assignee: null,
        reviewer: null,
        approved_by: null,
        function: null,
        sop: null,
        created_by: null,
        blocked_by: [],
        blocking: [],
      });

      // No dependent tasks
      mockTaskFindMany.mockResolvedValueOnce([]);

      const response = await PATCH(makeRequest({ status: 'done' }), { params: makeParams() });
      expect(response.status).toBe(200);

      // Should NOT call updateMany
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    });
  });
});
