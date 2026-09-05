import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sop: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockSopFindUnique = prisma.sop.findUnique as Mock;
const mockSopUpdate = prisma.sop.update as Mock;

const SOP_ID = 'sop-1';

function patchReq(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/sops/${SOP_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: SOP_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin', email: 'a@x.com' });
  mockRequireRole.mockImplementation(() => {});
  mockSopFindUnique.mockResolvedValue({ id: SOP_ID });
  mockSopUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: SOP_ID, ...data })
  );
});

describe('PATCH /api/sops/[id] — needs_review (Oracle Projects Phase 1, 2026-09-04)', () => {
  it('updates needs_review to true', async () => {
    const res = await PATCH(patchReq({ needs_review: true }), ctx());
    expect(res.status).toBe(200);
    expect(mockSopUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOP_ID },
        data: expect.objectContaining({ needs_review: true }),
      })
    );
  });

  it('updates needs_review to false', async () => {
    const res = await PATCH(patchReq({ needs_review: false }), ctx());
    expect(res.status).toBe(200);
    expect(mockSopUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SOP_ID },
        data: expect.objectContaining({ needs_review: false }),
      })
    );
  });

  it('leaves needs_review untouched when omitted', async () => {
    const res = await PATCH(patchReq({ title: 'Renamed SOP' }), ctx());
    expect(res.status).toBe(200);
    const call = mockSopUpdate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('needs_review');
  });

  it('404s when the SOP does not exist', async () => {
    mockSopFindUnique.mockResolvedValue(null);
    const res = await PATCH(patchReq({ needs_review: true }), ctx());
    expect(res.status).toBe(404);
  });

  it('requires PM/Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await PATCH(patchReq({ needs_review: true }), ctx());
    expect(res.status).toBe(403);
  });
});
