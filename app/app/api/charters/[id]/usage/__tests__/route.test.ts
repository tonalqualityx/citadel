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

function createRequest(period?: string): NextRequest {
  const url = period
    ? `http://localhost:3000/api/charters/${CHARTER_ID}/usage?period=${period}`
    : `http://localhost:3000/api/charters/${CHARTER_ID}/usage`;
  return new NextRequest(url, { method: 'GET' });
}

function makeTask(overrides: Partial<{
  id: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  is_retainer_work: boolean;
  project_id: string | null;
  project: { id: string; name: string } | null;
  time_entries: { duration: number | null }[];
}> = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    status: 'in_progress',
    estimated_minutes: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    is_retainer_work: false,
    project_id: null,
    project: null,
    time_entries: [],
    ...overrides,
  };
}

const mockCharter = {
  id: CHARTER_ID,
  budget_hours: 20,
  hourly_rate: 150,
  charter_commissions: [],
};

describe('GET /api/charters/[id]/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
    mockCharterFindFirst.mockResolvedValue(mockCharter);
    mockTaskFindMany.mockResolvedValue([]);
  });

  describe('Basic response shape', () => {
    it('returns correct structure', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('charter_id', CHARTER_ID);
      expect(data).toHaveProperty('period', '2026-05');
      expect(data).toHaveProperty('budget_hours', 20);
      expect(data).toHaveProperty('hourly_rate', 150);
      expect(data).toHaveProperty('used_hours');
      expect(data).toHaveProperty('planned_low_hours');
      expect(data).toHaveProperty('planned_high_hours');
      expect(data).toHaveProperty('commission_allocations');
      expect(data).toHaveProperty('total_allocated_hours');
      expect(data).toHaveProperty('tasks_count');
      expect(data).toHaveProperty('tasks');
    });

    it('returns 404 for non-existent charter', async () => {
      mockCharterFindFirst.mockResolvedValue(null);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: 'nonexistent' });
      const response = await GET(request, { params });

      expect(response.status).toBe(404);
    });

    it('defaults period to current month when not provided', async () => {
      const request = createRequest(); // no period
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      const now = new Date();
      const expectedPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      expect(data.period).toBe(expectedPeriod);
    });
  });

  describe('Task type classification', () => {
    it('classifies charter tasks with is_retainer_work=true as scheduled', async () => {
      const task = makeTask({
        id: 'scheduled-task',
        is_retainer_work: true,
        project_id: null,
      });
      mockTaskFindMany.mockResolvedValueOnce([task]); // charter tasks
      // no commission tasks since no commissions

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].task_type).toBe('scheduled');
    });

    it('classifies charter tasks with is_retainer_work=false as ad_hoc', async () => {
      const task = makeTask({
        id: 'adhoc-task',
        is_retainer_work: false,
        project_id: null,
      });
      mockTaskFindMany.mockResolvedValueOnce([task]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].task_type).toBe('ad_hoc');
    });

    it('classifies tasks with project_id as commission', async () => {
      const commissionProject = { id: 'proj-1', name: 'Website Redesign' };
      const charterWithCommission = {
        ...mockCharter,
        charter_commissions: [
          {
            commission_id: 'proj-1',
            allocated_hours_per_period: 10,
            commission: { id: 'proj-1', name: 'Website Redesign' },
          },
        ],
      };
      mockCharterFindFirst.mockResolvedValue(charterWithCommission);

      // Charter tasks (none)
      mockTaskFindMany.mockResolvedValueOnce([]);
      // Commission tasks
      const commissionTask = makeTask({
        id: 'commission-task',
        project_id: 'proj-1',
        project: commissionProject,
        is_retainer_work: false,
      });
      mockTaskFindMany.mockResolvedValueOnce([commissionTask]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      const ct = data.tasks.find((t: { id: string }) => t.id === 'commission-task');
      expect(ct).toBeDefined();
      expect(ct.task_type).toBe('commission');
      expect(ct.project_name).toBe('Website Redesign');
    });
  });

  describe('Commission task inclusion', () => {
    const charterWithCommission = {
      ...mockCharter,
      charter_commissions: [
        {
          commission_id: 'proj-1',
          allocated_hours_per_period: 8,
          commission: { id: 'proj-1', name: 'Project Alpha' },
        },
      ],
    };

    it('includes tasks from commission projects in the response', async () => {
      mockCharterFindFirst.mockResolvedValue(charterWithCommission);

      // Charter tasks
      mockTaskFindMany.mockResolvedValueOnce([
        makeTask({ id: 'charter-task', is_retainer_work: true }),
      ]);
      // Commission tasks
      mockTaskFindMany.mockResolvedValueOnce([
        makeTask({
          id: 'commission-task',
          project_id: 'proj-1',
          project: { id: 'proj-1', name: 'Project Alpha' },
        }),
      ]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks_count).toBe(2);
      expect(data.tasks).toHaveLength(2);
      const types = data.tasks.map((t: { task_type: string }) => t.task_type);
      expect(types).toContain('scheduled');
      expect(types).toContain('commission');
    });

    it('does not query commission tasks when charter has no commissions', async () => {
      mockCharterFindFirst.mockResolvedValue(mockCharter); // no commissions
      mockTaskFindMany.mockResolvedValue([]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      await GET(request, { params });

      // Only one findMany call (charter tasks), no commission query
      expect(mockTaskFindMany).toHaveBeenCalledTimes(1);
    });

    it('queries commission tasks with charter_id: null to exclude charter-linked tasks', async () => {
      mockCharterFindFirst.mockResolvedValue(charterWithCommission);
      mockTaskFindMany.mockResolvedValueOnce([]); // charter tasks
      mockTaskFindMany.mockResolvedValueOnce([]); // commission tasks

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      await GET(request, { params });

      // Second call is commission tasks
      expect(mockTaskFindMany).toHaveBeenCalledTimes(2);
      const commissionCall = mockTaskFindMany.mock.calls[1][0];
      expect(commissionCall.where.charter_id).toBeNull();
    });

    it('filters commission tasks by project_id in commissionProjectIds', async () => {
      mockCharterFindFirst.mockResolvedValue(charterWithCommission);
      mockTaskFindMany.mockResolvedValueOnce([]); // charter tasks
      mockTaskFindMany.mockResolvedValueOnce([]); // commission tasks

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      await GET(request, { params });

      const commissionCall = mockTaskFindMany.mock.calls[1][0];
      expect(commissionCall.where.project_id).toEqual({ in: ['proj-1'] });
    });
  });

  describe('Commission allocation data', () => {
    it('returns commission_allocations array and total_allocated_hours', async () => {
      const charterWithCommissions = {
        ...mockCharter,
        charter_commissions: [
          {
            commission_id: 'proj-1',
            allocated_hours_per_period: 8,
            commission: { id: 'proj-1', name: 'Project Alpha' },
          },
          {
            commission_id: 'proj-2',
            allocated_hours_per_period: 4,
            commission: { id: 'proj-2', name: 'Project Beta' },
          },
        ],
      };
      mockCharterFindFirst.mockResolvedValue(charterWithCommissions);
      mockTaskFindMany.mockResolvedValueOnce([]); // charter tasks
      mockTaskFindMany.mockResolvedValueOnce([]); // commission tasks

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.commission_allocations).toHaveLength(2);
      expect(data.commission_allocations[0]).toEqual({
        commission_id: 'proj-1',
        commission_name: 'Project Alpha',
        allocated_hours_per_period: 8,
      });
      expect(data.commission_allocations[1]).toEqual({
        commission_id: 'proj-2',
        commission_name: 'Project Beta',
        allocated_hours_per_period: 4,
      });
      expect(data.total_allocated_hours).toBe(12);
    });

    it('returns empty allocations when no commissions', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.commission_allocations).toEqual([]);
      expect(data.total_allocated_hours).toBe(0);
    });
  });

  describe('Period scoping for commissions', () => {
    it('passes period-based filters to charter query for commission scoping', async () => {
      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      await GET(request, { params });

      const charterCall = mockCharterFindFirst.mock.calls[0][0];
      const commissionWhere = charterCall.select.charter_commissions.where;

      expect(commissionWhere.is_active).toBe(true);
      expect(commissionWhere.start_period).toEqual({ lte: '2026-05' });
      expect(commissionWhere.OR).toEqual([
        { end_period: null },
        { end_period: { gte: '2026-05' } },
      ]);
    });
  });

  describe('Estimate calculations', () => {
    it('computes estimate_low_minutes as base energy minutes', async () => {
      // energy_estimate=3 => 60 minutes base
      // mystery_factor='none' => 1.0, battery_impact='average_drain' => 1.1
      // low = 60 (base), high = round(60 * 1.0 * 1.1) = 66
      const task = makeTask({
        id: 'est-task',
        energy_estimate: 3,
        mystery_factor: 'none',
        battery_impact: 'average_drain',
        is_retainer_work: true,
      });
      mockTaskFindMany.mockResolvedValueOnce([task]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks[0].estimate_low_minutes).toBe(60);
      expect(data.tasks[0].estimate_high_minutes).toBe(66);
    });

    it('computes high estimate with mystery and battery multipliers', async () => {
      // energy_estimate=2 => 30 minutes base
      // mystery_factor='average' => 1.61, battery_impact='high_drain' => 1.61
      // low = 30, high = round(30 * 1.61 * 1.61) = round(77.763) = 78
      const task = makeTask({
        id: 'complex-task',
        energy_estimate: 2,
        mystery_factor: 'average',
        battery_impact: 'high_drain',
        is_retainer_work: true,
      });
      mockTaskFindMany.mockResolvedValueOnce([task]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks[0].estimate_low_minutes).toBe(30);
      expect(data.tasks[0].estimate_high_minutes).toBe(78);
    });

    it('returns null estimates when energy_estimate is null', async () => {
      const task = makeTask({
        id: 'no-est-task',
        energy_estimate: null,
        is_retainer_work: true,
      });
      mockTaskFindMany.mockResolvedValueOnce([task]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks[0].estimate_low_minutes).toBeNull();
      expect(data.tasks[0].estimate_high_minutes).toBeNull();
    });

    it('sums time_entries for time_spent_minutes', async () => {
      const task = makeTask({
        id: 'time-task',
        is_retainer_work: true,
        time_entries: [{ duration: 30 }, { duration: 45 }, { duration: null }],
      });
      mockTaskFindMany.mockResolvedValueOnce([task]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.tasks[0].time_spent_minutes).toBe(75);
    });
  });

  describe('Summary calculations', () => {
    it('calculates used_hours, planned hours, and amounts correctly', async () => {
      // Completed task: 90 minutes spent
      const completedTask = makeTask({
        id: 'done-task',
        status: 'done',
        is_retainer_work: true,
        energy_estimate: 2,
        mystery_factor: 'none',
        battery_impact: 'average_drain',
        time_entries: [{ duration: 90 }],
      });
      // Planned task: energy=3 (60min base), mystery=none(1.0), battery=average_drain(1.1)
      // low=60, high=66
      const plannedTask = makeTask({
        id: 'planned-task',
        status: 'in_progress',
        is_retainer_work: true,
        energy_estimate: 3,
        mystery_factor: 'none',
        battery_impact: 'average_drain',
        time_entries: [{ duration: 10 }],
      });
      mockTaskFindMany.mockResolvedValueOnce([completedTask, plannedTask]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      // Total spent = 90 + 10 = 100 minutes = 100/60 hours
      expect(data.used_hours).toBeCloseTo(100 / 60, 5);
      // Planned low = 60 (only from planned/in-progress tasks)
      expect(data.planned_low_hours).toBe(60 / 60);
      // Planned high = 66
      expect(data.planned_high_hours).toBe(66 / 60);
      // spent_amount = used_hours * 150
      expect(data.spent_amount).toBeCloseTo((100 / 60) * 150, 5);
      // budget_amount = 20 * 150
      expect(data.budget_amount).toBe(3000);
    });

    it('returns null amounts when hourly_rate is null', async () => {
      mockCharterFindFirst.mockResolvedValue({
        ...mockCharter,
        hourly_rate: null,
      });
      mockTaskFindMany.mockResolvedValueOnce([]);

      const request = createRequest('2026-05');
      const params = Promise.resolve({ id: CHARTER_ID });
      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.spent_amount).toBeNull();
      expect(data.anticipated_low_amount).toBeNull();
      expect(data.anticipated_high_amount).toBeNull();
    });
  });
});
