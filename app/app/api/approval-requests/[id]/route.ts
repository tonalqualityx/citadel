import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate, logCreate } from '@/lib/services/activity';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { SENDING_STUCK_THRESHOLD_MINUTES } from '@/lib/oracle/projects/blockers';
import {
  isLegalTransition,
  lintApprovalEmail,
  formatApprovalRequestResponse,
  type ApprovalRequestWithRelations,
} from '@/lib/services/approval-requests';

const INCLUDE = {
  contact: { select: { id: true, name: true, email: true } },
  task: { select: { id: true, title: true } },
} as const;

const patchSchema = z.object({
  subject: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().min(1).optional(),
  to_email: z.string().email().max(255).optional().nullable(),
  status: z.enum(['queued', 'cancelled', 'approved', 'changes_requested', 'sent', 'draft']).optional(),
  reply_note: z.string().trim().max(5000).optional(),
  // Phase 5 tail fixes (MEDIUM-A) — the two Mike-gated manual overrides for a
  // 'sending' row the sender died on. Each flag is meaningful ONLY paired with its own
  // matching `status` value (see the handler below); either flag alone, or either
  // status value without its flag, stays an illegal transition.
  confirmed_by_mike: z.boolean().optional(),
  release_stuck: z.boolean().optional(),
  message_id: z.string().trim().min(1).max(255).optional(),
});

// Oracle Projects Tab Phase 5 — the approval-request state machine.
// draft -> queued: requires a non-empty to_email/subject/body (after any edits this same
//   PATCH makes), and to_email must be a live ClientContact email on the task's own
//   client — never an arbitrary address. Stamps queued_at/queued_by_id, clears any prior
//   send_error/send_error_count (a fresh attempt cycle).
// queued -> cancelled: stamps cancelled_at. The machine-side sender re-checks status is
//   still 'queued' immediately before it sends, so a cancel that lands mid-poll is
//   caught there too, not just here.
// sent|replied -> approved: stamps approved_at ONLY. Deliberately does NOT touch the
//   underlying task (approved:true, or marking it done) — that stays Mike's own explicit
//   action on the task itself, never an automatic side effect of an approval-request
//   transition (see the plan's Phase 5 spec, ruled NO on the auto-PATCH-the-task idea).
// sent|replied -> changes_requested: stamps changes_requested_at AND creates a follow-up
//   task ("Changes requested: <task title>") carrying the reply excerpt (or reply_note,
//   or a generic fallback), on the same project, assigned to Mike.
// Editing subject/body/to_email is only accepted while the CURRENT status is 'draft' —
// once queued, the row is either about to send or already sent; editing it out from
// under the sender is not a supported flow (cancel and create a new draft instead).
//
// Phase 5 TAIL fixes (MEDIUM-A) — sending -> sent / sending -> draft, both Mike-only
// (this whole route already requires ['pm','admin'] below) and both gated on
// send_attempt_at being older than SENDING_STUCK_THRESHOLD_MINUTES (409 otherwise, so a
// live send in flight can never be interrupted):
//   sending -> sent, body {status:'sent', confirmed_by_mike:true, message_id?}: "I
//     checked Gmail, it went out." Stamps sent_at=now and send_error to a fixed
//     "confirmed manually" marker (visible on the row as the reason it has no real
//     message_id/thread_id from gog, unless message_id was supplied). Bypasses the
//     machine-only PUT .../sent route entirely — this IS the human equivalent of it.
//   sending -> draft, body {status:'draft', release_stuck:true}: "It did not go out;
//     let me edit and requeue." Resets send_error_count to 0 (a fresh attempt cycle,
//     same as the 3-strikes auto-bounce) and stamps manual_release_at as the record of
//     a HUMAN release (vs. the automatic one). This does NOT, on its own, guarantee a
//     resend never happens twice — the machine-side sender's own local send ledger
//     (approval-sender.py, layer 1 of its three-layer guard) is what actually refuses
//     to hand an already-ledgered id to gog again, regardless of what this row's own
//     status says; see that script's module docstring.
// Neither transition is listed in APPROVAL_REQUEST_TRANSITIONS/isLegalTransition (see
// that module's own doc comment) — they are checked by hand below, BEFORE the generic
// table, and require their exact flag or fall straight through to that table's 409.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.approvalRequest.findUnique({
      where: { id },
      include: { task: { select: { id: true, title: true, project_id: true } } },
    });
    if (!existing) {
      throw new ApiError('Approval request not found', 404);
    }

    const body = await request.json();
    const data = patchSchema.parse(body);

    const editingFields = data.subject !== undefined || data.body !== undefined || data.to_email !== undefined;
    if (editingFields && existing.status !== 'draft') {
      throw new ApiError(
        `Cannot edit subject/body/to_email once an approval request has left draft (current status: ${existing.status})`,
        409
      );
    }

    // Phase 5 tail fixes (MEDIUM-A) — checked BEFORE the generic transition table: a
    // plain {status:'sent'} or {status:'draft'} PATCH from 'sending', missing its exact
    // matching flag, is NOT one of these two special cases and falls through to the
    // generic isLegalTransition check below (which 409s it, same as any other
    // unlisted transition — 'sending' has no legal PATCH-only targets on its own).
    const manualSentConfirm =
      existing.status === 'sending' && data.status === 'sent' && data.confirmed_by_mike === true;
    const manualReleaseToDraft =
      existing.status === 'sending' && data.status === 'draft' && data.release_stuck === true;

    if (manualSentConfirm || manualReleaseToDraft) {
      // No send_attempt_at at all (shouldn't happen for a real 'sending' row — PUT
      // .../sending always stamps it — but defensively handled) means there is no
      // evidence this claim is actually old; treated as 0 minutes elapsed, i.e. always
      // blocked, never as "infinitely old, so always allow."
      const attemptAt = existing.send_attempt_at;
      const minutesSinceAttempt = attemptAt ? (Date.now() - attemptAt.getTime()) / 60000 : 0;
      if (minutesSinceAttempt < SENDING_STUCK_THRESHOLD_MINUTES) {
        throw new ApiError(
          `Cannot override a 'sending' row until ${SENDING_STUCK_THRESHOLD_MINUTES} minutes have passed since it was claimed for sending. A live send may still be in flight.`,
          409
        );
      }
    } else if (data.status && !isLegalTransition(existing.status, data.status)) {
      throw new ApiError(
        `Cannot move an approval request from '${existing.status}' to '${data.status}'`,
        409
      );
    }

    const nextSubject = data.subject ?? existing.subject;
    const nextBody = data.body ?? existing.body;
    const nextToEmail = data.to_email !== undefined ? data.to_email : existing.to_email;

    const updateData: Record<string, unknown> = {};
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.body !== undefined) updateData.body = data.body;
    if (data.to_email !== undefined) updateData.to_email = data.to_email;

    if (data.status === 'queued') {
      if (!nextToEmail || !nextSubject.trim() || !nextBody.trim()) {
        throw new ApiError('to_email, subject, and body are all required to queue an approval request', 422);
      }

      const violations = lintApprovalEmail({ subject: nextSubject, body: nextBody });
      if (violations.length > 0) {
        return NextResponse.json(
          { error: 'subject or body failed the writing-standard lint', violations },
          { status: 422 }
        );
      }

      if (!existing.task.project_id) {
        throw new ApiError('Task has no project', 400);
      }
      const project = await prisma.project.findUnique({
        where: { id: existing.task.project_id },
        select: { client_id: true },
      });
      const matchingContact = project
        ? await prisma.clientContact.findFirst({
            where: {
              client_id: project.client_id,
              is_deleted: false,
              email: { equals: nextToEmail, mode: 'insensitive' },
            },
            select: { id: true },
          })
        : null;
      if (!matchingContact) {
        throw new ApiError(
          `${nextToEmail} is not a contact on this task's client. Pick a client contact's email.`,
          422
        );
      }

      updateData.status = 'queued';
      updateData.queued_at = new Date();
      updateData.queued_by_id = auth.userId;
      updateData.send_error = null;
      updateData.send_error_count = 0;
    } else if (data.status === 'cancelled') {
      updateData.status = 'cancelled';
      updateData.cancelled_at = new Date();
    } else if (data.status === 'approved') {
      updateData.status = 'approved';
      updateData.approved_at = new Date();
    } else if (data.status === 'changes_requested') {
      updateData.status = 'changes_requested';
      updateData.changes_requested_at = new Date();
    } else if (manualSentConfirm) {
      // "I checked Gmail, it went out." Never touches message_id/thread_id unless Mike
      // supplied one — most of the time there is nothing gog ever recorded for this row
      // (that is exactly why it needed a manual confirm), so those stay whatever they
      // already were (almost always still null).
      updateData.status = 'sent';
      updateData.sent_at = new Date();
      updateData.send_error = 'confirmed manually';
      if (data.message_id !== undefined) {
        updateData.message_id = data.message_id;
      }
    } else if (manualReleaseToDraft) {
      // "It did not go out; let me edit and requeue." A fresh attempt cycle — same
      // send_error_count reset the 3-strikes auto-bounce already gives a draft, plus
      // manual_release_at as the record that a HUMAN made this call. send_attempt_at is
      // cleared too: the row is no longer claimed by anyone.
      updateData.status = 'draft';
      updateData.send_error_count = 0;
      updateData.manual_release_at = new Date();
      updateData.send_attempt_at = null;
    }

    let followUpTaskId: string | null = null;
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.approvalRequest.update({
        where: { id },
        data: updateData,
        include: INCLUDE,
      });

      // sent|replied -> changes_requested creates a follow-up task, per the plan's
      // ruling — the approval-request transition itself never touches the ORIGINAL
      // task (see the module doc comment on the 'approved' branch above; the same
      // "Mike acts on the task explicitly" principle applies here too).
      if (data.status === 'changes_requested' && existing.task.project_id) {
        const excerpt = data.reply_note?.trim() || existing.reply_excerpt?.trim() || 'The client requested changes.';
        const followUp = await tx.task.create({
          data: {
            title: `Changes requested: ${existing.task.title}`,
            description: excerpt,
            project_id: existing.task.project_id,
            assignee_id: MIKE_USER_ID,
            status: 'not_started',
          },
        });
        followUpTaskId = followUp.id;
      }

      return row;
    });

    await logUpdate(auth.userId, 'task', existing.task.id, `Approval request: ${existing.task.title}`, {
      approval_status: { from: existing.status, to: updated.status },
    });
    if (followUpTaskId) {
      await logCreate(auth.userId, 'task', followUpTaskId, `Changes requested: ${existing.task.title}`);
    }

    return NextResponse.json(formatApprovalRequestResponse(updated as ApprovalRequestWithRelations));
  } catch (error) {
    return handleApiError(error);
  }
}
