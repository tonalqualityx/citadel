import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

// Type-safe mock accessors for Prisma methods
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockTaskUpdateMany = prisma.task.updateMany as Mock;
const mockUserFindFirst = prisma.user.findFirst as Mock;

function createPatchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/tasks/bulk', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/tasks/bulk', {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const validTaskId1 = '550e8400-e29b-41d4-a716-446655440001';
const validTaskId2 = '550e8400-e29b-41d4-a716-446655440002';
const validUserId = '550e8400-e29b-41d4-a716-446655440003';

describe('PATCH /api/tasks/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  describe('Authorization', () => {
    it('requires authentication', async () => {
      mockRequireAuth.mockRejectedValue(new Error('Unauthorized'));

      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { due_date: '2024-12-31T00:00:00.000Z' },
      });

      const response = await PATCH(request);

      expect(response.status).toBe(500); // Auth errors become 500 via handleApiError
    });

    it('requires pm or admin role', async () => {
      mockTaskFindMany.mockResolvedValue([{ id: validTaskId1 }] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { due_date: '2024-12-31T00:00:00.000Z' },
      });

      await PATCH(request);

      expect(mockRequireRole).toHaveBeenCalledWith(
        expect.anything(),
        ['pm', 'admin']
      );
    });
  });

  describe('Validation', () => {
    it('requires at least one task_id', async () => {
      const request = createPatchRequest({
        task_ids: [],
        data: { due_date: '2024-12-31T00:00:00.000Z' },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('requires valid UUID task_ids', async () => {
      const request = createPatchRequest({
        task_ids: ['not-a-uuid'],
        data: { due_date: '2024-12-31T00:00:00.000Z' },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('requires at least one field to update', async () => {
      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: {},
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('validates due_date is valid datetime', async () => {
      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { due_date: 'not-a-date' },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('validates assignee_id is valid UUID', async () => {
      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { assignee_id: 'not-a-uuid' },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Task existence validation', () => {
    it('returns 404 when some tasks do not exist', async () => {
      mockTaskFindMany.mockResolvedValue([
        { id: validTaskId1 },
      ] as any);

      const request = createPatchRequest({
        task_ids: [validTaskId1, validTaskId2],
        data: { due_date: '2024-12-31T00:00:00.000Z' },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toContain('Tasks not found');
      expect(body.error).toContain(validTaskId2);
    });
  });

  describe('Assignee validation', () => {
    it('returns 404 when assignee does not exist', async () => {
      mockTaskFindMany.mockResolvedValue([
        { id: validTaskId1 },
      ] as any);
      mockUserFindFirst.mockResolvedValue(null);

      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { assignee_id: validUserId },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Assignee not found');
    });
  });

  describe('Successful updates', () => {
    beforeEach(() => {
      mockTaskFindMany.mockResolvedValue([
        { id: validTaskId1 },
        { id: validTaskId2 },
      ] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 2 });
    });

    it('updates due_date for multiple tasks', async () => {
      const dueDate = '2024-12-31T00:00:00.000Z';
      const request = createPatchRequest({
        task_ids: [validTaskId1, validTaskId2],
        data: { due_date: dueDate },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.updated).toBe(2);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: {
          id: { in: [validTaskId1, validTaskId2] },
          is_deleted: false,
        },
        data: {
          due_date: new Date(dueDate),
        },
      });
    });

    it('clears due_date when set to null', async () => {
      mockTaskFindMany.mockResolvedValue([{ id: validTaskId1 }] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { due_date: null },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { due_date: null },
        })
      );
    });

    it('updates assignee_id for multiple tasks', async () => {
      mockUserFindFirst.mockResolvedValue({ id: validUserId } as any);

      const request = createPatchRequest({
        task_ids: [validTaskId1, validTaskId2],
        data: { assignee_id: validUserId },
      });
      const response = await PATCH(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { assignee_id: validUserId },
        })
      );
    });

    it('clears assignee_id when set to null', async () => {
      mockTaskFindMany.mockResolvedValue([{ id: validTaskId1 }] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { assignee_id: null },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { assignee_id: null },
        })
      );
    });

    it('updates both due_date and assignee_id', async () => {
      mockTaskFindMany.mockResolvedValue([{ id: validTaskId1 }] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });
      mockUserFindFirst.mockResolvedValue({ id: validUserId } as any);
      const dueDate = '2024-12-31T00:00:00.000Z';

      const request = createPatchRequest({
        task_ids: [validTaskId1],
        data: { due_date: dueDate, assignee_id: validUserId },
      });
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            due_date: new Date(dueDate),
            assignee_id: validUserId,
          },
        })
      );
    });
  });
});

describe('DELETE /api/tasks/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: 'user-123',
      role: 'pm',
      email: 'pm@example.com',
    });
  });

  describe('Authorization', () => {
    it('requires authentication', async () => {
      mockRequireAuth.mockRejectedValue(new Error('Unauthorized'));

      const request = createDeleteRequest({
        task_ids: [validTaskId1],
      });

      const response = await DELETE(request);

      expect(response.status).toBe(500); // Auth errors become 500 via handleApiError
    });

    it('requires pm or admin role', async () => {
      mockTaskFindMany.mockResolvedValue([{ id: validTaskId1 }] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const request = createDeleteRequest({
        task_ids: [validTaskId1],
      });

      await DELETE(request);

      expect(mockRequireRole).toHaveBeenCalledWith(
        expect.anything(),
        ['pm', 'admin']
      );
    });
  });

  describe('Validation', () => {
    it('requires at least one task_id', async () => {
      const request = createDeleteRequest({
        task_ids: [],
      });
      const response = await DELETE(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('requires valid UUID task_ids', async () => {
      const request = createDeleteRequest({
        task_ids: ['not-a-uuid'],
      });
      const response = await DELETE(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('Task existence validation', () => {
    it('returns 404 when some tasks do not exist', async () => {
      mockTaskFindMany.mockResolvedValue([
        { id: validTaskId1 },
      ] as any);

      const request = createDeleteRequest({
        task_ids: [validTaskId1, validTaskId2],
      });
      const response = await DELETE(request);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toContain('Tasks not found');
    });
  });

  describe('Successful deletion', () => {
    it('soft deletes multiple tasks', async () => {
      mockTaskFindMany.mockResolvedValue([
        { id: validTaskId1 },
        { id: validTaskId2 },
      ] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 2 });

      const request = createDeleteRequest({
        task_ids: [validTaskId1, validTaskId2],
      });
      const response = await DELETE(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.deleted).toBe(2);
      expect(mockTaskUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: [validTaskId1, validTaskId2] } },
        data: { is_deleted: true },
      });
    });

    it('soft deletes a single task', async () => {
      mockTaskFindMany.mockResolvedValue([
        { id: validTaskId1 },
      ] as any);
      mockTaskUpdateMany.mockResolvedValue({ count: 1 });

      const request = createDeleteRequest({
        task_ids: [validTaskId1],
      });
      const response = await DELETE(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.deleted).toBe(1);
    });
  });
});
