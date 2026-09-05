import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 fixes (HIGH-1/MEDIUM-1, layer 2 — the server claim) —
// PUT used ONLY by the machine-side sender (approval-sender.py), called BEFORE gog is
// ever invoked, right after the sender's own local-ledger check clears a row. Bearer,
// any authenticated user — matches the sibling machine endpoints (.../sent,
// .../send-error). Requires the row to still be 'queued'; a row not currently 'queued'
// is refused (409), which is exactly what makes "a row not in `sending` is never sent"
// true: the sender only calls `gog gmail send` after THIS call succeeds.
//
// GET /api/approval-requests?status=queued already excludes a claimed row for free — it
// is a plain status equality filter, and a claimed row's status is 'sending', not
// 'queued' — so no separate exclusion logic is needed there.
//
// A `sending` row whose send_attempt_at is more than 30 minutes old with no PUT
// .../sent on file is surfaced to Mike as a "Approval send unconfirmed" blocker
// (lib/oracle/projects/blockers.ts's classifyClientApprovals) — never auto-resent; see
// that module's own doc comment for the full three-layer guard this claim is part of.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { id: true, status: true, task_id: true },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }
    if (existing.status !== 'queued') {
      throw new ApiError(
        `Approval request is '${existing.status}', not 'queued'. Cannot claim it for sending.`,
        409
      );
    }

    const sendAttemptAt = new Date();
    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'sending',
        send_attempt_at: sendAttemptAt,
      },
    });

    await logUpdate(auth.userId, 'task', existing.task_id, 'Approval request', {
      approval_status: { from: 'queued', to: 'sending' },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      send_attempt_at: updated.send_attempt_at,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
