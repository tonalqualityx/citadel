import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

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

describe('POST /api/sops — bast_executable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'admin', email: 'a@x.com' });
    mockSopCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: 'sop-1', ...data }));
  });

  it('persists bast_executable=true when provided', async () => {
    const res = await POST(postReq({ title: 'Eleventy menu update', bast_executable: true }));
    expect(res.status).toBe(201);
    expect(mockSopCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bast_executable: true }) })
    );
  });

  it('defaults bast_executable to false when omitted', async () => {
    const res = await POST(postReq({ title: 'Some SOP' }));
    expect(res.status).toBe(201);
    expect(mockSopCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bast_executable: false }) })
    );
  });
});
