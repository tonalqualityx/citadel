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
    charter: {
      findFirst: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockCharterFindFirst = prisma.charter.findFirst as Mock;
const mockTaskFindMany = prisma.task.findMany as Mock;

const CHARTER_ID = 'charter-abc';
const COMMISSION_ID_1 = 'commission-1';
const COMMISSION_ID_2 = 'commission-2';

function createRequest(period?: string): NextRequest {
  const url = period
    ? `http://localhost:3000/api/charters/${CHARTER_ID}/commission-tasks?period=${period}`
    : `http://localhost:3000/api/charters/${CHARTER_ID}/commission-tasks`;
  return new NextRequest(url, { method: 'GET' });
}

describe('GET /api/charters/[id]/commission-tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  describe('Returns empty array when no commissions linked', () => {
    it('returns { tasks: [] } when charter has no charter_commissions', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [],
      });

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ tasks: [] });
      // Should NOT call task.findMany when there are no commissions
      expect(mockTaskFindMany).not.toHaveBeenCalled();
    });
  });

  describe('Returns tasks from linked commission projects', () => {
    it('queries tasks from commission project IDs', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [
          { commission_id: COMMISSION_ID_1 },
          { commission_id: COMMISSION_ID_2 },
        ],
      });

      mockTaskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Commission Task',
          status: 'in_progress',
          priority: 'medium',
          energy_estimate: 2,
          mystery_factor: 'known',
          battery_impact: 'average_drain',
          estimated_minutes: 60,
          due_date: null,
          started_at: null,
          completed_at: null,
          needs_review: false,
          approved: false,
          project_id: COMMISSION_ID_1,
          project: { id: COMMISSION_ID_1, name: 'Commission Project 1' },
          assignee_id: null,
          assignee: null,
          time_entries: [{ duration: 30 }, { duration: 15 }],
        },
      ]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].id).toBe('task-1');

      // Verify task.findMany was called with the commission IDs
      const where = mockTaskFindMany.mock.calls[0][0].where;
      expect(where.project_id).toEqual({ in: [COMMISSION_ID_1, COMMISSION_ID_2] });
    });
  });

  describe('Excludes tasks with charter_id set', () => {
    it('filters for charter_id: null in the task query', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [{ commission_id: COMMISSION_ID_1 }],
      });

      mockTaskFindMany.mockResolvedValue([]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      await GET(request, { params });

      const where = mockTaskFindMany.mock.calls[0][0].where;
      expect(where.charter_id).toBeNull();
    });
  });

  describe('Period filtering for commissions', () => {
    it('filters charter_commissions by start_period and end_period against the period', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [],
      });

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      await GET(request, { params });

      const findFirstArgs = mockCharterFindFirst.mock.calls[0][0];
      const commissionWhere = findFirstArgs.select.charter_commissions.where;

      expect(commissionWhere.is_active).toBe(true);
      expect(commissionWhere.start_period).toEqual({ lte: '2026-05' });
      expect(commissionWhere.OR).toEqual([
        { end_period: null },
        { end_period: { gte: '2026-05' } },
      ]);
    });
  });

  describe('Period filtering for tasks', () => {
    it('includes done/abandoned tasks only if completed_at is within the period', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [{ commission_id: COMMISSION_ID_1 }],
      });

      mockTaskFindMany.mockResolvedValue([]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      await GET(request, { params });

      const where = mockTaskFindMany.mock.calls[0][0].where;

      // Should have OR with two branches
      expect(where.OR).toHaveLength(2);

      // Branch 1: done/abandoned with completed_at in period
      const doneBranch = where.OR[0];
      expect(doneBranch.status).toEqual({ in: ['done', 'abandoned'] });
      expect(doneBranch.completed_at.gte).toEqual(new Date(2026, 4, 1));
      expect(doneBranch.completed_at.lte).toEqual(new Date(2026, 4, 31, 23, 59, 59));

      // Branch 2: active tasks (not done/abandoned)
      const activeBranch = where.OR[1];
      expect(activeBranch.status).toEqual({ notIn: ['done', 'abandoned'] });
    });

    it('always includes active (non-done/abandoned) tasks regardless of dates', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [{ commission_id: COMMISSION_ID_1 }],
      });

      const activeTask = {
        id: 'task-active',
        title: 'Active Task',
        status: 'in_progress',
        priority: 'medium',
        energy_estimate: 2,
        mystery_factor: 'known',
        battery_impact: 'average_drain',
        estimated_minutes: null,
        due_date: null,
        started_at: null,
        completed_at: null,
        needs_review: false,
        approved: false,
        project_id: COMMISSION_ID_1,
        project: { id: COMMISSION_ID_1, name: 'Commission Project' },
        assignee_id: null,
        assignee: null,
        time_entries: [],
      };

      mockTaskFindMany.mockResolvedValue([activeTask]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].id).toBe('task-active');
    });
  });

  describe('Task formatting', () => {
    it('calculates time_spent_minutes from time_entries', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [{ commission_id: COMMISSION_ID_1 }],
      });

      mockTaskFindMany.mockResolvedValue([
        {
          id: 'task-1',
          title: 'Task With Time',
          status: 'in_progress',
          priority: 'high',
          energy_estimate: 3,
          mystery_factor: 'known',
          battery_impact: 'high_drain',
          estimated_minutes: 120,
          due_date: null,
          started_at: new Date('2026-05-01'),
          completed_at: null,
          needs_review: false,
          approved: false,
          project_id: COMMISSION_ID_1,
          project: { id: COMMISSION_ID_1, name: 'Commission Project' },
          assignee_id: 'user-1',
          assignee: { id: 'user-1', name: 'Test User' },
          time_entries: [
            { duration: 30 },
            { duration: 45 },
            { duration: 15 },
          ],
        },
      ]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks[0].time_spent_minutes).toBe(90);
      // time_entries should be stripped from the response
      expect(data.tasks[0].time_entries).toBeUndefined();
    });

    it('returns 0 time_spent_minutes when no time entries exist', async () => {
      mockCharterFindFirst.mockResolvedValue({
        id: CHARTER_ID,
        charter_commissions: [{ commission_id: COMMISSION_ID_1 }],
      });

      mockTaskFindMany.mockResolvedValue([
        {
          id: 'task-2',
          title: 'No Time Logged',
          status: 'todo',
          priority: 'low',
          energy_estimate: 1,
          mystery_factor: 'unknown',
          battery_impact: 'average_drain',
          estimated_minutes: null,
          due_date: null,
          started_at: null,
          completed_at: null,
          needs_review: false,
          approved: false,
          project_id: COMMISSION_ID_1,
          project: { id: COMMISSION_ID_1, name: 'Commission Project' },
          assignee_id: null,
          assignee: null,
          time_entries: [],
        },
      ]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks[0].time_spent_minutes).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('returns 404 when charter not found', async () => {
      mockCharterFindFirst.mockResolvedValue(null);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: 'nonexistent' });
      const response = await GET(request, { params });

      expect(response.status).toBe(404);
    });
  });
});
