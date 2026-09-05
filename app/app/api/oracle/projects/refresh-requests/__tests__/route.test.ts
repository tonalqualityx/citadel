import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findMany: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockProjectFindMany = prisma.project.findMany as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'bot-1', role: 'admin', email: 'oracle@indelible.bot' });
  mockProjectFindMany.mockResolvedValue([]);
});

describe('GET /api/oracle/projects/refresh-requests', () => {
  it('requires auth (any authenticated user, not role-gated)', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('queries only projects with a non-null refresh request, oldest first', async () => {
    await GET();
    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { next_step_refresh_requested_at: { not: null }, is_deleted: false },
        orderBy: { next_step_refresh_requested_at: 'asc' },
      })
    );
  });

  it('returns ids and full request rows', async () => {
    mockProjectFindMany.mockResolvedValue([
      { id: 'proj-a', next_step_refresh_requested_at: new Date('2026-09-04T01:00:00.000Z') },
      { id: 'proj-b', next_step_refresh_requested_at: new Date('2026-09-04T02:00:00.000Z') },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body.ids).toEqual(['proj-a', 'proj-b']);
    expect(body.requests).toEqual([
      { id: 'proj-a', requested_at: '2026-09-04T01:00:00.000Z' },
      { id: 'proj-b', requested_at: '2026-09-04T02:00:00.000Z' },
    ]);
  });

  it('returns an empty list when nothing is queued', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.ids).toEqual([]);
    expect(body.requests).toEqual([]);
  });
});
