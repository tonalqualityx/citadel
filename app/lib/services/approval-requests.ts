import type { ApprovalRequest, ApprovalRequestStatus } from '@prisma/client';
import { lintNextStepText } from '@/lib/oracle/projects/next-step-lint';

// Oracle Projects Tab Phase 5 — shared shaping/validation for the client-approval loop.
// Kept out of the route files so the state machine and the draft template have exactly
// one definition each, reused by POST /api/approval-requests, PATCH .../[id], and the
// server-drafted chase email lib/oracle/projects/blockers.ts builds for an overdue
// client_approval blocker.

// draft -> queued -> sent -> replied are the "in flight" progression; approved/
// changes_requested/cancelled are terminal. This is the ONLY place the legal-transition
// graph is defined — PATCH /api/approval-requests/[id] imports it rather than
// re-deriving it, so there is exactly one place to audit for "what can follow what."
//
// `sending` (Phase 5 fixes, HIGH-1/MEDIUM-1) carries no PATCH-legal outgoing transition
// here on purpose: it is entered ONLY via PUT /api/approval-requests/[id]/sending (the
// machine-side sender's own claim, before gog is invoked) and left, in the ORDINARY
// case, ONLY via PUT .../sent or PUT .../send-error — both dedicated machine routes
// with their own status checks, never through this PATCH endpoint or isLegalTransition.
// A `sending` key is still required here (a Record over every ApprovalRequestStatus)
// purely so the type stays exhaustive.
//
// Phase 5 TAIL fixes (MEDIUM-A) added exactly two Mike-gated ESCAPE HATCHES for a
// 'sending' row the sender died on (claimed, then never called back) — PATCH
// .../[id] {status:'sent', confirmed_by_mike:true} and {status:'draft',
// release_stuck:true}. These are deliberately NOT listed in
// APPROVAL_REQUEST_TRANSITIONS/isLegalTransition below: they are conditionally legal
// (only with the matching flag, and only once send_attempt_at is more than
// SENDING_STUCK_THRESHOLD_MINUTES old), not unconditionally legal the way every other
// entry in this table is. The route (app/api/approval-requests/[id]/route.ts) checks
// them by hand, before it ever consults this table, and falls through to this table's
// ordinary 409 for a plain {status:'sent'} or {status:'draft'} PATCH without the flag.
export const APPROVAL_REQUEST_TRANSITIONS: Record<ApprovalRequestStatus, ApprovalRequestStatus[]> = {
  draft: ['queued'],
  queued: ['cancelled'],
  sending: [],
  sent: ['approved', 'changes_requested'],
  replied: ['approved', 'changes_requested'],
  approved: [],
  changes_requested: [],
  cancelled: [],
};

export function isLegalTransition(from: ApprovalRequestStatus, to: ApprovalRequestStatus): boolean {
  return APPROVAL_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

interface DraftEmailInput {
  taskTitle: string;
  deliverableUrl: string | null;
}

/**
 * The server-side draft POST /api/approval-requests writes when the caller doesn't
 * supply subject/body itself. Short, plain, in Mike's own voice — no dashes, one job
 * per sentence, no invented specifics beyond the task's own title and (if present) its
 * staging/deliverable link. `draft_source: 'graph'` (see the model's own doc comment) —
 * a Bast-written draft is a later, separate job (next-step-refresh-style), not this
 * template.
 */
export function buildApprovalDraftEmail(input: DraftEmailInput): { subject: string; body: string } {
  const subject = `Ready for your approval: ${input.taskTitle}`;
  const lines = [`Hi,`, ``, `${input.taskTitle} is ready for your review.`];
  if (input.deliverableUrl) {
    lines.push(``, input.deliverableUrl);
  }
  lines.push(``, `Let me know if this works, or if you would like changes.`, ``, `Mike`);
  return { subject, body: lines.join('\n') };
}

interface ChaseDraftInput {
  taskTitle: string;
  chaseAfterDays: number;
}

/**
 * The short, plain chase-email draft attached to an overdue client_approval blocker
 * (lib/oracle/projects/blockers.ts's classifyClientApprovals). Never sent by itself —
 * ApprovalPanel/NudgePanel surface it as a starting point for a new queued send.
 */
export function buildChaseEmailDraft(input: ChaseDraftInput): { subject: string; body: string } {
  const subject = `Following up: ${input.taskTitle}`;
  const body = [
    `Hi,`,
    ``,
    `Checking in on ${input.taskTitle}. I sent this over ${input.chaseAfterDays} business day${
      input.chaseAfterDays === 1 ? '' : 's'
    } ago and have not heard back.`,
    ``,
    `Let me know if you have questions, or if this is ready to approve.`,
    ``,
    `Mike`,
  ].join('\n');
  return { subject, body };
}

/**
 * Lints a subject+body pair through the same writing-standard gate the next-step
 * engine's writes already pass (lib/oracle/projects/next-step-lint.ts — a straight port
 * of comment-gate.sh). Returns a flat, field-tagged violation list; empty = clean. Used
 * by POST /api/approval-requests (every draft, server-built or caller-supplied) and by
 * PATCH .../[id] (an edited subject/body, right before a draft->queued transition).
 */
export function lintApprovalEmail(
  fields: { subject: string; body: string }
): Array<{ rule: string; matches: string[]; field: 'subject' | 'body' }> {
  const out: Array<{ rule: string; matches: string[]; field: 'subject' | 'body' }> = [];
  for (const v of lintNextStepText(fields.subject)) out.push({ ...v, field: 'subject' });
  for (const v of lintNextStepText(fields.body)) out.push({ ...v, field: 'body' });
  return out;
}

export interface ApprovalRequestWithRelations extends ApprovalRequest {
  contact: { id: string; name: string | null; email: string } | null;
  task: { id: string; title: string } | null;
}

export function formatApprovalRequestResponse(ar: ApprovalRequestWithRelations) {
  return {
    id: ar.id,
    task_id: ar.task_id,
    task: ar.task ? { id: ar.task.id, title: ar.task.title } : null,
    project_id: ar.project_id,
    contact_id: ar.contact_id,
    contact: ar.contact ? { id: ar.contact.id, name: ar.contact.name, email: ar.contact.email } : null,
    status: ar.status,
    kind: ar.kind,
    subject: ar.subject,
    body: ar.body,
    to_email: ar.to_email,
    draft_source: ar.draft_source,
    message_id: ar.message_id,
    thread_id: ar.thread_id,
    sent_at: ar.sent_at,
    replied_at: ar.replied_at,
    reply_excerpt: ar.reply_excerpt,
    chase_after_days: ar.chase_after_days,
    seen_in_meeting_at: ar.seen_in_meeting_at,
    queued_at: ar.queued_at,
    queued_by_id: ar.queued_by_id,
    cancelled_at: ar.cancelled_at,
    approved_at: ar.approved_at,
    changes_requested_at: ar.changes_requested_at,
    send_attempt_at: ar.send_attempt_at,
    send_error: ar.send_error,
    send_error_count: ar.send_error_count,
    manual_release_at: ar.manual_release_at,
    created_by_id: ar.created_by_id,
    created_at: ar.created_at,
    updated_at: ar.updated_at,
  };
}
