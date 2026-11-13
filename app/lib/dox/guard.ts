/**
 * Dox, the office manager: what its lane key may write, field by field. The lane list (lib/auth/lane-scopes.ts) decides which routes it
 * reaches; this file narrows the task, project, wait and comment writes on those routes. Every function is a no-op for any caller that is
 * not the Dox lane, and every refusal is a 403 with a code that starts `dox_`.
 *
 * The one project in play is named by the `x-dox-project` header (the project of the brief, or the project whose setup card Dox holds). A
 * write to a task of any other project is refused; the only writes that reach any task are a comment, a question, and the looks-done tag on a
 * Triage card. Nothing here lets a task leave Triage (task-patch.ts mayLeaveTriage already refuses a lane that is not bast-chat), be deleted,
 * or become visible to a client.
 */
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { LOOKS_DONE_TAG } from '@/lib/tasks/looks-done';
import { DOX_LANE } from './identity';

export const DOX_PROJECT_HEADER = 'x-dox-project';
/** Holds Dox may take off a card it is picking up: a dead session's hold, and the "wait for the PM to release" hold. */
export const DOX_REMOVABLE_TAGS = ['cockpit-owned', 'needs-pm-release'] as const;
export const DOX_ADDABLE_TAGS = [LOOKS_DONE_TAG] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LaneAuth = Pick<AuthPayload, 'lane'>;
export function isDoxLane(auth: LaneAuth): boolean {
  return auth.lane === DOX_LANE;
}

const refuse = (message: string, code: string): never => {
  throw new ApiError(message, 403, code);
};

/** The project the Dox call is about, from the header; null when the header is absent or not an id. */
export function doxProjectOf(headers: Pick<Headers, 'get'>): string | null {
  const v = (headers.get(DOX_PROJECT_HEADER) ?? '').trim().toLowerCase();
  return UUID_RE.test(v) ? v : null;
}

const POST_TASK_FIELDS = new Set([
  'title', 'description', 'status', 'priority', 'project_id', 'phase_id', 'phase', 'assignee_id', 'function_id', 'due_date',
  'tags', 'blocked_by_ids', 'energy_estimate', 'mystery_factor', 'battery_impact', 'sop_id', 'notes', 'requirements', 'sort_order',
]);
const PATCH_TASK_FIELDS = new Set(['assignee_id', 'due_date', 'blocked_by_ids', 'phase_id', 'phase', 'tags_add', 'tags_remove', 'status']);

export interface DoxTaskHead {
  status: string;
  project_id: string | null;
  tags: string[];
}

/** POST /api/tasks as Dox: a new task on the project in play, status not_started, never Triage. Returns the body to use. */
export function guardDoxTaskCreate(auth: LaneAuth, headers: Pick<Headers, 'get'>, body: Record<string, unknown>): Record<string, unknown> {
  if (!isDoxLane(auth)) return body;
  const project = doxProjectOf(headers);
  if (!project) refuse('Dox creates tasks on one project at a time: send the x-dox-project header.', 'dox_no_project');
  for (const k of Object.keys(body)) {
    if (!POST_TASK_FIELDS.has(k)) refuse(`Dox cannot set "${k}" on a new task.`, 'dox_field_closed');
  }
  if (body.project_id !== project) refuse('A task Dox creates belongs to the project in the x-dox-project header.', 'dox_outside_project');
  if (body.status !== undefined && body.status !== 'not_started') refuse('Dox creates tasks as not_started, never in Triage or any other status.', 'dox_status_closed');
  return { ...body, status: 'not_started' };
}

/**
 * PATCH /api/tasks/:id as Dox. Allowed: assignee, due date, blockers, phase, take a dead session hold or needs-pm-release off, return an idle in_progress
 * task to not_started, and the looks-done tag on a Triage card. Returns the body to hand to the patch (tags_add and tags_remove become `tags`).
 */
export function guardDoxTaskPatch(auth: LaneAuth, headers: Pick<Headers, 'get'>, body: Record<string, unknown>, existing: DoxTaskHead): Record<string, unknown> {
  if (!isDoxLane(auth)) return body;
  for (const k of Object.keys(body)) {
    if (!PATCH_TASK_FIELDS.has(k)) refuse(`Dox cannot change "${k}" on a task.`, 'dox_field_closed');
  }
  const add = Array.isArray(body.tags_add) ? (body.tags_add as unknown[]) : [];
  const remove = Array.isArray(body.tags_remove) ? (body.tags_remove as unknown[]) : [];
  if ((body.tags_add !== undefined && !Array.isArray(body.tags_add)) || (body.tags_remove !== undefined && !Array.isArray(body.tags_remove))) {
    refuse('tags_add and tags_remove are lists.', 'dox_field_closed');
  }

  // A Triage card: the looks-done mark and nothing else, on any card (it is how Dox says "this looks finished").
  if (existing.status === 'triage') {
    const only = Object.keys(body).every((k) => k === 'tags_add');
    if (!only || add.length === 0 || !add.every((t) => t === LOOKS_DONE_TAG)) refuse('On a Triage card Dox can only mark it looks-done.', 'dox_triage_closed');
    return { tags: [...new Set([...existing.tags, LOOKS_DONE_TAG])] };
  }
  if (add.length > 0) refuse('Dox adds the looks-done tag to Triage cards only.', 'dox_tag_closed');
  for (const t of remove) {
    if (!(DOX_REMOVABLE_TAGS as readonly unknown[]).includes(t)) refuse('Dox can take off only a dead session hold (cockpit-owned) or needs-pm-release.', 'dox_tag_closed');
  }

  // Outside the project in play: refused. A card with no project is Dox's only when it was released from Triage (tag from-triage).
  const project = doxProjectOf(headers);
  if (existing.project_id) {
    if (!project || project !== existing.project_id) refuse('That task is outside the project Dox is working on.', 'dox_outside_project');
  } else if (!existing.tags.includes('from-triage')) {
    refuse('That task is outside what Dox sets up.', 'dox_outside_project');
  }

  if (body.status !== undefined) {
    if (body.status !== 'not_started' || existing.status !== 'in_progress') refuse('Dox can only return an in_progress task to not_started.', 'dox_status_closed');
  }
  if (body.phase_id !== undefined && !existing.project_id) refuse('A card with no project has no phases.', 'dox_field_closed');

  const out: Record<string, unknown> = { ...body };
  delete out.tags_add;
  delete out.tags_remove;
  if (remove.length > 0) out.tags = existing.tags.filter((t) => !remove.includes(t));
  return out;
}

const PROJECT_PATCH_FIELDS = new Set(['start_date', 'target_date', 'dependencies_ordering_only']);

export interface DoxProjectHead {
  id: string;
  status: string;
  /** Non-deleted tasks that are not done or abandoned. */
  open_task_count: number;
  total_task_count: number;
}

/**
 * PATCH /api/projects/:id as Dox: the two dates and ordering-only (together), or a status alone: ready -> in_progress, or in_progress/review ->
 * done once every task is done or abandoned. queue -> ready is the owner's release.
 */
export function guardDoxProjectPatch(auth: LaneAuth, headers: Pick<Headers, 'get'>, body: Record<string, unknown>, existing: DoxProjectHead): void {
  if (!isDoxLane(auth)) return;
  const project = doxProjectOf(headers);
  if (!project || project !== existing.id) refuse('That project is not the one Dox is working on.', 'dox_outside_project');
  const keys = Object.keys(body);
  if (keys.length === 0) refuse('Nothing to change.', 'dox_field_closed');
  if (keys.includes('status')) {
    if (keys.length !== 1) refuse('Send a status change on its own.', 'dox_field_closed');
    const to = body.status;
    const from = existing.status;
    if (to === 'in_progress' && from === 'ready') return;
    if (to === 'done' && (from === 'in_progress' || from === 'review')) {
      if (existing.total_task_count === 0 || existing.open_task_count > 0) refuse('A project closes only when all of its tasks are done.', 'dox_project_open');
      return;
    }
    refuse(`Dox cannot move a project from ${from} to ${String(to)}.`, 'dox_status_closed');
  }
  for (const k of keys) {
    if (!PROJECT_PATCH_FIELDS.has(k)) refuse(`Dox cannot change "${k}" on a project.`, 'dox_field_closed');
  }
}

/** POST /api/waits as Dox: any live template except the price review (a money note to a client). */
export function guardDoxWaitCreate(auth: LaneAuth, body: { template_key?: unknown }): void {
  if (!isDoxLane(auth)) return;
  if (typeof body.template_key === 'string' && body.template_key.startsWith('charter.price_review')) {
    refuse('Dox does not open a price review.', 'dox_wait_closed');
  }
}

/** PATCH /api/waits/:id as Dox: a resolve that is a send, or a sign-off, is not Dox's call. */
export function guardDoxWaitPatch(auth: LaneAuth, body: { action?: unknown; resolution?: unknown }): void {
  if (!isDoxLane(auth)) return;
  if (body.action === 'resolve' && ['sent', 'signed', 'approved'].includes(String(body.resolution))) {
    refuse('Dox cannot resolve a wait as sent, signed or approved: that is a person\'s word.', 'dox_wait_closed');
  }
}

/** POST /api/tasks/:id/comments as Dox: always an internal note. Never shown to a client, never a question for one. */
export function guardDoxComment(auth: LaneAuth, data: { client_visible?: boolean; client_question?: boolean; is_internal?: boolean }): { is_internal: true } | null {
  if (!isDoxLane(auth)) return null;
  if (data.client_visible || data.client_question) refuse('Dox writes internal notes only; it never sends to a client.', 'dox_client_closed');
  return { is_internal: true };
}

/** Who may read a project snapshot or start its brief: the owner's own signed-in session, or the Dox lane. */
export function mayReadSnapshot(auth: Pick<AuthPayload, 'lane' | 'via' | 'userId' | 'role'>, ownerId: string): boolean {
  if (isDoxLane(auth)) return true;
  return auth.via !== 'api_key' && auth.userId === ownerId;
}
