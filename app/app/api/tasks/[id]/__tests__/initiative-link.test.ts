import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

// PATCH on a task: initiative_id sets, clears (null), refuses a missing or deleted initiative, and is left alone when
// absent. A process change is a task (a Triage card of kind rule_proposal), so the same link covers it.

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
    arc: {
      findUnique: vi.fn(),
    },
    initiative: {
      findFirst: vi.fn(),
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

vi.mock('@/lib/calculations/energy', () => ({
  calculateEstimatedMinutes: vi.fn((energy: number) => energy * 30),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockTaskUpdate = prisma.task.update as Mock;
const mockInitiativeFindFirst = prisma.initiative.findFirst as Mock;
const INITIATIVE = '33333333-3333-4333-8333-333333333333';

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
    initiative_id: null,
    ...overrides,
  };
}

function updatedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    status: 'in_progress',
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

describe('PATCH task: initiative_id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com', role: 'pm' });
  });

  it('links a task to an existing initiative', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockInitiativeFindFirst.mockResolvedValue({ id: INITIATIVE });
    mockTaskUpdate.mockResolvedValue(updatedTask({ initiative_id: INITIATIVE }));

    const response = await PATCH(makeRequest({ initiative_id: INITIATIVE }), { params: makeParams() });
    expect(response.status).toBe(200);
    expect(mockInitiativeFindFirst).toHaveBeenCalledWith({ where: { id: INITIATIVE, is_deleted: false }, select: { id: true } });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ initiative_id: INITIATIVE }) })
    );
    expect((await response.json()).initiative_id).toBe(INITIATIVE);
  });

  it('links a process change: a rule_proposal Triage card', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ status: 'triage', triage_kind: 'rule_proposal' }));
    mockInitiativeFindFirst.mockResolvedValue({ id: INITIATIVE });
    mockTaskUpdate.mockResolvedValue(updatedTask({ status: 'triage', triage_kind: 'rule_proposal', initiative_id: INITIATIVE }));

    const response = await PATCH(makeRequest({ initiative_id: INITIATIVE }), { params: makeParams() });
    expect(response.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ initiative_id: INITIATIVE }) })
    );
    expect((await response.json()).initiative_id).toBe(INITIATIVE);
  });

  it('clears the link with an explicit null, without an existence check', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ initiative_id: INITIATIVE }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ initiative_id: null }));

    const response = await PATCH(makeRequest({ initiative_id: null }), { params: makeParams() });
    expect(response.status).toBe(200);
    expect(mockInitiativeFindFirst).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ initiative_id: null }) })
    );
  });

  it('returns 404 and writes nothing for a missing or deleted initiative', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockInitiativeFindFirst.mockResolvedValue(null);

    const response = await PATCH(makeRequest({ initiative_id: INITIATIVE }), { params: makeParams() });
    expect(response.status).toBe(404);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('rejects an initiative_id that is not a uuid', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    const response = await PATCH(makeRequest({ initiative_id: 'not-a-uuid' }), { params: makeParams() });
    expect(response.status).toBe(400);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('leaves the link untouched when absent', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ initiative_id: INITIATIVE }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ initiative_id: INITIATIVE }));

    const response = await PATCH(makeRequest({ title: 'Renamed' }), { params: makeParams() });
    expect(response.status).toBe(200);
    expect(mockInitiativeFindFirst).not.toHaveBeenCalled();
    expect(mockTaskUpdate.mock.calls[0][0].data).not.toHaveProperty('initiative_id');
  });
});
