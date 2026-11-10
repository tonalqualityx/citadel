/**
 * Bast chat v2: what a Bast worker session reads for a task, and the ONE fingerprint over all of it (VERIFY-2 N1 to N4).
 *
 * The owner's tap may only release a proposal when nothing the session would read has changed since the card was
 * written. This module loads that material and hashes it; `tapFingerprint` is the only function that makes the
 * fingerprint, at proposal time (storeProposal) and at tap time (releaseAction), and the card is built from the same
 * load (`buildCard` gets the `WorkerReadSet`), so what the card shows is always inside what the tap compares.
 *
 * WHAT THE WORKER READS FOR A TASK, from its source (read 2026-11-10):
 *   ~/.claude/tools/citadel-worker/spawn-gate.py: fetch_task 289 (GET /api/tasks/:id), fetch_comments 300
 *   (GET /api/tasks/:id/comments), last_comment_of 407, wake_if_human_last_comment 417, has_open_blocker 330, classify
 *   367, lease_is_live 351, run 513 (the queue lists of GET /api/tasks).
 *   ~/.openclaw/workspace/skills/citadel-worker/SKILL.md: SOP line 76, W1 277 to 363 (thread of each notified task;
 *   delegate pass: thread, description, source email, arc), W2 381 to 405 (last comment), W3 407 to 422 (project
 *   plan folder, the last comment of each blocker, title, description, requirements, comments).
 *   app/app/api/tasks/[id]/route.ts GET 23 to 64 (what GET /api/tasks/:id returns), app/app/api/tasks/[id]/comments
 *   route.ts GET 118 to 140 (every non-deleted comment, oldest first, with author, flags and times).
 *
 *   read                                                   where it sits in the fingerprint
 *   1  the task row: title, description, requirements,     `rowPart` (READ_ROW_FIELDS) of each read task
 *      review_requirements, notes, tags, status, assignee,
 *      project, client, site, SOP, arc, function, charter,
 *      priority, due date, promise, review and approval
 *      flags, client approval, preview url, source,
 *      source_ref, origin url, client title and intake,
 *      phase, deleted flag
 *   2  every comment on the task: id, created and edited   `threadPart` of each read task: every row, deleted ones
 *      time, deleted flag, author (user or client), lane,  included (id, times, is_deleted, author, lane, flags,
 *      internal and client flags, source, chat_meta,       mentions, chat_meta, sha256 of the content), in
 *      mentions, the text                                  created_at, id order
 *   3  the tasks it waits on (blocked_by): id, title,      `blockers` of each read task (id and status), and each
 *      status, assignee, project name and status           blocker's own `rowPart` (BLOCKER_ROW_FIELDS)
 *   4  each blocker's thread (W3 reads its last comment;   `threadPart` of each blocker, the whole thread
 *      the whole thread is hashed)
 *   5  the tasks that wait on it (blocking): id, title,    `dependents` of each read task
 *      status, assignee
 *   6  the SOP: title, content, bast_executable,           `sop` of each read task
 *      template checklist
 *   7  the project: name, description, status, notes,      `project` of each read task (and name and status for a
 *      plan_folder ("Project folder:" line), ordering      blocker)
 *      rule, client, site
 *   8  the arc (delegate pass): name, description          `arc` of each read task
 *   9  client and site names                               `client`, `site` of each read task
 *   10 the last ten time entries' descriptions             `time` of each read task (id, description, deleted flag;
 *                                                          not the running duration)
 *   11 which tasks are read at all, and how the worker     `reachFingerprint(reach)` (worker-reach.ts): rules, views,
 *      holds each (eligible, woken, parked)                the text fields of each read, client shows
 *
 *   NOT covered, and why: the files of the project's plan folder on Mike's disk (README.md, the task map, decisions.md:
 *   not in the database), the source email a task links (in Gmail), user display names (author names), and the
 *   names inside a blocker's project beyond its name and status. None of these can be written through the chat.
 *
 * Which tasks are "read tasks": every task of the reach's reads, starts and client shows, plus the proposal's own
 * task (`seedTaskIds`). Their blockers are loaded as blockers. A task the chat changes is always one of them.
 */
import { createHash } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { reachFingerprint, type ReachResult } from './worker-reach';
import type { LockScope } from './task-locks';

type ReadsDb = Pick<PrismaClient, 'task' | 'comment'> | Prisma.TransactionClient;

/** The prefix of every comment the chat writes (ops/comment.ts). Any comment carrying it counts as the chat's. */
export const CHAT_COMMENT_PREFIX = 'From Mike, through the chat: ';
/** The chat key's lane, as `actor_lane` records it. */
export const CHAT_LANE_NAME = 'bast-chat';

const BLOCKER_ROW_FIELDS = {
  id: true,
  title: true,
  description: true,
  requirements: true,
  notes: true,
  tags: true,
  status: true,
  assignee_id: true,
  approved: true,
  needs_review: true,
  project_id: true,
  is_deleted: true,
  project: { select: { name: true, status: true, dependencies_ordering_only: true } },
} as const;

const READ_ROW_FIELDS = {
  ...BLOCKER_ROW_FIELDS,
  review_requirements: true,
  client_id: true,
  site_id: true,
  sop_id: true,
  arc_id: true,
  function_id: true,
  charter_id: true,
  priority: true,
  due_date: true,
  promised_to: true,
  reviewer_id: true,
  client_visible: true,
  client_title: true,
  client_intake: true,
  source: true,
  source_ref: true,
  origin_url: true,
  requested_by_contact_id: true,
  staging_preview_url: true,
  approved_preview_url: true,
  client_approved_at: true,
  approved_by_contact_id: true,
  phase: true,
  project: {
    select: {
      name: true,
      description: true,
      status: true,
      notes: true,
      plan_folder: true,
      dependencies_ordering_only: true,
      client_id: true,
      site_id: true,
      is_deleted: true,
    },
  },
  client: { select: { name: true } },
  site: { select: { name: true } },
  sop: { select: { title: true, content: true, bast_executable: true, template_requirements: true } },
  arc: { select: { name: true, description: true } },
  time_entries: { select: { id: true, description: true, is_deleted: true }, orderBy: { started_at: 'desc' as const }, take: 10 },
  blocked_by: { select: { id: true, status: true } },
  blocking: { select: { id: true, title: true, status: true, assignee_id: true } },
} as const;

const COMMENT_FIELDS = {
  id: true,
  task_id: true,
  content: true,
  user_id: true,
  author_contact_id: true,
  is_deleted: true,
  is_internal: true,
  client_visible: true,
  client_question: true,
  source: true,
  mentioned_user_ids: true,
  actor_lane: true,
  chat_meta: true,
  created_at: true,
  updated_at: true,
} as const;

export interface ReadComment {
  id: string;
  task_id: string;
  content: string;
  user_id: string | null;
  author_contact_id: string | null;
  is_deleted: boolean;
  is_internal?: boolean;
  client_visible?: boolean;
  client_question?: boolean;
  source?: string | null;
  mentioned_user_ids?: string[];
  actor_lane?: string | null;
  chat_meta?: unknown;
  created_at: Date;
  updated_at?: Date;
}

export interface ReadTaskRow {
  id: string;
  title: string;
  description: string | null;
  requirements: unknown;
  notes: string | null;
  tags: string[];
  status: string;
  is_deleted: boolean;
  blocked_by?: { id: string; status?: string }[];
  [k: string]: unknown;
}

/** One load of everything the worker reads for a set of tasks. */
export interface WorkerReadSet {
  /** Tasks a session reads in full, sorted. */
  read_ids: string[];
  /** The tasks they wait on (not themselves read tasks), sorted. */
  blocker_ids: string[];
  /** Rows by id, read tasks and blockers. A missing id was not found (deleted for good). */
  tasks: Map<string, ReadTaskRow>;
  /** Blocker ids of each read task, in id order. */
  blockers_of: Map<string, string[]>;
  /** Every comment of every task above, deleted ones too, oldest first. */
  comments: Map<string, ReadComment[]>;
  /** Project ids of the read tasks. */
  projects: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (xs: readonly (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].sort();

/** The task ids a reach makes the worker read, plus `extra` (the proposal's own task). */
export function readTaskIds(reach: Pick<ReachResult, 'reads' | 'starts' | 'shows_client'>, extra: readonly string[] = []): string[] {
  return ids([...reach.reads.map((r) => r.task_id), ...reach.starts.map((h) => h.task_id), ...reach.shows_client.map((c) => c.task_id ?? null), ...extra]);
}

const byTime = (a: ReadComment, b: ReadComment) => {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  return ta !== tb ? ta - tb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** Load the tasks, their blockers and every comment of both. Three queries, whatever the size. */
export async function loadWorkerReads(db: ReadsDb, readIds: readonly string[]): Promise<WorkerReadSet> {
  const read = ids(readIds);
  const tasks = new Map<string, ReadTaskRow>();
  const blockersOf = new Map<string, string[]>();
  const comments = new Map<string, ReadComment[]>();
  if (read.length === 0) return { read_ids: [], blocker_ids: [], tasks, blockers_of: blockersOf, comments, projects: [] };
  const rows = (await (db.task.findMany as (a: unknown) => Promise<unknown[]>)({ where: { id: { in: read } }, select: READ_ROW_FIELDS })) as ReadTaskRow[];
  for (const r of rows) {
    tasks.set(r.id, r);
    blockersOf.set(r.id, ids((r.blocked_by ?? []).map((b) => b.id)));
  }
  const blockerIds = ids([...blockersOf.values()].flat()).filter((id) => !read.includes(id));
  if (blockerIds.length > 0) {
    const brows = (await (db.task.findMany as (a: unknown) => Promise<unknown[]>)({ where: { id: { in: blockerIds } }, select: BLOCKER_ROW_FIELDS })) as ReadTaskRow[];
    for (const b of brows) tasks.set(b.id, b);
  }
  const all = [...read, ...blockerIds];
  const crows = (await (db.comment.findMany as (a: unknown) => Promise<unknown[]>)({
    where: { task_id: { in: all } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: COMMENT_FIELDS,
  })) as ReadComment[];
  for (const c of crows) {
    if (!all.includes(c.task_id)) continue;
    comments.set(c.task_id, [...(comments.get(c.task_id) ?? []), c]);
  }
  for (const [k, v] of comments) comments.set(k, [...v].sort(byTime));
  const projects = ids(read.map((id) => (tasks.get(id)?.project_id as string | null | undefined) ?? null));
  return { read_ids: read, blocker_ids: blockerIds, tasks, blockers_of: blockersOf, comments, projects };
}

/** The lock scope the set was read under must hold all of it (the tap checks this after it recomputes). */
export function scopeOfReads(set: WorkerReadSet): LockScope {
  return { tasks: ids([...set.read_ids, ...set.blocker_ids]), projects: [...set.projects] };
}

function canon(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function threadPart(list: readonly ReadComment[] | undefined): unknown[] {
  return (list ?? []).map((c) => ({
    id: c.id,
    created_at: c.created_at,
    updated_at: c.updated_at ?? null,
    is_deleted: c.is_deleted,
    user_id: c.user_id ?? null,
    author_contact_id: c.author_contact_id ?? null,
    is_internal: c.is_internal ?? null,
    client_visible: c.client_visible ?? null,
    client_question: c.client_question ?? null,
    source: c.source ?? null,
    mentioned_user_ids: [...(c.mentioned_user_ids ?? [])].sort(),
    actor_lane: c.actor_lane ?? null,
    chat_meta: c.chat_meta ?? null,
    content: sha(c.content ?? ''),
  }));
}

function rowPart(row: ReadTaskRow | undefined, fields: Record<string, unknown>): unknown {
  if (!row) return 'missing';
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) {
    if (k === 'blocked_by' || k === 'blocking' || k === 'time_entries') continue;
    out[k] = row[k] ?? null;
  }
  return out;
}

/** The digest of one load: every read task with its relations and thread, every blocker with its row and thread. */
export function workerReadsDigest(set: WorkerReadSet): string {
  const reads = set.read_ids.map((id) => {
    const row = set.tasks.get(id);
    return {
      id,
      row: rowPart(row, READ_ROW_FIELDS),
      blockers: row ? [...(row.blocked_by ?? [])].map((b) => `${b.id}:${b.status ?? ''}`).sort() : null,
      dependents: row ? [...((row.blocking as { id: string; title: string; status: string; assignee_id: string | null }[] | undefined) ?? [])].map((d) => canon(d)).sort() : null,
      time: row ? ((row.time_entries as unknown[] | undefined) ?? []).map(canon).sort() : null,
      thread: threadPart(set.comments.get(id)),
    };
  });
  const blockers = set.blocker_ids.map((id) => ({ id, row: rowPart(set.tasks.get(id), BLOCKER_ROW_FIELDS), thread: threadPart(set.comments.get(id)) }));
  return sha(canon({ reads, blockers }));
}

/**
 * THE fingerprint of a proposal: the reach (which tasks, which rules, how the worker holds each) and everything a
 * session would read for those tasks and their blockers. Same input at proposal time and at tap time gives the same
 * string; any add, edit, hide or delete of a comment, or any change to a read field, gives another.
 * `extra` is the proposal's own task (see `seedTaskIds` in actions.ts).
 */
export async function tapFingerprint(db: ReadsDb, reach: ReachResult, extra: readonly string[] = []): Promise<{ fingerprint: string; set: WorkerReadSet }> {
  const set = await loadWorkerReads(db, readTaskIds(reach, extra));
  return { fingerprint: sha(`${reachFingerprint(reach)}\n${workerReadsDigest(set)}`), set };
}

/** A comment the chat wrote: its lane is the chat key's, or it carries the chat's prefix. Over-counting is safe. */
export function isChatComment(c: Pick<ReadComment, 'actor_lane' | 'content'>): boolean {
  const lanes = (c.actor_lane ?? '').split(',').map((x) => x.trim());
  return lanes.includes(CHAT_LANE_NAME) || (c.content ?? '').startsWith(CHAT_COMMENT_PREFIX);
}
