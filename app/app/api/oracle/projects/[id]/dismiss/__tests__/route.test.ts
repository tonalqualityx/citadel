import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST, DELETE } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    blockerDismissal: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
  logDelete: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockDismissalCreate = prisma.blockerDismissal.create as Mock;
const mockDismissalFindUnique = prisma.blockerDismissal.findUnique as Mock;
const mockDismissalDelete = prisma.blockerDismissal.delete as Mock;

const PROJECT_ID = 'proj-1';
const params = Promise.resolve({ id: PROJECT_ID });

function postReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/projects/${PROJECT_ID}/dismiss`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function deleteReq(qs = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/projects/${PROJECT_ID}/dismiss${qs}`, {
    method: 'DELETE',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Herba rebuild' });
  mockDismissalCreate.mockResolvedValue({
    id: 'dismissal-1',
    project_id: PROJECT_ID,
    kind: 'task',
    source_id: 'task-1',
    source_marker: '2026-09-01T00:00:00.000Z',
    note: null,
    dismissed_at: new Date('2026-09-04T00:00:00.000Z'),
    dismissed_by: { id: 'mike-1', name: 'Mike' },
  });
  mockDismissalFindUnique.mockResolvedValue({ id: 'dismissal-1', project_id: PROJECT_ID, kind: 'task' });
  mockDismissalDelete.mockResolvedValue({});
});

describe('POST /api/oracle/projects/[id]/dismiss', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await POST(postReq({ kind: 'task', source_id: 'task-1' }), { params });
    expect(res.status).toBe(403);
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await POST(postReq({ kind: 'task', source_id: 'task-1' }), { params });
    expect(res.status).toBe(404);
  });

  it('400s on an invalid kind', async () => {
    const res = await POST(postReq({ kind: 'bogus', source_id: 'task-1' }), { params });
    expect(res.status).toBe(400);
  });

  it('creates a BlockerDismissal row', async () => {
    const res = await POST(postReq({ kind: 'task', source_id: 'task-1', source_marker: '2026-09-01T00:00:00.000Z' }), {
      params,
    });
    expect(res.status).toBe(201);
    expect(mockDismissalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          project_id: PROJECT_ID,
          kind: 'task',
          source_id: 'task-1',
          source_marker: '2026-09-01T00:00:00.000Z',
          dismissed_by_id: 'mike-1',
        }),
      })
    );
  });

  it('accepts an optional note', async () => {
    await POST(postReq({ kind: 'stale', source_id: PROJECT_ID, note: 'Client on vacation until next month.' }), {
      params,
    });
    expect(mockDismissalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ note: 'Client on vacation until next month.' }) })
    );
  });
});

describe('DELETE /api/oracle/projects/[id]/dismiss', () => {
  it('400s without a dismissal_id', async () => {
    const res = await DELETE(deleteReq(), { params });
    expect(res.status).toBe(400);
  });

  it('404s when the dismissal does not exist', async () => {
    mockDismissalFindUnique.mockResolvedValue(null);
    const res = await DELETE(deleteReq('?dismissal_id=11111111-1111-1111-8111-111111111111'), { params });
    expect(res.status).toBe(404);
  });

  it("404s when the dismissal belongs to a DIFFERENT project", async () => {
    mockDismissalFindUnique.mockResolvedValue({ id: 'dismissal-1', project_id: 'some-other-project', kind: 'task' });
    const res = await DELETE(deleteReq('?dismissal_id=11111111-1111-1111-8111-111111111111'), { params });
    expect(res.status).toBe(404);
    expect(mockDismissalDelete).not.toHaveBeenCalled();
  });

  it('deletes the dismissal row on success', async () => {
    const res = await DELETE(deleteReq('?dismissal_id=11111111-1111-1111-8111-111111111111'), { params });
    expect(res.status).toBe(200);
    expect(mockDismissalDelete).toHaveBeenCalledWith({ where: { id: '11111111-1111-1111-8111-111111111111' } });
  });
});
