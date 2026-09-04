import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PUT } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    approvalRequest: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logUpdate: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.approvalRequest.findUnique as Mock;
const mockUpdate = prisma.approvalRequest.update as Mock;

const AR_ID = 'ar-1';
const params = Promise.resolve({ id: AR_ID });

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/approval-requests/${AR_ID}/sent`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'oracle-svc', role: 'admin', email: 'oracle@indelible.bot' });
  mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'queued', task_id: 'task-1' });
  mockUpdate.mockResolvedValue({
    id: AR_ID,
    status: 'sent',
    message_id: 'msg-1',
    thread_id: 'thread-1',
    sent_at: new Date('2026-09-04T12:00:00.000Z'),
  });
});

describe('PUT /api/approval-requests/[id]/sent', () => {
  it('404s when the row does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(req({ message_id: 'm', thread_id: 't', sent_at: '2026-09-04T12:00:00.000Z' }), { params });
    expect(res.status).toBe(404);
  });

  it("409s when the row isn't queued", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'draft', task_id: 'task-1' });
    const res = await PUT(req({ message_id: 'm', thread_id: 't', sent_at: '2026-09-04T12:00:00.000Z' }), { params });
    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('marks the row sent and clears any prior send_error', async () => {
    const res = await PUT(req({ message_id: 'msg-1', thread_id: 'thread-1', sent_at: '2026-09-04T12:00:00.000Z' }), {
      params,
    });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'sent',
          message_id: 'msg-1',
          thread_id: 'thread-1',
          send_error: null,
          send_error_count: 0,
        }),
      })
    );
    const body = await res.json();
    expect(body.status).toBe('sent');
  });
});
