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
import { logUpdate } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
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
  mockRequireRole.mockImplementation(() => {});
  // Phase 5 fixes (HIGH-1/MEDIUM-1): send-error is only ever called on a row the
  // sender itself claimed via PUT .../sending, so the row's current status must be
  // 'sending', not 'queued' — a real gog send failure can only happen after the claim.
  mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'sending', task_id: 'task-1', send_error_count: 0 });
  mockUpdate.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: AR_ID, status: 'sending', ...args.data }));
});

describe('PUT /api/approval-requests/[id]/send-error', () => {
  it('requires PM or Admin role (H2 security fix)', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await PUT(req({ error: 'gog failed' }), { params });
    expect(res.status).toBe(403);
  });

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

  it("409s when the row is neither sending nor queued", async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'draft', task_id: 'task-1', send_error_count: 0 });
    const res = await PUT(req({ error: 'gog failed' }), { params });
    expect(res.status).toBe(409);
  });

  // Phase 5 tail fixes (MEDIUM-A) — the sender's local send ledger (layer 1) can refuse
  // an id WITHOUT ever claiming it (PUT .../sending) — e.g. Mike released a stuck
  // 'sending' row to 'draft' and requeued it, but the machine that actually sent it the
  // first time still remembers. That refusal bounces a still-'queued' row STRAIGHT to
  // 'draft', bypassing the 3-strikes counter entirely — this is not a transient,
  // retryable failure.
  it('bounces a still-queued row straight to draft, bypassing the 3-strikes counter', async () => {
    mockFindUnique.mockResolvedValue({ id: AR_ID, status: 'queued', task_id: 'task-1', send_error_count: 0 });
    const res = await PUT(req({ error: 'refused: already sent once from this machine' }), { params });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'draft',
          send_attempt_at: null,
          send_error: 'refused: already sent once from this machine',
          send_error_count: 1,
        }),
      })
    );
    const body = await res.json();
    expect(body.status).toBe('draft');
    expect(mockLogUpdate).toHaveBeenCalledWith(
      'oracle-svc', 'task', 'task-1', 'Approval request',
      { approval_status: { from: 'queued', to: 'draft' } }
    );
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
