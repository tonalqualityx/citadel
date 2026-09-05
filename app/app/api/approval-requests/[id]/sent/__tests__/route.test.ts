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
  // Phase 5 fixes (HIGH-1/MEDIUM-1): the sender claims the row (PUT .../sending)
  // BEFORE gog is invoked, so by the time it PUTs .../sent the row's current status is
  // 'sending', not 'queued'.
  mockFindUnique.mockResolvedValue({
    id: AR_ID,
    status: 'sending',
    task_id: 'task-1',
    message_id: null,
    thread_id: null,
    sent_at: null,
  });
  mockUpdate.mockResolvedValue({
    id: AR_ID,
    status: 'sent',
    message_id: 'msg-1',
    thread_id: 'thread-1',
    sent_at: new Date('2026-09-04T12:00:00.000Z'),
    send_error: null,
  });
});

describe('PUT /api/approval-requests/[id]/sent', () => {
  it('404s when the row does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(req({ message_id: 'm', thread_id: 't', sent_at: '2026-09-04T12:00:00.000Z' }), { params });
    expect(res.status).toBe(404);
  });

  it("409s when the row is still queued (never claimed)", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'queued', task_id: 'task-1', message_id: null, thread_id: null, sent_at: null });
    const res = await PUT(req({ message_id: 'm', thread_id: 't', sent_at: '2026-09-04T12:00:00.000Z' }), { params });
    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("409s when the row isn't sending or already sent (e.g. draft)", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'draft', task_id: 'task-1', message_id: null, thread_id: null, sent_at: null });
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

  it('is idempotent when the row is already sent (a layer-3 retry-recording re-PUT)', async () => {
    mockFindUnique.mockResolvedValue({
      id: AR_ID,
      status: 'sent',
      task_id: 'task-1',
      message_id: 'msg-1',
      thread_id: 'thread-1',
      sent_at: new Date('2026-09-04T12:00:00.000Z'),
    });
    const res = await PUT(req({ message_id: 'msg-1', thread_id: 'thread-1', sent_at: '2026-09-04T12:05:00.000Z' }), {
      params,
    });
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe('sent');
    expect(body.message_id).toBe('msg-1');
  });

  it('accepts a null message_id/thread_id with delivered_unconfirmed:true', async () => {
    mockUpdate.mockResolvedValue({
      id: AR_ID,
      status: 'sent',
      message_id: null,
      thread_id: null,
      sent_at: new Date('2026-09-04T12:00:00.000Z'),
      send_error: 'message id unresolved',
    });
    const res = await PUT(
      req({ message_id: null, thread_id: null, sent_at: '2026-09-04T12:00:00.000Z', delivered_unconfirmed: true }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'sent',
          message_id: null,
          thread_id: null,
          send_error: 'message id unresolved',
        }),
      })
    );
    const body = await res.json();
    expect(body.status).toBe('sent');
    expect(body.message_id).toBeNull();
    expect(body.send_error).toBe('message id unresolved');
  });

  it('422s a null message_id without delivered_unconfirmed', async () => {
    const res = await PUT(req({ message_id: null, thread_id: null, sent_at: '2026-09-04T12:00:00.000Z' }), { params });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
