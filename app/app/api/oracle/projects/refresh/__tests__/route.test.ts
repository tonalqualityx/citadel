import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { updateMany: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectUpdateMany = prisma.project.updateMany as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectUpdateMany.mockResolvedValue({ count: 6 });
});

describe('POST /api/oracle/projects/refresh', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it('stamps every in-progress, type=project project and returns 202 with the count', async () => {
    const res = await POST();
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.count).toBe(6);
    expect(body.requested_at).toBeTruthy();
    expect(mockProjectUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'project', status: 'in_progress', is_deleted: false },
        data: expect.objectContaining({ next_step_refresh_requested_at: expect.any(Date) }),
      })
    );
  });
});
