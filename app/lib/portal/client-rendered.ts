/**
 * What the client portal and the client emails render FROM A TASK, in one list, so a lane that must not change what a client reads can ask one place.
 * Pure: no database. Visibility itself stays in lib/portal/visibility.ts (the ONE place that decides who sees a task); this file only says which
 * task fields a client reads once the task is visible, and which of them carry free text.
 *
 * Read from: app/api/portal/{home,tasks,history,projects,requests,retainer}, lib/portal/* (project-detail, project-view, requests, retainer, history,
 * thread, notices, waits, go-live, status-labels), lib/api/client-projections.ts (formatTaskForClient: the explicit allow list), the client emails
 * (approval draft and chase in lib/services/approval-requests.ts, the reply notice in lib/portal/notices.ts, the approval-link and notify-requestor mail).
 */
import { isClientHistoryTask } from './visibility';

export type RenderedKind = 'text' | 'routing' | 'state' | 'tag';

/** Every task column a client can read, with where, and what kind of change it is. Columns not here are never shown to a client. */
export const CLIENT_RENDERED_TASK_FIELDS: Record<string, { kind: RenderedKind; where: string }> = {
  title: { kind: 'text', where: 'portal home, work, history, project page, requests, retainer; approval, chase and reply-notice emails' },
  client_title: { kind: 'text', where: 'the client-facing title: portal requests and thread, reply-notice email, preferred over title wherever set (no chat or session lane can write it)' },
  description: { kind: 'text', where: 'portal work list and approval page (formatTaskForClient)' },
  requirements: { kind: 'text', where: 'not rendered today (formatTaskForClient hides it); guarded anyway because the owner listed the checklist text' },
  client_id: { kind: 'routing', where: 'decides which client portal lists the task' },
  site_id: { kind: 'routing', where: 'the task is scoped to a client through its site, and the requests list shows the site name' },
  project_id: { kind: 'routing', where: "the project's page, progress and phase track show the task" },
  phase_id: { kind: 'routing', where: "the project page's phase track groups tasks by phase" },
  status: { kind: 'state', where: 'portal status label, progress, the recent-activity feed and the staged/approval rules' },
  approved: { kind: 'state', where: 'published/approved label and the staged rule' },
  client_visible: { kind: 'state', where: 'whether the task is listed at all' },
  staging_preview_url: { kind: 'state', where: 'the preview link in the approval page and email' },
  staging_deployed_at: { kind: 'state', where: 'the "new build" marker on the approval page' },
  client_approved_at: { kind: 'state', where: 'history and recent activity' },
  requested_by_contact_id: { kind: 'state', where: 'makes the task the contact\'s own request' },
  tags: { kind: 'tag', where: 'only the tags in PORTAL_RENDERED_TAGS change what a client sees' },
};

/**
 * Tags the portal reads. Kept as strings (this module is pure); a test pins each to the constant it mirrors.
 *   awaiting-clarification  the open-questions panel (lib/portal/project-view.ts AWAITING_CLARIFICATION_TAG)
 *   client-approved         the approved label (lib/services/portal.ts CLIENT_APPROVED_TAG)
 *   client-sent-back        the sent-back label (lib/services/portal.ts SEND_BACK_TAG)
 *   client-cancelled        the cancelled label and history (lib/portal/status-labels.ts CLIENT_CANCELLED_TAG)
 *   marketing-plan          the retainer card's "plan ready for you" (lib/portal/retainer.ts PLAN_TAG)
 *   chat-question           a portal chat question marker (lib/portal/chat)
 *   quote                   the request label "We will quote this" (lib/portal/status-labels.ts REQUEST_LABELS.quote)
 *   emergency               the request label "Urgent" and the urgent line (lib/portal/status-labels.ts, lib/portal/chat/view.ts)
 */
export const PORTAL_RENDERED_TAGS: readonly string[] = ['awaiting-clarification', 'client-approved', 'client-sent-back', 'client-cancelled', 'marketing-plan', 'chat-question', 'quote', 'emergency'];

/** The free-text and routing fields: a chat change to one of these on a task a client can see needs the owner's tap; a strict lane may not make it at all. */
export const CLIENT_TEXT_FIELDS: readonly string[] = Object.entries(CLIENT_RENDERED_TASK_FIELDS).filter(([, v]) => v.kind === 'text').map(([k]) => k);
export const CLIENT_ROUTING_FIELDS: readonly string[] = Object.entries(CLIENT_RENDERED_TASK_FIELDS).filter(([, v]) => v.kind === 'routing').map(([k]) => k);

interface ShownFields {
  requested_by_contact_id?: string | null;
  client_visible?: boolean | null;
  staging_preview_url?: string | null;
  status?: string | null;
  approved?: boolean | null;
  client_approved_at?: Date | string | null;
}

/**
 * True when the portal shows this task in any way today: client-visible by any of its rules (requested by a contact, shared, staged) or in the
 * client's history (they approved it). A Triage card is never shown. Uses the portal's own predicates.
 */
export function isShownInPortal(task: ShownFields): boolean {
  return isClientHistoryTask(task);
}

/** The portal tags that differ between two tag lists (added or removed). */
export function portalTagsChanged(before: readonly string[] | null | undefined, after: readonly string[] | null | undefined): string[] {
  const b = new Set(before ?? []);
  const a = new Set(after ?? []);
  const diff = [...b].filter((t) => !a.has(t)).concat([...a].filter((t) => !b.has(t)));
  return diff.filter((t) => PORTAL_RENDERED_TAGS.includes(t));
}

/**
 * The client-rendered fields of a task that a planned change touches, given the names of the fields that actually change (`changed`) and, for tags,
 * the before and after lists. `strict` adds the state fields (status and the rest): strict lanes (Dox, the triage desk) may not touch any of them on a
 * task the portal shows; the chat lane's tap covers text, routing and portal tags (a state change is a fixed choice with no words, judged by the
 * visibility rules as before).
 */
export function renderedFieldsTouched(
  changed: readonly string[],
  tags: { before?: readonly string[] | null; after?: readonly string[] | null } | null,
  opts: { strict?: boolean } = {},
): string[] {
  const out: string[] = [];
  for (const f of changed) {
    const meta = CLIENT_RENDERED_TASK_FIELDS[f];
    if (!meta || f === 'tags') continue;
    if (meta.kind === 'text' || meta.kind === 'routing' || opts.strict) out.push(f);
  }
  if (changed.includes('tags') && portalTagsChanged(tags?.before, tags?.after).length > 0) out.push('tags');
  return out;
}

/**
 * Every PROJECT column or child row the portal renders, read from lib/portal/project-detail.ts, app/api/portal/home and app/api/portal/projects:
 * name, status (as a label), target_date, completed_date, and the phase names (the phase track). start_date is not rendered, but it is a date
 * the owner sets with the launch date, so it is guarded with them. A lane that must not change what a client reads refuses these on a project the
 * portal shows (isProjectShownInPortal); the chat lane's status change is already a tap (lib/bast-chat/ops/project.ts), its date change through a
 * Triage card is refused here and left to the owner's own session.
 */
export const CLIENT_RENDERED_PROJECT_FIELDS: readonly string[] = ['name', 'status', 'start_date', 'target_date', 'completed_date', 'phases'];
/** The portal's own rule (lib/portal/access.ts projectAccessScope): hidden statuses, or visibility set to hidden. */
export function isProjectShownInPortal(p: { status: string; portal_visibility: string }): boolean {
  return p.portal_visibility !== 'hidden' && !(HIDDEN_PROJECT_STATUSES as readonly string[]).includes(p.status);
}
const HIDDEN_PROJECT_STATUSES = ['quote', 'queue', 'suspended', 'cancelled'] as const;
