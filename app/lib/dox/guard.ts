/**
 * Dox, the office manager: what its lane key may write, field by field. The lane list (lib/auth/lane-scopes.ts) decides which routes it
 * reaches; this file narrows the task, project, wait, comment and question writes on those routes. Every function is a no-op for any caller
 * that does not carry the Dox lane, and every refusal is a 403 (or a 400 for a malformed body) with a code that starts `dox_`.
 *
 * THE PROJECT IN PLAY. A Dox write to a project's tasks, waits or the project itself is allowed only when
 *   1. the `x-dox-project` header names the project (the declaration), and
 *   2. that project is live (ready, in_progress or review): Dox never writes to a quote, queue, suspended, done or cancelled project, and
 *   3. an OPEN EngagementPass for it, started through the dox lane, exists (EngagementPass.lane carries `dox`, finished_at is null, and it was
 *      started less than DOX_PASS_MAX_AGE_MS ago). The pass is Dox's "I am working on this project now" record: starting one is how a sweep or a
 *      setup begins and it is closed at the end, so the header is checked against the server's own record, never trusted alone.
 * Reads of other live projects stay open; a snapshot or brief of a QUOTE project (it carries prices) needs an open pass.
 *
 * Nothing here lets a task leave Triage (task-patch.ts mayLeaveTriage already refuses a lane that is not bast-chat), be deleted, or become
 * visible to a client. The lane check uses the multi-lane helper (a key may carry several lanes: `auth.lane` is a comma list), never `===`.
 */
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
import { LOOKS_DONE_TAG } from '@/lib/tasks/looks-done';
import { FROM_TRIAGE_TAG, PM_RELEASE_TAG } from '@/lib/tasks/triage-kind';
import { isProjectShownInPortal, isShownInPortal, renderedFieldsTouched } from '@/lib/portal/client-rendered';
import { getTemplate } from '@/lib/waits/templates';
import { liveSessionTaskIds } from '@/lib/work/state';
import { DOX_LANE, isDoxLaneValue } from './identity';

export const DOX_PROJECT_HEADER = 'x-dox-project';
export const DOX_CARD_HEADER = 'x-dox-card';
/** Holds Dox may take off a card it is picking up: a dead session's hold, and the "wait for the PM to release" hold. */
export const DOX_REMOVABLE_TAGS = ['cockpit-owned', PM_RELEASE_TAG] as const;
export const DOX_ADDABLE_TAGS = [LOOKS_DONE_TAG] as const;
/** The only tags a task Dox creates may carry: `from-dox` and `setup:<card id>` (ties a created task to the setup card it came from). */
export const FROM_DOX_TAG = 'from-dox';
export const SETUP_TAG_PREFIX = 'setup:';
/** A project is live (writable) in these statuses. */
export const DOX_LIVE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
/** An open pass older than this no longer counts: a pass someone forgot to close does not keep the door open for ever. */
export const DOX_PASS_MAX_AGE_MS = 24 * 3600 * 1000;
/** A bot-held task counts as a dead hold only after this long with no movement. */
export const DOX_HOLD_DEAD_MS = 48 * 3600 * 1000;
/** Project types Dox may create (the plan calls for one): any of the project type enum. A card of ANY kind may become a project (Mike, 2026-11-13: "Dox should be able to create a project of any size"). */
export const DOX_PROJECT_TYPES = ['project', 'retainer', 'internal'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LaneAuth = Pick<AuthPayload, 'lane'>;
type Hdrs = Pick<Headers, 'get'>;
type Db = PrismaClient;

/** True when the caller's key carries the Dox lane (alone or with others). */
export function isDoxLane(auth: LaneAuth): boolean {
  return isDoxLaneValue(auth.lane);
}

const refuse = (message: string, code: string): never => {
  throw new ApiError(message, 403, code);
};
const badBody = (message: string, code = 'dox_bad_body'): never => {
  throw new ApiError(message, 400, code);
};

/** A request body must be a JSON object: a null, a list or a bare value is a 400, never a crash. */
export function requireObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) badBody('Send a JSON object.');
  return body as Record<string, unknown>;
}

function uuidHeader(headers: Hdrs, name: string): string | null {
  const v = (headers.get(name) ?? '').trim().toLowerCase();
  return UUID_RE.test(v) ? v : null;
}

/** The project the Dox call is about, from the header; null when the header is absent or not an id. */
export function doxProjectOf(headers: Hdrs): string | null {
  return uuidHeader(headers, DOX_PROJECT_HEADER);
}

export interface PlayProject {
  id: string;
  status: string;
  type: string;
  client_id: string;
  name: string;
}

/** The open Dox pass for a project (or null). Started through the dox lane, not finished, not older than DOX_PASS_MAX_AGE_MS. */
export async function openDoxPass(db: Db, projectId: string, now: Date = new Date()): Promise<{ id: string } | null> {
  const brief = await db.engagementBrief.findUnique({ where: { project_id: projectId }, select: { id: true } });
  if (!brief) return null;
  const rows = await db.engagementPass.findMany({
    where: { brief_id: brief.id, finished_at: null, started_at: { gte: new Date(now.getTime() - DOX_PASS_MAX_AGE_MS) }, lane: { contains: DOX_LANE } },
    select: { id: true, lane: true },
    take: 10,
  });
  return rows.find((r) => isDoxLaneValue(r.lane)) ?? null;
}

/**
 * The project this Dox write is bound to: the header names it, it is live, and Dox holds an open pass on it. `expect`, when given (a project
 * route's own id), must be that very project. Refuses with a code that says which of the three failed.
 */
export async function requireProjectInPlay(headers: Hdrs, expect?: string | null, db: Db = prisma): Promise<PlayProject> {
  const header = doxProjectOf(headers);
  if (!header) return refuse('Dox writes to one project at a time: send the x-dox-project header.', 'dox_no_project');
  if (expect && header !== expect.toLowerCase()) return refuse('That is not the project Dox is working on.', 'dox_outside_project');
  const project = await db.project.findFirst({ where: { id: header, is_deleted: false }, select: { id: true, status: true, type: true, client_id: true, name: true } });
  if (!project) return refuse('That is not the project Dox is working on.', 'dox_outside_project');
  if (!(DOX_LIVE_PROJECT_STATUSES as readonly string[]).includes(project.status)) {
    return refuse(`Dox does not write to a project that is ${project.status}: only ready, in progress or in review.`, 'dox_project_closed');
  }
  if (!(await openDoxPass(db, project.id))) {
    return refuse('Start a pass on this project first (POST /api/engagement-briefs/:id/passes): Dox writes only while a pass it started is open.', 'dox_no_pass');
  }
  return project as PlayProject;
}

// ---------------------------------------------------------------- tasks

const POST_TASK_FIELDS = new Set([
  'title', 'description', 'status', 'priority', 'project_id', 'phase_id', 'phase', 'assignee_id', 'function_id', 'due_date',
  'tags', 'blocked_by_ids', 'energy_estimate', 'mystery_factor', 'battery_impact', 'sop_id', 'notes', 'requirements', 'sort_order',
]);
/**
 * phase_id is not here on purpose: the task patch schema has no phase_id (it was silently dropped), and widening that shared schema for every
 * caller is not this lane's call. A phase is set when the task is created (POST validates it belongs to the project); moving a task to another
 * phase is refused with a clear message (dox_field_closed) rather than ignored.
 */
const PATCH_TASK_FIELDS = new Set(['assignee_id', 'due_date', 'blocked_by_ids', 'phase', 'tags_add', 'tags_remove', 'status']);

export interface DoxTaskHead {
  id?: string;
  status: string;
  project_id: string | null;
  tags: string[];
  assignee_id?: string | null;
  updated_at?: Date | string | null;
  /** What the portal's own visibility rules read (lib/portal/visibility.ts). Left out, the task counts as not shown. */
  requested_by_contact_id?: string | null;
  client_visible?: boolean | null;
  staging_preview_url?: string | null;
  approved?: boolean | null;
  client_approved_at?: Date | string | null;
}

/** The tags a created task may carry: nothing outside `from-dox` and `setup:<uuid>`. Returns the list to store. Pure. */
export function checkCreateTags(tags: unknown): string[] {
  if (tags === undefined || tags === null) return [];
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) return badBody('tags is a list of strings.');
  const out: string[] = [];
  for (const t of tags as string[]) {
    const ok = t === FROM_DOX_TAG || (t.startsWith(SETUP_TAG_PREFIX) && UUID_RE.test(t.slice(SETUP_TAG_PREFIX.length)));
    if (!ok) return refuse(`Dox cannot put the tag "${t}" on a new task: only ${FROM_DOX_TAG} and ${SETUP_TAG_PREFIX}<card id>.`, 'dox_tag_closed');
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** The blocker ids of a blocked_by_ids value (connect + disconnect), after a shape check. */
function blockerIdsOf(v: unknown): { connect: string[]; disconnect: string[] } {
  const o = requireObject(v);
  const pick = (k: string): string[] => {
    const x = o[k];
    if (x === undefined) return [];
    if (!Array.isArray(x) || !x.every((i) => typeof i === 'string' && UUID_RE.test(i))) return badBody(`blocked_by_ids.${k} is a list of task ids.`);
    return x as string[];
  };
  for (const k of Object.keys(o)) if (k !== 'connect' && k !== 'disconnect') badBody(`blocked_by_ids has only connect and disconnect, not "${k}".`);
  return { connect: pick('connect'), disconnect: pick('disconnect') };
}

/** Every blocker a connect names must be a task of the project in play (a dependency never reaches into another project). */
async function requireBlockersInProject(db: Db, ids: string[], projectId: string): Promise<void> {
  if (ids.length === 0) return;
  const found = await db.task.count({ where: { id: { in: ids }, project_id: projectId, is_deleted: false } });
  if (found !== new Set(ids).size) refuse('A blocker must be a task of the project Dox is working on.', 'dox_outside_project');
}

/**
 * Who a task may be assigned to. Bast (assigning agent work is Dox's job; the owner's release of the card was the yes) or a staff user. Never
 * another bot user, never an id that is not an active user (a client contact is not one), never nobody-by-typo. Assigning to Bast is allowed only
 * inside a project with an open pass (the caller has already established that) and returns true so the task can be tagged from-dox.
 */
async function checkAssignee(db: Db, assigneeId: unknown, opts: { inProject: boolean }): Promise<{ toBast: boolean }> {
  if (assigneeId === null) return { toBast: false };
  if (typeof assigneeId !== 'string' || !UUID_RE.test(assigneeId)) return badBody('assignee_id is a user id.');
  const user = await db.user.findFirst({ where: { id: assigneeId, is_active: true }, select: { id: true } });
  if (!user) return badBody('assignee_id must be an active staff user (a client contact is not one).', 'dox_assignee_closed');
  if (BOT_USER_IDS.includes(assigneeId)) {
    if (assigneeId !== BAST_USER_ID) return refuse('Dox assigns work to Bast or to a person, never to another bot user.', 'dox_assignee_closed');
    if (!opts.inProject) return refuse('Dox assigns agent work to Bast only inside a project it holds a pass on.', 'dox_assignee_closed');
    return { toBast: true };
  }
  return { toBast: false };
}

/** The phase must belong to the project the task is created in. */
async function requirePhaseInProject(db: Db, phaseId: unknown, projectId: string): Promise<void> {
  if (phaseId === undefined || phaseId === null) return;
  if (typeof phaseId !== 'string' || !UUID_RE.test(phaseId)) return badBody('phase_id is a phase id.');
  const n = await db.projectPhase.count({ where: { id: phaseId, project_id: projectId } });
  if (n !== 1) refuse('That phase is not a phase of this project.', 'dox_outside_project');
}

/** POST /api/tasks as Dox: a new task on the project in play, status not_started, never Triage. Returns the body to use. */
export async function guardDoxTaskCreate(auth: LaneAuth, headers: Hdrs, rawBody: unknown, db: Db = prisma): Promise<Record<string, unknown>> {
  if (!isDoxLane(auth)) return rawBody as Record<string, unknown>;
  const body = requireObject(rawBody);
  for (const k of Object.keys(body)) {
    if (!POST_TASK_FIELDS.has(k)) refuse(`Dox cannot set "${k}" on a new task.`, 'dox_field_closed');
  }
  const project = await requireProjectInPlay(headers, null, db);
  if (body.project_id !== project.id) refuse('A task Dox creates belongs to the project in the x-dox-project header.', 'dox_outside_project');
  if (body.status !== undefined && body.status !== 'not_started') refuse('Dox creates tasks as not_started, never in Triage or any other status.', 'dox_status_closed');
  const tags = checkCreateTags(body.tags);
  for (const t of tags) {
    if (!t.startsWith(SETUP_TAG_PREFIX)) continue;
    const card = await db.task.count({ where: { id: t.slice(SETUP_TAG_PREFIX.length), project_id: project.id, is_deleted: false } });
    if (card !== 1) refuse('A setup tag must name a card of the project Dox is working on.', 'dox_tag_closed');
  }
  const assign = body.assignee_id === undefined ? { toBast: false } : await checkAssignee(db, body.assignee_id, { inProject: true });
  await requirePhaseInProject(db, body.phase_id, project.id);
  if (body.blocked_by_ids !== undefined) {
    const raw = body.blocked_by_ids;
    const ids = Array.isArray(raw) ? raw : (raw as { connect?: unknown }).connect;
    if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && UUID_RE.test(i))) badBody('blocked_by_ids is a list of task ids.');
    await requireBlockersInProject(db, ids as string[], project.id);
  }
  if (assign.toBast && !tags.includes(FROM_DOX_TAG)) tags.push(FROM_DOX_TAG);
  return { ...body, status: 'not_started', tags };
}

/** True when a bot-held task's hold is dead: no live linked session (the snapshot's own rule) and no movement (task update or comment) for 48 hours. */
export async function holdIsDead(db: Db, task: { id: string; project_id: string | null; assignee_id: string | null; updated_at: Date | string | null }, now: Date = new Date()): Promise<boolean> {
  if (!task.assignee_id || !BOT_USER_IDS.includes(task.assignee_id)) return false;
  const live = await liveSessionTaskIds(db as never, [{ id: task.id, project_id: task.project_id }]);
  if (live.has(task.id)) return false;
  const newest = await db.comment.findFirst({ where: { task_id: task.id }, orderBy: { created_at: 'desc' }, select: { created_at: true } });
  const moved = Math.max(task.updated_at ? new Date(task.updated_at).getTime() : 0, newest?.created_at.getTime() ?? 0);
  return now.getTime() - moved >= DOX_HOLD_DEAD_MS;
}

/**
 * PATCH /api/tasks/:id as Dox. Allowed: assignee, due date, blockers (on a task that is not started or blocked), take a dead session hold or
 * needs-pm-release off, hand a bot-held task with a dead hold back to not_started, and the looks-done tag on a Triage card. Returns the body to
 * hand to the patch (tags_add and tags_remove become `tags`).
 */
export async function guardDoxTaskPatch(auth: LaneAuth, headers: Hdrs, rawBody: unknown, existing: DoxTaskHead, db: Db = prisma): Promise<Record<string, unknown>> {
  if (!isDoxLane(auth)) return rawBody as Record<string, unknown>;
  const body = requireObject(rawBody);
  for (const k of Object.keys(body)) {
    if (k === 'phase_id') refuse('Dox sets a task\'s phase when it creates the task; moving it to another phase is not something this lane does.', 'dox_field_closed');
    if (!PATCH_TASK_FIELDS.has(k)) refuse(`Dox cannot change "${k}" on a task.`, 'dox_field_closed');
  }
  if ((body.tags_add !== undefined && !Array.isArray(body.tags_add)) || (body.tags_remove !== undefined && !Array.isArray(body.tags_remove))) {
    refuse('tags_add and tags_remove are lists.', 'dox_field_closed');
  }
  const add = Array.isArray(body.tags_add) ? (body.tags_add as unknown[]) : [];
  const remove = Array.isArray(body.tags_remove) ? (body.tags_remove as unknown[]) : [];

  // A Triage card: the looks-done mark and nothing else, on any card (it is how Dox says "this looks finished").
  if (existing.status === 'triage') {
    const only = Object.keys(body).every((k) => k === 'tags_add');
    if (!only || add.length === 0 || !add.every((t) => t === LOOKS_DONE_TAG)) refuse('On a Triage card Dox can only mark it looks-done.', 'dox_triage_closed');
    return { tags: [...new Set([...existing.tags, LOOKS_DONE_TAG])] };
  }
  if (add.length > 0) refuse('Dox adds the looks-done tag to Triage cards only.', 'dox_tag_closed');
  // A task a client can see today: nothing the portal or a client email renders may change through this lane (its status, or a tag the portal reads).
  // The text fields (title, description, checklist, client title) and the routing fields are not on this lane's patch list at all (dox_field_closed above).
  if (isShownInPortal(existing)) {
    const changedNames = [...(body.status !== undefined ? ['status'] : []), ...(remove.length > 0 ? ['tags'] : [])];
    const touched = renderedFieldsTouched(changedNames, { before: existing.tags, after: existing.tags.filter((t) => !remove.includes(t)) }, { strict: true });
    if (touched.length > 0) refuse(`A client can see this task, so Dox does not change what the portal shows of it (${touched.join(', ')}).`, 'dox_client_closed');
  }
  for (const t of remove) {
    if (!(DOX_REMOVABLE_TAGS as readonly unknown[]).includes(t)) refuse('Dox can take off only a dead session hold (cockpit-owned) or needs-pm-release.', 'dox_tag_closed');
  }
  // needs-pm-release comes off only a card the owner released from Triage (tag from-triage): Dox is picking it up.
  if (remove.includes(PM_RELEASE_TAG) && !existing.tags.includes(FROM_TRIAGE_TAG)) {
    refuse('needs-pm-release comes off only a card that was released from Triage.', 'dox_tag_closed');
  }

  // The project binding: a task of a project is Dox's only inside the project in play (live, open pass). A card with no project is Dox's only
  // when it was released from Triage (tag from-triage).
  if (existing.project_id) {
    await requireProjectInPlay(headers, existing.project_id, db);
  } else if (!existing.tags.includes(FROM_TRIAGE_TAG)) {
    refuse('That task is outside what Dox sets up.', 'dox_outside_project');
  }

  let assignToBast = false;
  if (body.assignee_id !== undefined) assignToBast = (await checkAssignee(db, body.assignee_id, { inProject: !!existing.project_id })).toBast;

  if (body.blocked_by_ids !== undefined) {
    const b = blockerIdsOf(body.blocked_by_ids);
    if (b.connect.length + b.disconnect.length > 0) {
      // Connecting an unfinished blocker moves a task to blocked on its own (no status field needed), so only a task that is not started or already blocked.
      if (!['not_started', 'blocked'].includes(existing.status)) refuse(`Dox changes blockers only on a task that is not started or blocked, not on one that is ${existing.status}.`, 'dox_status_closed');
      if (existing.project_id) await requireBlockersInProject(db, b.connect, existing.project_id);
      else if (b.connect.length > 0) refuse('A card with no project has no blockers to connect.', 'dox_outside_project');
    }
  }

  if (body.status !== undefined) {
    if (body.status !== 'not_started' || existing.status !== 'in_progress') refuse('Dox can only return an in_progress task to not_started.', 'dox_status_closed');
    // Hand-back is for a dead agent hold only: the assignee is a bot user, no live session, no movement for 48 hours. Never a person's task.
    const dead = existing.id && (await holdIsDead(db, { id: existing.id, project_id: existing.project_id, assignee_id: existing.assignee_id ?? null, updated_at: existing.updated_at ?? null }));
    if (!dead) refuse('Dox hands a task back only when a bot holds it and the hold is dead: no live session and no movement for 48 hours. A person\'s task is theirs.', 'dox_status_closed');
  }

  const out: Record<string, unknown> = { ...body };
  delete out.tags_add;
  delete out.tags_remove;
  let tags = existing.tags;
  if (remove.length > 0) tags = tags.filter((t) => !remove.includes(t));
  if (assignToBast && !tags.includes(FROM_DOX_TAG)) tags = [...tags, FROM_DOX_TAG];
  if (tags !== existing.tags) out.tags = tags;
  return out;
}

/** A comment or a question on a task as Dox: not on a task of a quote, queue, suspended or finished project; on a live project only inside the project in play. A Triage card or a card with no project is open. */
export async function guardDoxTaskWrite(auth: LaneAuth, headers: Hdrs, task: { status: string; project_id: string | null }, db: Db = prisma): Promise<void> {
  if (!isDoxLane(auth)) return;
  if (task.status === 'triage' || !task.project_id) return;
  await requireProjectInPlay(headers, task.project_id, db);
}

// ---------------------------------------------------------------- projects

const PROJECT_PATCH_FIELDS = new Set(['start_date', 'target_date', 'dependencies_ordering_only']);

export interface DoxProjectHead {
  id: string;
  status: string;
  /** Non-deleted tasks that are not done or abandoned (Triage and blocked cards included). */
  open_task_count: number;
  /** Non-deleted tasks that are done. */
  done_task_count: number;
  total_task_count: number;
}

/**
 * PATCH /api/projects/:id as Dox: the two dates and ordering-only (together), or a status alone: ready -> in_progress, or in_progress/review ->
 * done once at least one task is done and none is open or in Triage (a project whose tasks were all abandoned is not finished: Dox raises a
 * question instead). queue -> ready is the owner's release. The project must be the one in play (live, open pass).
 */
export async function guardDoxProjectPatch(auth: LaneAuth, headers: Hdrs, rawBody: unknown, existing: DoxProjectHead, db: Db = prisma): Promise<void> {
  if (!isDoxLane(auth)) return;
  const body = requireObject(rawBody);
  await requireProjectInPlay(headers, existing.id, db);
  const keys = Object.keys(body);
  if (keys.length === 0) refuse('Nothing to change.', 'dox_field_closed');
  if (keys.includes('status')) {
    if (keys.length !== 1) refuse('Send a status change on its own.', 'dox_field_closed');
    const to = body.status;
    const from = existing.status;
    await refuseIfPortalShows(db, existing.id, 'status');
    if (to === 'in_progress' && from === 'ready') return;
    if (to === 'done' && (from === 'in_progress' || from === 'review')) {
      if (existing.done_task_count === 0 || existing.open_task_count > 0) {
        refuse('A project closes only when at least one task is done and none is still open. If everything was abandoned, raise a question instead.', 'dox_project_open');
      }
      return;
    }
    refuse(`Dox cannot move a project from ${from} to ${String(to)}.`, 'dox_status_closed');
  }
  for (const k of keys) {
    if (!PROJECT_PATCH_FIELDS.has(k)) refuse(`Dox cannot change "${k}" on a project.`, 'dox_field_closed');
  }
  await refuseIfPortalShows(db, existing.id, 'dates');
}

/** A project the client's portal shows: its name, dates, status and phase names are what a client reads, so Dox does not change them (lib/portal/client-rendered.ts). */
async function refuseIfPortalShows(db: Db, projectId: string, what: string): Promise<void> {
  const p = await db.project.findFirst({ where: { id: projectId, is_deleted: false }, select: { status: true, portal_visibility: true } });
  if (p && isProjectShownInPortal(p)) refuse(`A client can see this project in their portal, so Dox does not change its ${what}. Raise it with Mike.`, 'dox_client_closed');
}

const PROJECT_CREATE_FIELDS = new Set(['name', 'description', 'status', 'type', 'client_id', 'start_date', 'target_date', 'dependencies_ordering_only', 'notes']);

export interface DoxProjectCard {
  id: string;
  client_id: string | null;
}

/**
 * POST /api/projects as Dox: a project of any size for ONE released card. The request names the card (`x-dox-card`): a task tagged from-triage,
 * no longer in Triage, with no project, of ANY kind (task, reusable tool, rule proposal, project setup, project addition, question only, or not
 * sorted). The new project is of any type the plan calls for (project, retainer or internal), for the card's own client or internal, status ready,
 * and nothing else about it is Dox's to set. The route links the card into the new project in the same transaction, so a card makes exactly one
 * project, and the card is the proof (a finished project is never reused: this is always a new one).
 *
 * A project_setup card normally already has its queued project, which the release made ready: that card has a project, so it is refused here
 * ("one project per card") and Dox works on that project through its project binding (x-dox-project and an open pass), which this guard does not touch.
 */
export async function guardDoxProjectCreate(auth: LaneAuth, headers: Hdrs, rawBody: unknown, db: Db = prisma): Promise<DoxProjectCard | null> {
  if (!isDoxLane(auth)) return null;
  const body = requireObject(rawBody);
  for (const k of Object.keys(body)) {
    if (!PROJECT_CREATE_FIELDS.has(k)) refuse(`Dox cannot set "${k}" on a new project.`, 'dox_field_closed');
  }
  if (body.type !== undefined && !(DOX_PROJECT_TYPES as readonly unknown[]).includes(body.type)) badBody('type is project, retainer or internal.');
  const cardId = uuidHeader(headers, DOX_CARD_HEADER);
  if (!cardId) return refuse('Name the released card this project is for: send the x-dox-card header.', 'dox_no_card');
  const card = await db.task.findFirst({
    where: { id: cardId, is_deleted: false },
    select: { id: true, status: true, tags: true, project_id: true, client_id: true },
  });
  if (!card || !card.tags.includes(FROM_TRIAGE_TAG) || card.status === 'triage') return refuse('That is not a card released from Triage.', 'dox_card_closed');
  if (card.project_id) return refuse('That card already belongs to a project: one project per card.', 'dox_card_closed');
  if (body.status !== 'ready') refuse('A project Dox creates starts as ready.', 'dox_status_closed');
  const internal = body.type === 'internal';
  if (!internal && !(card.client_id && body.client_id === card.client_id)) {
    refuse('A project Dox creates is internal or belongs to the card\'s client.', 'dox_field_closed');
  }
  return { id: card.id, client_id: card.client_id };
}

// ---------------------------------------------------------------- waits

/** What a wait is bound to: its own project, or the project of its task. */
async function waitProjectOf(db: Db, w: { project_id?: string | null; task_id?: string | null }): Promise<string | null> {
  if (w.project_id) {
    if (w.task_id) {
      const t = await db.task.findFirst({ where: { id: w.task_id }, select: { project_id: true } });
      if (t?.project_id !== w.project_id) return null;
    }
    return w.project_id;
  }
  return null;
}

const isPriceReview = (key: unknown) => typeof key === 'string' && key.startsWith('charter.price_review');

/**
 * POST /api/waits as Dox: a template that sends nothing and is not the price review, on the project in play (project_id, and a task_id that
 * belongs to it).
 */
export async function guardDoxWaitCreate(auth: LaneAuth, headers: Hdrs, body: { template_key?: unknown; project_id?: unknown; task_id?: unknown }, db: Db = prisma): Promise<void> {
  if (!isDoxLane(auth)) return;
  if (isPriceReview(body.template_key)) refuse('Dox does not open a price review.', 'dox_wait_closed');
  const tpl = typeof body.template_key === 'string' ? getTemplate(body.template_key) : undefined;
  if (tpl?.sends) refuse('Dox opens only waits that send nothing.', 'dox_wait_closed');
  const project = await requireProjectInPlay(headers, null, db);
  const bound = await waitProjectOf(db, { project_id: body.project_id as string | null | undefined, task_id: body.task_id as string | null | undefined });
  if (bound !== project.id) refuse('A wait Dox opens belongs to the project in the x-dox-project header (project_id, and a task of it).', 'dox_outside_project');
}

/** PATCH /api/waits/:id as Dox: never a price review; only a wait of the project in play; a resolve that is a send, or a sign-off, is not Dox's call. */
export async function guardDoxWaitPatch(auth: LaneAuth, headers: Hdrs, waitId: string, body: { action?: unknown; resolution?: unknown }, db: Db = prisma): Promise<void> {
  if (!isDoxLane(auth)) return;
  if (body.action === 'resolve' && ['sent', 'signed', 'approved'].includes(String(body.resolution))) {
    refuse('Dox cannot resolve a wait as sent, signed or approved: that is a person\'s word.', 'dox_wait_closed');
  }
  if (!UUID_RE.test(waitId)) return badBody('Bad wait id.');
  const w = await db.wait.findUnique({ where: { id: waitId }, select: { template_key: true, project_id: true, task_id: true } });
  if (!w) return; // the route answers 404
  if (isPriceReview(w.template_key)) refuse('Dox does not touch a price review.', 'dox_wait_closed');
  const project = await requireProjectInPlay(headers, null, db);
  if ((await waitProjectOf(db, w)) !== project.id) refuse('That wait is outside the project Dox is working on.', 'dox_outside_project');
}

// ---------------------------------------------------------------- comments, reads

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

/**
 * A snapshot or a brief of a project as Dox: a project still in the quote stage carries prices and is read only while a pass is open on it.
 * Every other project is readable (reads of other live projects stay open). A no-op for any caller that is not the Dox lane.
 */
export async function guardDoxSnapshotRead(auth: LaneAuth, projectId: string, db: Db = prisma): Promise<void> {
  if (!isDoxLane(auth)) return;
  const p = await db.project.findFirst({ where: { id: projectId, is_deleted: false }, select: { status: true } });
  if (p?.status === 'quote' && !(await openDoxPass(db, projectId))) {
    refuse('A project in the quote stage carries prices: Dox reads it only while a pass is open on it.', 'dox_quote_closed');
  }
}
