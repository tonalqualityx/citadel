import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

// Clarity Phase 4b — PATCH /api/tasks/[id] gains arc_id: attach (validated), detach
// (explicit null), invalid-arc 404, absent-untouched, and a regression test confirming
// unrelated unknown fields are still zod-stripped. Mocking pattern mirrors the sibling
// dependency-propagation.test.ts in this same directory.

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
const mockArcFindUnique = (prisma as any).arc.findUnique as Mock;

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/tasks/task-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const makeParams = () => Promise.resolve({ id: 'task-1' });

function existingTask(overrides: Record<string, any> = {}) {
  return {
    id: 'task-1',
    status: 'in_progress',
    project: null,
    is_deleted: false,
    arc_id: null,
    ...overrides,
  };
}

function updatedTask(overrides: Record<string, any> = {}) {
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

describe('PATCH /api/tasks/[id] — arc_id (Clarity Phase 4b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'user-1', email: 'test@test.com', role: 'pm' });
  });

  it('attaches a valid arc', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockArcFindUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    mockTaskUpdate.mockResolvedValue(updatedTask({ arc_id: '11111111-1111-4111-8111-111111111111', arc: { id: '11111111-1111-4111-8111-111111111111', name: 'Demo Arc' } }));

    const response = await PATCH(makeRequest({ arc_id: '11111111-1111-4111-8111-111111111111' }), { params: makeParams() });
    expect(response.status).toBe(200);

    expect(mockArcFindUnique).toHaveBeenCalledWith({ where: { id: '11111111-1111-4111-8111-111111111111' }, select: { id: true } });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ arc_id: '11111111-1111-4111-8111-111111111111' }) })
    );

    const body = await response.json();
    expect(body.arc_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('detaches an arc when arc_id is explicitly null', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ arc_id: '11111111-1111-4111-8111-111111111111' }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ arc_id: null, arc: null }));

    const response = await PATCH(makeRequest({ arc_id: null }), { params: makeParams() });
    expect(response.status).toBe(200);

    // Explicit null never needs an existence check.
    expect(mockArcFindUnique).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ arc_id: null }) })
    );
  });

  it('returns 404 when arc_id references a nonexistent arc', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockArcFindUnique.mockResolvedValue(null);

    const response = await PATCH(makeRequest({ arc_id: '00000000-0000-0000-0000-000000000000' }), {
      params: makeParams(),
    });

    expect(response.status).toBe(404);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it('leaves arc_id untouched when absent from the request body', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask({ arc_id: 'arc-existing' }));
    mockTaskUpdate.mockResolvedValue(updatedTask({ arc_id: 'arc-existing', arc: { id: 'arc-existing', name: 'Existing' } }));

    const response = await PATCH(makeRequest({ title: 'Renamed' }), { params: makeParams() });
    expect(response.status).toBe(200);

    expect(mockArcFindUnique).not.toHaveBeenCalled();
    const updateCall = mockTaskUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('arc_id');
  });

  it('regression: unknown/unrelated fields are still stripped by zod, even alongside a valid arc_id', async () => {
    mockTaskFindUnique.mockResolvedValue(existingTask());
    mockArcFindUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    mockTaskUpdate.mockResolvedValue(updatedTask({ arc_id: '11111111-1111-4111-8111-111111111111', arc: { id: '11111111-1111-4111-8111-111111111111', name: 'Demo Arc' } }));

    const response = await PATCH(
      makeRequest({ arc_id: '11111111-1111-4111-8111-111111111111', this_field_does_not_exist: 'should be stripped' }),
      { params: makeParams() }
    );
    expect(response.status).toBe(200);

    const updateCall = mockTaskUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('this_field_does_not_exist');
  });
});
