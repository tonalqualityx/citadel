import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
    },
    todayPick: {
      findMany: vi.fn(),
    },
    userPreference: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockTaskFindMany = prisma.task.findMany as Mock;
const mockPickFindMany = prisma.todayPick.findMany as Mock;
const mockUserPreferenceFindUnique = prisma.userPreference.findUnique as Mock;

function getRequest(params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`http://localhost:3000/api/today/due-soon?${searchParams.toString()}`);
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'A task',
    status: 'not_started',
    priority: 3,
    due_date: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockUserPreferenceFindUnique.mockResolvedValue({ timezone: 'America/New_York' });
  mockTaskFindMany.mockResolvedValue([]);
  mockPickFindMany.mockResolvedValue([]);
});

describe('GET /api/today/due-soon', () => {
  it('returns tasks due within 24h', async () => {
    const now = Date.now();
    mockTaskFindMany.mockResolvedValue([
      task({ id: 't-soon', due_date: new Date(now + 2 * 60 * 60 * 1000) }),
      task({ id: 't-far', due_date: new Date(now + 48 * 60 * 60 * 1000) }),
      task({ id: 't-past', due_date: new Date(now - 60 * 1000) }),
    ]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(['t-soon']);
    expect(body.meta.total).toBe(1);
  });

  it('excludes a task already picked for today', async () => {
    const now = Date.now();
    mockTaskFindMany.mockResolvedValue([
      task({ id: 't-picked', due_date: new Date(now + 2 * 60 * 60 * 1000) }),
    ]);
    mockPickFindMany.mockResolvedValue([{ task_id: 't-picked' }]);

    const res = await GET(getRequest());
    const body = await res.json();

    expect(body.tasks).toEqual([]);
  });

  it('only queries not-done/not-abandoned tasks assigned to the requester', async () => {
    await GET(getRequest());

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignee_id: 'user-123',
          status: { notIn: ['done', 'abandoned'] },
          due_date: { not: null },
        }),
      })
    );
  });

  it('resolves the "today" date in the requester\'s own timezone, not UTC', async () => {
    const res = await GET(getRequest());
    const body = await res.json();
    expect(body.timezone).toBe('America/New_York');
  });

  it('requires admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await GET(getRequest());
    expect(res.status).toBe(403);
  });

  describe('Clarity Phase 4b — arc-picked exclusion', () => {
    it('excludes a due-soon task whose ARC (not the task itself) was picked for today', async () => {
      const now = Date.now();
      mockTaskFindMany.mockResolvedValue([
        task({ id: 't-arc-picked', arc_id: 'arc-1', due_date: new Date(now + 2 * 60 * 60 * 1000) }),
      ]);
      mockPickFindMany.mockImplementation((args: any) => {
        if (args.where.item_type === 'arc') return Promise.resolve([{ arc_id: 'arc-1' }]);
        return Promise.resolve([]);
      });

      const res = await GET(getRequest());
      const body = await res.json();

      expect(body.tasks).toEqual([]);
    });

    it('includes a due-soon task whose arc was NOT picked for today', async () => {
      const now = Date.now();
      mockTaskFindMany.mockResolvedValue([
        task({ id: 't-arc-not-picked', arc_id: 'arc-2', due_date: new Date(now + 2 * 60 * 60 * 1000) }),
      ]);
      mockPickFindMany.mockImplementation((args: any) => {
        if (args.where.item_type === 'arc') return Promise.resolve([{ arc_id: 'arc-1' }]);
        return Promise.resolve([]);
      });

      const res = await GET(getRequest());
      const body = await res.json();

      expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(['t-arc-not-picked']);
    });

    it('includes a due-soon task with no arc at all', async () => {
      const now = Date.now();
      mockTaskFindMany.mockResolvedValue([
        task({ id: 't-no-arc', arc_id: null, due_date: new Date(now + 2 * 60 * 60 * 1000) }),
      ]);
      mockPickFindMany.mockImplementation((args: any) => {
        if (args.where.item_type === 'arc') return Promise.resolve([{ arc_id: 'arc-1' }]);
        return Promise.resolve([]);
      });

      const res = await GET(getRequest());
      const body = await res.json();

      expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(['t-no-arc']);
    });
  });
});
