/**
 * Portal task visibility (client portal MVP, A1).
 *
 * The ONE place that decides which tasks a logged-in client may see or act on. Tasks are
 * private by default: the portal used to list every unapproved task for the client, which
 * exposed internal work and let any contact approve it (and `client_approved_at` is read by
 * spawn-gate.py as the client's yes, which publishes).
 *
 * A task is client-visible only if
 *   1. a client contact requested it (`requested_by_contact_id` set), OR
 *   2. it is staged for the client's approval.
 *
 * "Staged for approval" = `staging_preview_url` is a non-empty string AND status is `review`
 * or `done`. The worker finishes staged work as done + needs_review, and the portal fixtures
 * use `review`; `not_started` (sent back for changes), `in_progress`, `blocked` and `abandoned`
 * are not awaiting the client. Approve and request-changes require "staged" in addition to
 * "visible".
 *
 * NOTE: staged also requires the task not be `approved` (already published).
 * NOTE: the unbuilt wp-delta pipeline (skills/wp-delta-pipeline/citadel-schema-sop.md:233) keeps
 * staged tasks at `in_progress` with an awaiting-approval tag. The {review, done} rule will need
 * to include that case when that pipeline ships.
 *
 * Every portal route that selects tasks must spread these fragments into its `where` (via
 * AND so the client-scope `OR` is never overwritten) and every row-level check must use the
 * predicates, so the rule cannot drift between routes.
 */

export const PORTAL_STAGED_STATUSES = ['review', 'done'] as const;

/** Prisma where-fragment: task is staged for the client's approval. */
export function stagedTaskWhere() {
  return {
    staging_preview_url: { not: null },
    NOT: { staging_preview_url: '' },
    status: { in: [...PORTAL_STAGED_STATUSES] },
    // Already-published work keeps its staging url forever (and pre-2026-10-15 email approvals
    // set approved without client_approved_at), so it must never read as awaiting the client.
    approved: false,
  };
}

/** Prisma where-fragment: task is client-visible (requested by a contact, or staged). */
export function clientVisibleTaskWhere() {
  return {
    OR: [{ requested_by_contact_id: { not: null } }, stagedTaskWhere()],
  };
}

interface VisibilityFields {
  requested_by_contact_id?: string | null;
  staging_preview_url?: string | null;
  status?: string | null;
  approved?: boolean | null;
}

/** Predicate twin of stagedTaskWhere(). */
export function isStagedForApproval(task: VisibilityFields): boolean {
  return (
    typeof task.staging_preview_url === 'string' &&
    task.staging_preview_url.length > 0 &&
    !task.approved &&
    (PORTAL_STAGED_STATUSES as readonly string[]).includes(task.status ?? '')
  );
}

/** Predicate twin of clientVisibleTaskWhere(). */
export function isClientVisibleTask(task: VisibilityFields): boolean {
  return Boolean(task.requested_by_contact_id) || isStagedForApproval(task);
}

/** The select fields the predicates need; spread into any select that uses them. */
export const VISIBILITY_SELECT = {
  requested_by_contact_id: true,
  staging_preview_url: true,
  status: true,
  approved: true,
} as const;
