import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate, logCreate } from '@/lib/services/activity';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
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
  status: z.enum(['queued', 'cancelled', 'approved', 'changes_requested']).optional(),
  reply_note: z.string().trim().max(5000).optional(),
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

    if (data.status && !isLegalTransition(existing.status, data.status)) {
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
