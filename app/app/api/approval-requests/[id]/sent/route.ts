import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 5 — PUT used ONLY by the machine-side sender
// (~/.claude/tools/citadel-approvals/approval-sender.py) right after `gog gmail send`
// succeeds. Bearer, any authenticated user — a machine endpoint, matching the next-step
// engine's write route convention.
//
// Phase 5 fixes (HIGH-1/MEDIUM-1). Requires the row to be 'sending' — the sender's own
// PUT .../sending claim (layer 2 of the guard) is what put it there, BEFORE gog was
// ever invoked; a row that never left 'queued' was never sent, so there is nothing here
// to confuse with "sent." A row already 'sent' is accepted as an idempotent no-op
// re-confirmation (200, unchanged) rather than a 409 — this is exactly the shape of the
// sender's own layer-3 retry: PUT .../sent can itself fail transport-side AFTER gog has
// already delivered the email, and the sender retries recording it (never resending) on
// a later tick, which means calling this same route again for a row that may, by then,
// already be 'sent' from an earlier attempt whose response never made it back. Any
// other current status is a real conflict (409) — the row moved somewhere this PUT was
// never meant to reach.
//
// message_id/thread_id are optional: when the sender could not resolve either id after
// a real, successful gog send (search-fallback exhausted too), it PUTs here with
// `message_id: null, delivered_unconfirmed: true` instead of calling .../send-error —
// the email already went out, so this is a recording gap, never a send failure, and
// must never trigger a resend. send_error carries a fixed marker string in that case so
// it is visible on the row without adding a dedicated boolean column.
const sentSchema = z
  .object({
    message_id: z.string().min(1).max(255).nullable().optional(),
    thread_id: z.string().min(1).max(255).nullable().optional(),
    sent_at: z.string().datetime(),
    delivered_unconfirmed: z.boolean().optional(),
  })
  .refine(
    (data) => data.delivered_unconfirmed === true || (!!data.message_id && !!data.thread_id),
    { message: 'message_id and thread_id are required unless delivered_unconfirmed is true' }
  );

const UNRESOLVED_ID_MARKER = 'message id unresolved';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        task_id: true,
        message_id: true,
        thread_id: true,
        sent_at: true,
      },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }
    if (existing.status !== 'sending') {
      if (existing.status === 'sent') {
        // Idempotent retry — see the module doc comment's layer-3 note. The email was
        // already recorded as sent; happily re-confirm rather than erroring, so the
        // sender's own retry-recording pass on a later tick is never mistaken for a
        // conflict.
        return NextResponse.json({
          id: existing.id,
          status: existing.status,
          message_id: existing.message_id,
          thread_id: existing.thread_id,
          sent_at: existing.sent_at,
        });
      }
      throw new ApiError(`Approval request is '${existing.status}', not 'sending'. Nothing to mark sent.`, 409);
    }

    const body = await request.json();
    const data = sentSchema.parse(body);

    const updated = await prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'sent',
        message_id: data.message_id ?? null,
        thread_id: data.thread_id ?? null,
        sent_at: new Date(data.sent_at),
        send_error: data.delivered_unconfirmed ? UNRESOLVED_ID_MARKER : null,
        send_error_count: 0,
      },
    });

    await logUpdate(auth.userId, 'task', existing.task_id, 'Approval request', {
      approval_status: { from: 'sending', to: 'sent' },
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      message_id: updated.message_id,
      thread_id: updated.thread_id,
      sent_at: updated.sent_at,
      send_error: updated.send_error,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
