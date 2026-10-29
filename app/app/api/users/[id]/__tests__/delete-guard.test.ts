import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE } from '../route';

// Designer Portal (design D1): a user with design sessions or publishes is never hard-deleted.
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    task: { count: vi.fn() },
    designSession: { count: vi.fn() },
    designPublish: { count: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockUserUpdate = prisma.user.update as Mock;
const mockUserDelete = prisma.user.delete as Mock;
const mockTaskCount = prisma.task.count as Mock;
const mockSessionCount = prisma.designSession.count as Mock;
const mockPublishCount = prisma.designPublish.count as Mock;

const del = (id: string) =>
  DELETE(new NextRequest(`http://localhost:3000/api/users/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });

describe('DELETE /api/users/[id] design guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'admin-user', role: 'admin', email: 'admin@example.com' });
    mockUserFindUnique.mockResolvedValue({ id: 'designer-1', name: 'Lisa' });
    mockTaskCount.mockResolvedValue(0);
    mockSessionCount.mockResolvedValue(0);
    mockPublishCount.mockResolvedValue(0);
    mockUserUpdate.mockResolvedValue({});
    mockUserDelete.mockResolvedValue({});
  });

  it('409 when the user has design sessions; nothing deleted or deactivated', async () => {
    mockSessionCount.mockResolvedValue(2);
    const res = await del('designer-1');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/deactivate instead/);
    expect(mockSessionCount).toHaveBeenCalledWith({ where: { designer_id: 'designer-1' } });
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('409 when the user has design publishes', async () => {
    mockPublishCount.mockResolvedValue(1);
    const res = await del('designer-1');
    expect(res.status).toBe(409);
    expect(mockPublishCount).toHaveBeenCalledWith({ where: { actor_id: 'designer-1' } });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it('no design rows and no tasks: hard delete as today', async () => {
    const res = await del('designer-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: 'designer-1' } });
  });

  it('no design rows, assigned tasks: deactivated as today', async () => {
    mockTaskCount.mockResolvedValue(3);
    const res = await del('designer-1');
    expect(res.status).toBe(200);
    expect((await res.json()).deactivated).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: 'designer-1' }, data: { is_active: false } });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it('self-delete stays 400 and missing user stays 404', async () => {
    expect((await del('admin-user')).status).toBe(400);
    mockUserFindUnique.mockResolvedValue(null);
    expect((await del('ghost')).status).toBe(404);
    expect(mockSessionCount).not.toHaveBeenCalled();
  });
});
