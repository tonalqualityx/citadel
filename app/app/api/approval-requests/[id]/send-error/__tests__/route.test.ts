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
import { logUpdate } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.approvalRequest.findUnique as Mock;
const mockUpdate = prisma.approvalRequest.update as Mock;
const mockLogUpdate = vi.mocked(logUpdate);

const AR_ID = 'ar-1';
const params = Promise.resolve({ id: AR_ID });

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/approval-requests/${AR_ID}/send-error`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'oracle-svc', role: 'admin', email: 'oracle@indelible.bot' });
  // Phase 5 fixes (HIGH-1/MEDIUM-1): send-error is only ever called on a row the
  // sender itself claimed via PUT .../sending, so the row's current status must be
  // 'sending', not 'queued' — a real gog send failure can only happen after the claim.
  mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sending', task_id: 'task-1', send_error_count: 0 });
  mockUpdate.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: AR_ID, status: 'sending', ...args.data }));
});

describe('PUT /api/approval-requests/[id]/send-error', () => {
  it('404s when the row does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await PUT(req({ error: 'gog failed' }), { params });
    expect(res.status).toBe(404);
  });

  it("409s when the row isn't sending", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sent', task_id: 'task-1', send_error_count: 0 });
    const res = await PUT(req({ error: 'gog failed' }), { params });
    expect(res.status).toBe(409);
  });

  it("409s when the row is still queued (never claimed)", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'queued', task_id: 'task-1', send_error_count: 0 });
    const res = await PUT(req({ error: 'gog failed' }), { params });
    expect(res.status).toBe(409);
  });

  it('records the error and releases back to queued on the 1st/2nd failure', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sending', task_id: 'task-1', send_error_count: 1 });
    const res = await PUT(req({ error: 'gog failed' }), { params });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'queued',
          send_attempt_at: null,
          send_error: 'gog failed',
          send_error_count: 2,
        }),
      })
    );
    const body = await res.json();
    expect(body.status).toBe('queued');
    // MEDIUM-4: every increment logs — not just the 3rd/bounce-to-draft one.
    expect(mockLogUpdate).toHaveBeenCalledTimes(1);
    expect(mockLogUpdate).toHaveBeenCalledWith(
      'oracle-svc', 'task', 'task-1', 'Approval request',
      { approval_status: { from: 'sending', to: 'queued' } }
    );
  });

  it('flips to draft on the 3rd recorded error', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sending', task_id: 'task-1', send_error_count: 2 });
    const res = await PUT(req({ error: 'gog failed again' }), { params });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'draft', send_error_count: 3 }),
      })
    );
    const body = await res.json();
    expect(body.status).toBe('draft');
    expect(mockLogUpdate).toHaveBeenCalledTimes(1);
    expect(mockLogUpdate).toHaveBeenCalledWith(
      'oracle-svc', 'task', 'task-1', 'Approval request',
      { approval_status: { from: 'sending', to: 'draft' } }
    );
  });

  it('truncates an excessively long error message', async () => {
    const longError = 'x'.repeat(3000);
    await PUT(req({ error: longError }), { params });
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect((updateArgs.data.send_error as string).length).toBeLessThanOrEqual(2000);
  });
});
