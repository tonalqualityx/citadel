import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;

const PROJECT_ID = 'project-1';
const params = Promise.resolve({ id: PROJECT_ID });

function req(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/projects/${PROJECT_ID}/refresh`, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID });
  mockProjectUpdate.mockResolvedValue({});
});

describe('POST /api/oracle/projects/[id]/refresh', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
  });

  it('stamps next_step_refresh_requested_at and returns 202', async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.requested_at).toBeTruthy();
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_ID },
        data: expect.objectContaining({ next_step_refresh_requested_at: expect.any(Date) }),
      })
    );
  });
});
