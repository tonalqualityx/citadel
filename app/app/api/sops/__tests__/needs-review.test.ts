import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

// Oracle Projects Phase 1 (2026-09-04) — needs_review is now an accepted create param on
// POST /api/sops, mirroring the bast_executable pattern (see bast-executable.test.ts).
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sop: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    function: { findUnique: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockSopCreate = prisma.sop.create as Mock;

function postReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/sops', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/sops — needs_review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin', email: 'a@x.com' });
    mockSopCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'sop-1', ...data })
    );
  });

  it('persists needs_review=true when explicitly provided', async () => {
    const res = await POST(postReq({ title: 'SOP requiring review', needs_review: true }));
    expect(res.status).toBe(201);
    expect(mockSopCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ needs_review: true }) })
    );
  });

  it('persists needs_review=false when explicitly provided', async () => {
    const res = await POST(postReq({ title: 'SOP not requiring review', needs_review: false }));
    expect(res.status).toBe(201);
    expect(mockSopCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ needs_review: false }) })
    );
  });

  it('omits needs_review from the create payload when not provided (schema default of false applies)', async () => {
    const res = await POST(postReq({ title: 'Some SOP' }));
    expect(res.status).toBe(201);
    const call = mockSopCreate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('needs_review');
  });
});
