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
 *   2. it is staged for the client's approval, OR
 *   3. staff explicitly shared it (`client_visible` = true, portal MVP A3).
 * `client_visible` only widens LISTS: pending/approve/request-changes still require "staged".
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

/** Prisma where-fragment: task is client-visible (requested by a contact, shared, or staged). */
export function clientVisibleTaskWhere() {
  return {
    OR: [{ requested_by_contact_id: { not: null } }, { client_visible: true }, stagedTaskWhere()],
  };
}

/**
 * Prisma where-fragment for HISTORY lists only (home activity feed, tasks recently-approved):
 * client-visible OR the client has approved it. Staged work stops matching the visible rule
 * once published (approved = true), but the client's own approval must stay in their history.
 * Never use for pending lists or approve/request-changes.
 */
export function clientHistoryTaskWhere() {
  return {
    OR: [{ client_approved_at: { not: null } }, ...clientVisibleTaskWhere().OR],
  };
}

interface VisibilityFields {
  requested_by_contact_id?: string | null;
  client_visible?: boolean | null;
  staging_preview_url?: string | null;
  status?: string | null;
  approved?: boolean | null;
  client_approved_at?: Date | string | null;
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
  return Boolean(task.requested_by_contact_id) || task.client_visible === true || isStagedForApproval(task);
}

/** Predicate twin of clientHistoryTaskWhere(). */
export function isClientHistoryTask(task: VisibilityFields): boolean {
  return Boolean(task.client_approved_at) || isClientVisibleTask(task);
}

/** The select fields the predicates need; spread into any select that uses them. */
export const VISIBILITY_SELECT = {
  requested_by_contact_id: true,
  client_visible: true,
  staging_preview_url: true,
  status: true,
  approved: true,
} as const;
