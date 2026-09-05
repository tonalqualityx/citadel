import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PUT } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    approvalRequest: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logUpdate: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindUnique = prisma.approvalRequest.findUnique as Mock;
const mockUpdate = prisma.approvalRequest.update as Mock;

const AR_ID = 'ar-1';
const params = Promise.resolve({ id: AR_ID });

function req(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/approval-requests/${AR_ID}/sending`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'oracle-svc', role: 'admin', email: 'oracle@indelible.bot' });
  mockRequireRole.mockImplementation(() => {});
  mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'queued', task_id: 'task-1' });
  mockUpdate.mockImplementation((args: { data: Record<string, unknown> }) => ({
    id: AR_ID,
    status: 'sending',
    ...args.data,
  }));
});

// Oracle Projects Tab Phase 5 fixes (HIGH-1/MEDIUM-1, layer 2 — the server claim).
describe('PUT /api/approval-requests/[id]/sending', () => {
  it('requires PM or Admin role (H2 security fix)', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await PUT(req(), { params });
    expect(res.status).toBe(403);
  });

  it('404s when the row does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(req(), { params });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("409s when the row isn't queued", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'draft', task_id: 'task-1' });
    const res = await PUT(req(), { params });
    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('409s a row already sending (a second concurrent claim attempt)', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sending', task_id: 'task-1' });
    const res = await PUT(req(), { params });
    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('claims a queued row: status -> sending, stamps send_attempt_at', async () => {
    const res = await PUT(req(), { params });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: AR_ID },
        data: expect.objectContaining({ status: 'sending', send_attempt_at: expect.any(Date) }),
      })
    );
    const body = await res.json();
    expect(body.status).toBe('sending');
    expect(body.send_attempt_at).toBeTruthy();
  });
});
