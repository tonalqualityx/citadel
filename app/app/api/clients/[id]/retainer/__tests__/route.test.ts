import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import type { Mock } from 'vitest';

// Mock auth
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: {
      findUnique: vi.fn(),
    },
    timeEntry: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockTimeEntryFindMany = prisma.timeEntry.findMany as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;

const CLIENT_ID = 'client-abc';
const OTHER_CLIENT_ID = 'client-other';

function createRequest(month?: string): NextRequest {
  const url = month
    ? `http://localhost:3000/api/clients/${CLIENT_ID}/retainer?month=${month}`
    : `http://localhost:3000/api/clients/${CLIENT_ID}/retainer`;
  return new NextRequest(url, { method: 'GET' });
}

const mockClient = {
  id: CLIENT_ID,
  name: 'Test Client',
  retainer_hours: 10, // 600 minutes
};

describe('GET /api/clients/[id]/retainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockClientFindUnique.mockResolvedValue(mockClient);
    // Default: no time entries, no tasks
    mockTimeEntryFindMany.mockResolvedValue([]);
    mockTaskFindMany.mockResolvedValue([]);
  });

  describe('Client scoping - scheduled tasks', () => {
    it('scopes all OR branches in scheduled task query to clientId', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CLIENT_ID });

      await GET(request, { params });

      // findMany is called for: scheduled tasks and unscheduled tasks
      // The first task.findMany call is for scheduled tasks
      const scheduledCall = mockTaskFindMany.mock.calls[0];
      const where = scheduledCall[0].where;

      // Verify due_date uses lte only (includes overdue tasks)
      expect(where.due_date).toEqual({ lte: expect.any(Date) });
      expect(where.due_date.gte).toBeUndefined();

      // Verify all OR branches scope to clientId
      const orBranches = where.OR;
      expect(orBranches.length).toBeGreaterThanOrEqual(2);

      // Branch 1: is_retainer_work scoped to client
      const retainerWorkBranch = orBranches[0];
      expect(retainerWorkBranch.is_retainer_work).toBe(true);
      expect(retainerWorkBranch.OR).toBeDefined();
      const innerOr = retainerWorkBranch.OR;
      // Must require either project.client_id or direct client_id
      const hasProjectClientScope = innerOr.some(
        (c: Record<string, unknown>) => c.project && (c.project as Record<string, unknown>).client_id === CLIENT_ID
      );
      const hasDirectClientScope = innerOr.some(
        (c: Record<string, unknown>) => c.client_id === CLIENT_ID
      );
      expect(hasProjectClientScope).toBe(true);
      expect(hasDirectClientScope).toBe(true);

      // Branch 2: project.is_retainer scoped to client
      const retainerProjectBranch = orBranches[1];
      expect(retainerProjectBranch.project.is_retainer).toBe(true);
      expect(retainerProjectBranch.project.client_id).toBe(CLIENT_ID);

      // Branch 3 (retainer client): billing_amount null, scoped to client
      if (orBranches.length >= 3) {
        const billingBranch = orBranches[2];
        expect(billingBranch.billing_amount).toBeNull();
        const billingOr = billingBranch.OR;
        const allScopedToClient = billingOr.every(
          (c: Record<string, unknown>) =>
            (c.project && (c.project as Record<string, unknown>).client_id === CLIENT_ID) ||
            c.client_id === CLIENT_ID
        );
        expect(allScopedToClient).toBe(true);
      }
    });

    it('scopes all OR branches in unscheduled task query to clientId', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CLIENT_ID });

      await GET(request, { params });

      // The second task.findMany call is for unscheduled tasks
      const unscheduledCall = mockTaskFindMany.mock.calls[1];
      const where = unscheduledCall[0].where;

      // Verify due_date is null (unscheduled)
      expect(where.due_date).toBeNull();

      // Verify all OR branches scope to clientId
      const orBranches = where.OR;
      expect(orBranches.length).toBeGreaterThanOrEqual(2);

      // Branch 1: is_retainer_work scoped to client
      const retainerWorkBranch = orBranches[0];
      expect(retainerWorkBranch.is_retainer_work).toBe(true);
      expect(retainerWorkBranch.OR).toBeDefined();

      // Branch 2: project.is_retainer scoped to client
      const retainerProjectBranch = orBranches[1];
      expect(retainerProjectBranch.project.client_id).toBe(CLIENT_ID);
    });
  });

  describe('Overdue task inclusion', () => {
    it('includes overdue tasks from prior months in scheduled tasks', async () => {
      // Task due in March, querying for May — should be included
      const overdueTask = {
        id: 'task-overdue',
        title: 'Overdue from March',
        due_date: new Date('2026-03-15'),
        status: 'in_progress',
        energy_estimate: 2,
        mystery_factor: 'known',
        battery_impact: 'average_drain',
        is_retainer_work: true,
        assignee_id: null,
        assignee: null,
        project_id: 'proj-1',
        project: { name: 'Test Project' },
      };

      // First findMany = scheduled tasks
      mockTaskFindMany.mockResolvedValueOnce([overdueTask]);
      // Second findMany = unscheduled tasks
      mockTaskFindMany.mockResolvedValueOnce([]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CLIENT_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.scheduledTasks).toHaveLength(1);
      expect(data.scheduledTasks[0].id).toBe('task-overdue');
      expect(data.scheduledTasks[0].due_date).toContain('2026-03-15');
    });

    it('does not use gte on due_date for scheduled tasks', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CLIENT_ID });

      await GET(request, { params });

      const scheduledCall = mockTaskFindMany.mock.calls[0];
      const dueDateFilter = scheduledCall[0].where.due_date;

      // Should only have lte, NOT gte
      expect(dueDateFilter).toHaveProperty('lte');
      expect(dueDateFilter).not.toHaveProperty('gte');
    });
  });

  describe('Cross-client contamination prevention', () => {
    it('does not return tasks from other clients via is_retainer_work', async () => {
      // Simulate: task belongs to OTHER client but is_retainer_work = true
      // The query should NOT match it because OR branches are scoped
      // We verify by checking the query shape, not mock returns
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CLIENT_ID });

      await GET(request, { params });

      // Check scheduled query
      const scheduledWhere = mockTaskFindMany.mock.calls[0][0].where;
      const firstBranch = scheduledWhere.OR[0];

      // The is_retainer_work branch must NOT be a bare { is_retainer_work: true }
      // It must have inner client scoping
      expect(firstBranch).not.toEqual({ is_retainer_work: true });
      expect(firstBranch.OR).toBeDefined();
      expect(firstBranch.OR.length).toBeGreaterThan(0);

      // Check unscheduled query
      const unscheduledWhere = mockTaskFindMany.mock.calls[1][0].where;
      const firstUnscheduledBranch = unscheduledWhere.OR[0];
      expect(firstUnscheduledBranch).not.toEqual({ is_retainer_work: true });
      expect(firstUnscheduledBranch.OR).toBeDefined();
    });

    it('does not return tasks from other clients via project.is_retainer', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CLIENT_ID });

      await GET(request, { params });

      // Check scheduled query
      const scheduledWhere = mockTaskFindMany.mock.calls[0][0].where;
      const projectBranch = scheduledWhere.OR[1];

      // Must NOT be bare { project: { is_retainer: true } }
      expect(projectBranch.project.client_id).toBe(CLIENT_ID);

      // Check unscheduled query
      const unscheduledWhere = mockTaskFindMany.mock.calls[1][0].where;
      const unscheduledProjectBranch = unscheduledWhere.OR[1];
      expect(unscheduledProjectBranch.project.client_id).toBe(CLIENT_ID);
    });
  });

  describe('Basic response shape', () => {
    it('returns correct structure for a retainer client', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CLIENT_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('month', '2026-05');
      expect(data).toHaveProperty('retainerHours', 10);
      expect(data).toHaveProperty('usedMinutes');
      expect(data).toHaveProperty('scheduledMinutes');
      expect(data).toHaveProperty('scheduledTasks');
      expect(data).toHaveProperty('projectedTotalMinutes');
      expect(data).toHaveProperty('unscheduledTasksCount');
    });

    it('returns 404 for non-existent client', async () => {
      mockClientFindUnique.mockResolvedValue(null);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: 'nonexistent' });
      const response = await GET(request, { params });

      expect(response.status).toBe(404);
    });

    it('returns empty data for future months', async () => {
      const request = createRequest('2099-12');
      const params = Promise.resolve({ id: CLIENT_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.usedMinutes).toBe(0);
      expect(data.tasks).toEqual([]);
      expect(data.scheduledTasks).toEqual([]);
    });
  });
});
