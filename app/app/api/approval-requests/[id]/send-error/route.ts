import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 — PUT used ONLY by the machine-side sender when a real
// `gog gmail send` invocation itself fails (a transport/subprocess failure BEFORE any
// delivery — an unresolved-id-after-a-successful-send is a different case entirely, see
// PUT .../sent's own doc comment). pm/admin only (H2 security fix) — approval-sender.py
// already runs on a key whose user has pm/admin, so this costs it nothing.
//
// Phase 5 fixes (HIGH-1/MEDIUM-1). Requires the row to be 'sending' — only a row the
// sender actually claimed (PUT .../sending, before gog was invoked) can have failed to
// send. Releases back to 'queued' (the next poll retries the claim + send from
// scratch) unless this is the THIRD recorded error in a row, in which case the row
// falls back to 'draft' with send_error set — so a persistently-broken send (a bad
// address, an expired gog token) stops silently retrying forever and surfaces back to
// Mike as a draft needing attention instead. send_error_count resets to 0 on the next
// successful PUT .../sent, or the next draft->queued PATCH (a fresh attempt cycle).
//
// Phase 5 TAIL fixes (MEDIUM-A) — ALSO accepts a row still 'queued' (never claimed at
// all): the sender's own local send ledger (layer 1 of its three-layer guard,
// approval-sender.py) can refuse to hand an id to gog WITHOUT ever calling PUT
// .../sending first — e.g. Mike releases a stuck 'sending' row to 'draft'
// (PATCH .../[id] {status:'draft', release_stuck:true}) and requeues it, but the local
// ledger on the machine that actually sent it the first time still remembers. That
// refusal bounces the row STRAIGHT to 'draft' regardless of send_error_count — this is
// not a transient, retryable failure the 3-strikes counter should absorb, it is an
// authoritative "this id must never reach gog again." A 'queued' row is the ONLY other
// status this route accepts alongside 'sending'; nothing else calls it from 'queued'.
const MAX_SEND_ERRORS = 3;
const MAX_ERROR_LENGTH = 2000;

const sendErrorSchema = z.object({
  error: z.string().min(1),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      select: { id: true, status: true, task_id: true, send_error_count: true },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }
    if (existing.status !== 'sending' && existing.status !== 'queued') {
      throw new ApiError(`Approval request is '${existing.status}', not 'sending' or 'queued'`, 409);
    }

    const body = await request.json();
    const data = sendErrorSchema.parse(body);
    const errorText = data.error.slice(0, MAX_ERROR_LENGTH);

    // A refusal from 'queued' (the local-send-ledger case above) is never a retryable
    // transient failure — straight to 'draft', bypassing the 3-strikes counter
    // entirely, regardless of how many ordinary send-errors this row has recorded
    // before.
    const fromQueued = existing.status === 'queued';
    const nextCount = existing.send_error_count + 1;
    const bounceToDraft = fromQueued || nextCount >= MAX_SEND_ERRORS;
    const nextStatus = bounceToDraft ? 'draft' : 'queued';

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        status: nextStatus,
        send_attempt_at: null,
        send_error: errorText,
        send_error_count: nextCount,
      },
    });

    await logUpdate(auth.userId, 'task', existing.task_id, 'Approval request', {
      approval_status: { from: existing.status, to: nextStatus },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      send_error: updated.send_error,
      send_error_count: updated.send_error_count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
