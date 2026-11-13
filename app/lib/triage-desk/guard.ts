/**
 * The triage-desk lane: what a Claude session may do to a Triage card, field by field. The lane list (lib/auth/lane-scopes.ts) decides which routes it
 * reaches; this file narrows what it may write on them. Every function is a no-op for a caller that does not carry the lane, and every refusal is a
 * 403 (or a 400 for a malformed body) with a code that starts `desk_`.
 *
 * MAY:  read a task, its comments, its questions, the /triage card and the card's conversation; change a card's kind, project link and dates
 *       (PATCH /triage) and its shape (PUT /triage/shape); ask a question, edit or withdraw ITS OWN; add an internal comment; mark a card looks-done.
 * MAY NOT: release, drop or close a card (any status change; mayLeaveTriage stays Mike's session and the chat lane), answer a question, call a chat op,
 *       send anything, delete, change a field a client reads on a task a client can see, or touch a task that is not in Triage beyond reading it and
 *       commenting on it.
 * Every change it makes is recorded as "Changed by a session" on the card (lib/triage-desk/changes.ts).
 * The lane check uses the multi-lane helper (a key may carry several lanes: `auth.lane` is a comma list), never `===`.
 */
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { LOOKS_DONE_TAG } from '@/lib/tasks/looks-done';
import { PORTAL_HIDDEN_PROJECT_STATUSES } from '@/lib/portal/access';
import { isTriageDeskLaneValue } from './identity';

type LaneAuth = Pick<AuthPayload, 'lane'>;
type Db = PrismaClient;

export function isTriageDeskLane(auth: LaneAuth): boolean {
  return isTriageDeskLaneValue(auth.lane);
}

const refuse = (message: string, code: string): never => {
  throw new ApiError(message, 403, code);
};
const badBody = (message: string, code = 'desk_bad_body'): never => {
  throw new ApiError(message, 400, code);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) badBody('Send a JSON object.');
  return body as Record<string, unknown>;
}

/** PATCH /api/tasks/:id as the desk: the looks-done mark on a Triage card and nothing else. Returns the body for the patch (the full tag list). */
export function guardDeskTaskPatch(auth: LaneAuth, rawBody: unknown, existing: { status: string; tags: string[] }): Record<string, unknown> | null {
  if (!isTriageDeskLane(auth)) return null;
  const body = requireObject(rawBody);
  if (existing.status !== 'triage') refuse('The triage desk changes cards in Triage only; on any other task it reads and comments.', 'desk_not_triage');
  const keys = Object.keys(body);
  const add = body.tags_add;
  const only = keys.length === 1 && keys[0] === 'tags_add' && Array.isArray(add) && add.length > 0 && add.every((t) => t === LOOKS_DONE_TAG);
  if (!only) refuse('On a Triage card a session can only mark it looks-done (tags_add: ["triage:looks-done"]). It never releases, drops or closes a card.', 'desk_field_closed');
  return { tags: [...new Set([...existing.tags, LOOKS_DONE_TAG])] };
}

/** POST /api/tasks/:id/comments as the desk: always an internal note, never shown to a client, never a question for one. */
export function guardDeskComment(auth: LaneAuth, data: { client_visible?: boolean; client_question?: boolean }): { is_internal: true } | null {
  if (!isTriageDeskLane(auth)) return null;
  if (data.client_visible || data.client_question) refuse('A session writes internal notes only; it never sends to a client.', 'desk_client_closed');
  return { is_internal: true };
}

/** POST /api/tasks/:id/questions as the desk: only on a card in Triage. */
export function guardDeskQuestionAsk(auth: LaneAuth, task: { status: string }): void {
  if (!isTriageDeskLane(auth)) return;
  if (task.status !== 'triage') refuse('A session asks questions on cards in Triage only.', 'desk_not_triage');
}

/** PATCH /api/tasks/:id/questions/:qid as the desk: a question this lane asked, on a Triage card; withdrawing needs a reason. */
export async function guardDeskQuestionPatch(auth: LaneAuth, task: { id: string; status: string }, qid: string, body: { withdraw?: boolean; reason?: string }, db: Db = prisma): Promise<void> {
  if (!isTriageDeskLane(auth)) return;
  if (task.status !== 'triage') refuse('A session changes questions on cards in Triage only.', 'desk_not_triage');
  if (!UUID_RE.test(qid)) return; // the route answers 404
  const q = await db.taskQuestion.findFirst({ where: { id: qid, task_id: task.id }, select: { asked_by_lane: true } });
  if (!q) return; // the route answers 404
  if (!isTriageDeskLaneValue(q.asked_by_lane)) refuse('A session edits or withdraws only the questions it asked itself.', 'desk_not_yours');
  if (body.withdraw && !(body.reason ?? '').trim()) badBody('Say why you are withdrawing it (reason).', 'desk_reason_required');
}

const TRIAGE_PATCH_KEYS = new Set(['kind', 'project_id', 'target_start_date', 'target_launch_date']);

/**
 * PATCH /api/tasks/:id/triage as the desk: kind, project link and the two dates. The dates are the linked project's own start and target dates, which
 * a client reads on a project the portal shows, so they are refused unless the project is one the portal hides (quote, queue, suspended, cancelled, or
 * its portal visibility set to hidden: the portal's own rule, PORTAL_HIDDEN_PROJECT_STATUSES).
 */
export async function guardDeskTriagePatch(auth: LaneAuth, rawBody: unknown, linkedProjectId: string | null, db: Db = prisma): Promise<void> {
  if (!isTriageDeskLane(auth)) return;
  const body = requireObject(rawBody);
  for (const k of Object.keys(body)) if (!TRIAGE_PATCH_KEYS.has(k)) refuse(`A session cannot set "${k}" on a card.`, 'desk_field_closed');
  const datesGiven = body.target_start_date !== undefined || body.target_launch_date !== undefined;
  if (!datesGiven) return;
  const projectId = typeof body.project_id === 'string' ? body.project_id : body.project_id === undefined ? linkedProjectId : null;
  if (!projectId) return; // the route answers 409 no_project
  await refuseIfPortalShowsProject(db, projectId);
}

/** PUT /api/tasks/:id/triage/shape as the desk: only a project the portal hides (the route already insists on the queue). */
export async function guardDeskShape(auth: LaneAuth, projectId: string | null, db: Db = prisma): Promise<void> {
  if (!isTriageDeskLane(auth) || !projectId) return;
  await refuseIfPortalShowsProject(db, projectId);
}

async function refuseIfPortalShowsProject(db: Db, projectId: string): Promise<void> {
  const p = await db.project.findFirst({ where: { id: projectId, is_deleted: false }, select: { status: true, portal_visibility: true } });
  if (!p) return; // the route answers 404
  const hidden = p.portal_visibility === 'hidden' || (PORTAL_HIDDEN_PROJECT_STATUSES as readonly string[]).includes(p.status);
  if (!hidden) refuse('A client can see this project in their portal, so a session does not change its dates or shape.', 'desk_client_closed');
}
