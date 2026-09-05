import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

const mockTxApprovalRequestUpdate = vi.fn();
const mockTxTaskCreate = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    approvalRequest: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    clientContact: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        approvalRequest: { update: mockTxApprovalRequestUpdate },
        task: { create: mockTxTaskCreate },
      })
    ),
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logUpdate: vi.fn(),
  logCreate: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockApprovalRequestFindUnique = prisma.approvalRequest.findUnique as Mock;
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockContactFindFirst = prisma.clientContact.findFirst as Mock;

const AR_ID = 'ar-1';
const TASK_ID = '11111111-1111-1111-8111-111111111111';
const PROJECT_ID = '33333333-3333-3333-8333-333333333333';

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/approval-requests/${AR_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: AR_ID });

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AR_ID,
    status: 'draft',
    subject: 'Ready for your approval: Homepage copy',
    body: 'Hi,\n\nHomepage copy is ready.\n\nMike',
    to_email: null,
    reply_excerpt: null,
    task: { id: TASK_ID, title: 'Homepage copy', project_id: PROJECT_ID },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockApprovalRequestFindUnique.mockResolvedValue(existingRow());
  mockProjectFindUnique.mockResolvedValue({ client_id: 'client-1' });
  mockContactFindFirst.mockResolvedValue({ id: 'contact-1' });
  mockTxApprovalRequestUpdate.mockImplementation((args: { data: Record<string, unknown> }) => ({
    id: AR_ID,
    status: 'draft',
    ...args.data,
  }));
  mockTxTaskCreate.mockResolvedValue({ id: 'follow-up-task-1' });
});

describe('PATCH /api/approval-requests/[id]', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await PATCH(req({ subject: 'x' }), { params });
    expect(res.status).toBe(403);
  });

  it('404s when the row does not exist', async () => {
    mockApprovalRequestFindUnique.mockResolvedValue(null);
    const res = await PATCH(req({ subject: 'x' }), { params });
    expect(res.status).toBe(404);
  });

  describe('editing fields', () => {
    it('accepts subject/body/to_email edits while draft', async () => {
      const res = await PATCH(req({ subject: 'New subject' }), { params });
      expect(res.status).toBe(200);
      expect(mockTxApprovalRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ subject: 'New subject' }) })
      );
    });

    it('409s an edit once the row has left draft', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'queued' }));
      const res = await PATCH(req({ subject: 'New subject' }), { params });
      expect(res.status).toBe(409);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });
  });

  describe('draft -> queued', () => {
    it('422s when to_email/subject/body are not all non-empty', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ to_email: null }));
      const res = await PATCH(req({ status: 'queued' }), { params });
      expect(res.status).toBe(422);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('422s when to_email is not a ClientContact on the task\'s client', async () => {
      mockContactFindFirst.mockResolvedValue(null);
      const res = await PATCH(req({ status: 'queued', to_email: 'client@example.com' }), { params });
      expect(res.status).toBe(422);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('422s when the (possibly edited) subject/body fails the dash-law lint', async () => {
      const res = await PATCH(
        req({ status: 'queued', to_email: 'client@example.com', body: 'Please review — thanks.' }),
        { params }
      );
      expect(res.status).toBe(422);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('stamps queued_at/queued_by_id and clears send_error on a clean queue', async () => {
      const res = await PATCH(req({ status: 'queued', to_email: 'client@example.com' }), { params });
      expect(res.status).toBe(200);
      expect(mockTxApprovalRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'queued',
            queued_by_id: 'mike-1',
            send_error: null,
            send_error_count: 0,
          }),
        })
      );
    });

    it('409s queuing an already-queued row', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'queued', to_email: 'client@example.com' }));
      const res = await PATCH(req({ status: 'queued' }), { params });
      expect(res.status).toBe(409);
    });
  });

  describe('queued -> cancelled', () => {
    it('stamps cancelled_at', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'queued', to_email: 'client@example.com' }));
      const res = await PATCH(req({ status: 'cancelled' }), { params });
      expect(res.status).toBe(200);
      expect(mockTxApprovalRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) })
      );
    });
  });

  describe('sent|replied -> approved', () => {
    it.each(['sent', 'replied'])('stamps approved_at only, from %s', async (status) => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status }));
      const res = await PATCH(req({ status: 'approved' }), { params });
      expect(res.status).toBe(200);
      expect(mockTxApprovalRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'approved', approved_at: expect.any(Date) } })
      );
      expect(mockTxTaskCreate).not.toHaveBeenCalled();
    });
  });

  describe('sent|replied -> changes_requested', () => {
    it('stamps changes_requested_at and creates a follow-up task using reply_note', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sent' }));
      const res = await PATCH(req({ status: 'changes_requested', reply_note: 'Please use a bigger logo.' }), { params });
      expect(res.status).toBe(200);
      expect(mockTxTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Changes requested: Homepage copy',
            description: 'Please use a bigger logo.',
            project_id: PROJECT_ID,
            status: 'not_started',
          }),
        })
      );
    });

    it('falls back to the existing reply_excerpt when no reply_note is given', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'replied', reply_excerpt: 'Not quite right.' }));
      await PATCH(req({ status: 'changes_requested' }), { params });
      expect(mockTxTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ description: 'Not quite right.' }) })
      );
    });

    it('falls back to a generic reason when neither reply_note nor reply_excerpt exist', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sent', reply_excerpt: null }));
      await PATCH(req({ status: 'changes_requested' }), { params });
      expect(mockTxTaskCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ description: 'The client requested changes.' }) })
      );
    });
  });

  describe('illegal transitions', () => {
    it.each([
      ['draft', 'approved'],
      ['draft', 'changes_requested'],
      ['draft', 'cancelled'],
      ['approved', 'queued'],
      ['cancelled', 'queued'],
      ['changes_requested', 'approved'],
      // LOW-c (Phase 5 tail fixes) — a plain PATCH out of 'sending' with no matching
      // manual-override flag stays illegal, exactly like any other unlisted transition.
      // 'sending' has no generically-legal PATCH target of its own (see
      // APPROVAL_REQUEST_TRANSITIONS' own doc comment) — the two exceptions
      // (sending->sent/confirmed_by_mike, sending->draft/release_stuck) are their own
      // dedicated describe block below.
      ['sending', 'queued'],
      ['sending', 'approved'],
      ['sending', 'cancelled'],
      ['sending', 'changes_requested'],
    ])('409s %s -> %s', async (from, to) => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: from, to_email: 'client@example.com' }));
      const res = await PATCH(req({ status: to }), { params });
      expect(res.status).toBe(409);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('409s a bare sending -> sent PATCH with no confirmed_by_mike flag', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(
        existingRow({ status: 'sending', send_attempt_at: new Date(Date.now() - 45 * 60_000) })
      );
      const res = await PATCH(req({ status: 'sent' }), { params });
      expect(res.status).toBe(409);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('409s a bare sending -> draft PATCH with no release_stuck flag', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(
        existingRow({ status: 'sending', send_attempt_at: new Date(Date.now() - 45 * 60_000) })
      );
      const res = await PATCH(req({ status: 'draft' }), { params });
      expect(res.status).toBe(409);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });
  });

  // Phase 5 tail fixes (MEDIUM-A) — the two Mike-gated manual overrides for a 'sending'
  // row stuck past the 30-minute mark with no PUT .../sent on file (the sender died
  // between claiming it and recording delivery). Both require PM/Admin (already
  // enforced by requireRole at the top of the handler — no separate check needed here)
  // and both are gated on send_attempt_at being more than 30 minutes old.
  describe('sending -> sent (confirmed_by_mike) / sending -> draft (release_stuck)', () => {
    const OLD_ATTEMPT = new Date(Date.now() - 45 * 60_000);
    const RECENT_ATTEMPT = new Date(Date.now() - 10 * 60_000);

    it('stamps sent_at and a fixed send_error marker on confirmed_by_mike, past the 30-minute gate', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sending', send_attempt_at: OLD_ATTEMPT }));
      const res = await PATCH(req({ status: 'sent', confirmed_by_mike: true }), { params });
      expect(res.status).toBe(200);
      expect(mockTxApprovalRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'sent',
            sent_at: expect.any(Date),
            send_error: 'confirmed manually',
          }),
        })
      );
    });

    it('accepts an optional message_id on confirmed_by_mike', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sending', send_attempt_at: OLD_ATTEMPT }));
      const res = await PATCH(req({ status: 'sent', confirmed_by_mike: true, message_id: 'msg-recovered-1' }), { params });
      expect(res.status).toBe(200);
      expect(mockTxApprovalRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ message_id: 'msg-recovered-1' }) })
      );
    });

    it('resets send_error_count and stamps manual_release_at on release_stuck, past the 30-minute gate', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sending', send_attempt_at: OLD_ATTEMPT, send_error_count: 2 }));
      const res = await PATCH(req({ status: 'draft', release_stuck: true }), { params });
      expect(res.status).toBe(200);
      expect(mockTxApprovalRequestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'draft',
            send_error_count: 0,
            manual_release_at: expect.any(Date),
            send_attempt_at: null,
          }),
        })
      );
    });

    it('409s confirmed_by_mike when send_attempt_at is under 30 minutes old', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sending', send_attempt_at: RECENT_ATTEMPT }));
      const res = await PATCH(req({ status: 'sent', confirmed_by_mike: true }), { params });
      expect(res.status).toBe(409);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('409s release_stuck when send_attempt_at is under 30 minutes old', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sending', send_attempt_at: RECENT_ATTEMPT }));
      const res = await PATCH(req({ status: 'draft', release_stuck: true }), { params });
      expect(res.status).toBe(409);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('409s confirmed_by_mike when send_attempt_at is missing entirely (no evidence it is actually old)', async () => {
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sending', send_attempt_at: null }));
      const res = await PATCH(req({ status: 'sent', confirmed_by_mike: true }), { params });
      expect(res.status).toBe(409);
      expect(mockTxApprovalRequestUpdate).not.toHaveBeenCalled();
    });

    it('requires PM or Admin, same as every other transition on this route', async () => {
      const { AuthError } = await import('@/lib/api/errors');
      mockRequireRole.mockImplementation(() => {
        throw new AuthError('Insufficient permissions', 403);
      });
      mockApprovalRequestFindUnique.mockResolvedValue(existingRow({ status: 'sending', send_attempt_at: OLD_ATTEMPT }));
      const res = await PATCH(req({ status: 'sent', confirmed_by_mike: true }), { params });
      expect(res.status).toBe(403);
    });
  });
});
