import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH, DELETE } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logUpdate: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logUpdate } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockLogUpdate = logUpdate as Mock;

const PROJECT_ID = 'project-1';

function req(body: unknown, method: 'PATCH' | 'DELETE' = 'PATCH'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/oracle/projects/${PROJECT_ID}/next-step`, {
    method,
    body: method === 'DELETE' ? undefined : JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: PROJECT_ID });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Herba rebuild' });
  mockProjectUpdate.mockResolvedValue({
    next_step_text: 'Call the client',
    next_step_owner: null,
    next_step_owner_label: null,
    next_step_source: 'mike',
    next_step_at: new Date('2026-09-04T00:00:00.000Z'),
  });
  mockUserFindUnique.mockResolvedValue({ id: 'user-1' });
});

describe('PATCH /api/oracle/projects/[id]/next-step', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await PATCH(req({ text: 'Call the client' }), { params });
    expect(res.status).toBe(403);
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await PATCH(req({ text: 'Call the client' }), { params });
    expect(res.status).toBe(404);
  });

  it('sets next_step_source to mike and stamps next_step_at', async () => {
    const res = await PATCH(req({ text: 'Call the client' }), { params });
    expect(res.status).toBe(200);
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_ID },
        data: expect.objectContaining({
          next_step_text: 'Call the client',
          next_step_owner_id: null,
          next_step_owner_label: null,
          next_step_source: 'mike',
        }),
      })
    );
  });

  it('accepts owner_id and clears owner_label', async () => {
    await PATCH(req({ text: 'Call the client', owner_id: '11111111-1111-1111-8111-111111111111' }), { params });
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          next_step_owner_id: '11111111-1111-1111-8111-111111111111',
          next_step_owner_label: null,
        }),
      })
    );
  });

  it('accepts owner_label and clears owner_id', async () => {
    await PATCH(req({ text: 'Waiting on Andy', owner_label: 'Andy (client)' }), { params });
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          next_step_owner_id: null,
          next_step_owner_label: 'Andy (client)',
        }),
      })
    );
  });

  it('rejects both owner_id and owner_label together', async () => {
    const res = await PATCH(
      req({
        text: 'Call the client',
        owner_id: '11111111-1111-1111-8111-111111111111',
        owner_label: 'Andy (client)',
      }),
      { params }
    );
    expect(res.status).toBe(400);
  });

  it('404s when owner_id does not resolve to a user', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await PATCH(
      req({ text: 'Call the client', owner_id: '11111111-1111-1111-8111-111111111111' }),
      { params }
    );
    expect(res.status).toBe(404);
  });

  it('rejects text over 500 characters', async () => {
    const res = await PATCH(req({ text: 'x'.repeat(501) }), { params });
    expect(res.status).toBe(400);
  });

  it('rejects empty text', async () => {
    const res = await PATCH(req({ text: '' }), { params });
    expect(res.status).toBe(400);
  });

  it('logs the update', async () => {
    await PATCH(req({ text: 'Call the client' }), { params });
    expect(mockLogUpdate).toHaveBeenCalled();
  });
});

describe('DELETE /api/oracle/projects/[id]/next-step', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await DELETE(req(undefined, 'DELETE'), { params });
    expect(res.status).toBe(403);
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await DELETE(req(undefined, 'DELETE'), { params });
    expect(res.status).toBe(404);
  });

  it('clears all next-step fields, including owner_label', async () => {
    const res = await DELETE(req(undefined, 'DELETE'), { params });
    expect(res.status).toBe(200);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: {
        next_step_text: null,
        next_step_owner_id: null,
        next_step_owner_label: null,
        next_step_source: null,
        next_step_at: null,
      },
    });
  });

  it('logs the clear', async () => {
    await DELETE(req(undefined, 'DELETE'), { params });
    expect(mockLogUpdate).toHaveBeenCalled();
  });
});
