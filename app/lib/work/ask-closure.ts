/**
 * Work stage A: closing the emails that belong to a task when the task ends.
 *
 * ONE function, closeAsksForTask (closeAsksForTasks for a batch), is called from every place a task reaches done or
 * abandoned (lib/work/__tests__/ask-closure-callers.test.ts fails when a new writer of those statuses does not go
 * through it). It closes the open asks linked to the task, and nothing else:
 *
 * - Compare-and-set (state 'open' in the where) and idempotent: a second call closes nothing and writes no line.
 * - Owner only: with no home owner on the home view it writes nothing (skipped 'home_off').
 * - It records exactly which asks it closed and their previous state, in one home_actions row (source keeper, action
 *   work_close) on the home owner's screen: one Handled line with Undo for 72 hours.
 * - Undo (undoWorkClose, called from runHomeUndo) reopens only asks still handled with the reason this close wrote,
 *   then holds the task for 30 days so neither a second call nor the nightly catch-up closes them again.
 * - A security-tagged task's asks are never closed by inference. An urgent ask keeps its emergency path and is never
 *   closed here. An ask that arrived after the task finished is never closed. A deleted task closes nothing.
 *
 * The write is never part of anyone else's decision: it changes only EmailAsk closing fields and one home_actions row,
 * and never sends, drafts or changes mail.
 */

import { SECURITY_TAGS } from '@/lib/home/rules';
import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import { notHeldByMike } from './decision';
import { askDetail, backfillLine, catchupLine, taskClosedLine, taskDetail } from './copy';

export const WORK_CLOSE_ACTION = 'work_close';
/** The Undo window on the Handled line. */
export const WORK_CLOSE_UNDO_HOURS = 72;
/** After an Undo, how long the task's asks are held from being closed again. */
export const WORK_CLOSE_HOLD_DAYS = 30;
const HOLD_PREFIX = 'work_close:';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const CATCHUP_TAKE = 500;
const DEFAULT_ZONE = 'America/New_York';

export type FinishedStatus = 'done' | 'abandoned';
export type ClosedBy = 'task' | 'catchup' | 'backfill';
export type TaskCloseReason = 'task_done' | 'task_abandoned';

export function isFinishedStatus(s: string | null | undefined): s is FinishedStatus {
  return s === 'done' || s === 'abandoned';
}

export const reasonFor = (status: FinishedStatus): TaskCloseReason => (status === 'done' ? 'task_done' : 'task_abandoned');

export function isSecurityTagged(tags: readonly string[] | null | undefined): boolean {
  const t = (tags ?? []).map((x) => x.toLowerCase());
  return (SECURITY_TAGS as readonly string[]).some((s) => t.includes(s));
}

/** One ask a close wrote: what Undo needs to put it back. */
export interface ClosedAskRecord {
  id: string;
  task_id: string;
  closed_reason: TaskCloseReason;
  previous_state: 'open';
}

/** One ask the one-time tidy linked (it stays open when its task is open). */
export interface LinkedAskRecord {
  id: string;
  task_id: string;
  basis: string;
}

/** The close record stored on the home_actions row (before.work_close and after.work_close). */
export interface WorkCloseRecord {
  kind: 'work_close';
  origin: ClosedBy;
  asks: ClosedAskRecord[];
  task_ids: string[];
  linked?: LinkedAskRecord[];
}

export function readWorkCloseRecord(v: unknown): WorkCloseRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = (v as { work_close?: unknown }).work_close;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const r = rec as Partial<WorkCloseRecord>;
  if (r.kind !== 'work_close' || !Array.isArray(r.asks) || !Array.isArray(r.task_ids)) return null;
  return r as WorkCloseRecord;
}

// ----------------------------------------------------------------------------
// Plumbing
// ----------------------------------------------------------------------------

/** Run `fn` in one transaction when the client can open one; a client already in a transaction just runs it. */
async function inOneTransaction<T>(db: HomeDb, fn: (tx: HomeDb) => Promise<T>): Promise<T> {
  const d = db as unknown as { $transaction?: (f: (tx: HomeDb) => Promise<T>) => Promise<T> };
  return typeof d.$transaction === 'function' ? d.$transaction((tx) => fn(tx)) : fn(db);
}

/** The home owner (BastChatSettings.owner_user_id) when he is an active admin on the home view; else null. */
export async function homeOwner(db: HomeDb): Promise<{ id: string; timezone: string } | null> {
  const s = await db.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  if (!s?.owner_user_id) return null;
  const u = await db.user.findUnique({
    where: { id: s.owner_user_id },
    select: { is_active: true, role: true, preferences: { select: { home_view: true, timezone: true } } },
  });
  if (!u || !u.is_active || u.role !== 'admin' || u.preferences?.home_view !== 'home') return null;
  return { id: s.owner_user_id, timezone: u.preferences?.timezone || DEFAULT_ZONE };
}

/** The tasks whose asks are held from closing (after an Undo), as of `now`. */
export async function heldTaskIds(db: HomeDb, ownerId: string | null, taskIds: readonly string[], now: Date): Promise<Set<string>> {
  if (!ownerId || taskIds.length === 0) return new Set();
  const rows = await db.homeReconcileHold.findMany({
    where: { user_id: ownerId, target_key: { in: taskIds.map((id) => HOLD_PREFIX + id) }, until: { gt: now } },
    select: { target_key: true },
  });
  return new Set(rows.map((r) => r.target_key.slice(HOLD_PREFIX.length)));
}

async function putTaskHold(db: HomeDb, userId: string, taskId: string, now: Date): Promise<void> {
  const until = new Date(now.getTime() + WORK_CLOSE_HOLD_DAYS * DAY_MS);
  const key = HOLD_PREFIX + taskId;
  const cur = await db.homeReconcileHold.findUnique({ where: { user_id_target_key: { user_id: userId, target_key: key } }, select: { until: true } });
  if (cur && cur.until.getTime() >= until.getTime()) return;
  await db.homeReconcileHold.upsert({
    where: { user_id_target_key: { user_id: userId, target_key: key } },
    create: { user_id: userId, target_key: key, until, reason: 'undo' },
    update: { until, reason: 'undo' },
  });
}

export interface CandidateAsk {
  id: string;
  task_id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  received_at: Date;
  deep_link: string;
}

const CANDIDATE_SELECT = { id: true, task_id: true, from_name: true, from_email: true, subject: true, received_at: true, deep_link: true } as const;

/**
 * Compare-and-set close of the given asks (each still `open` and still linked to its task). Returns the ones this call
 * closed. Leaving open clears the draft marker, the same as the PATCH route does.
 */
async function closeCandidates(
  db: HomeDb,
  asks: readonly CandidateAsk[],
  reasonOf: (ask: CandidateAsk) => TaskCloseReason,
  by: ClosedBy,
  now: Date,
): Promise<{ ask: CandidateAsk; reason: TaskCloseReason }[]> {
  const closed: { ask: CandidateAsk; reason: TaskCloseReason }[] = [];
  for (const ask of asks) {
    const reason = reasonOf(ask);
    const r = await db.emailAsk.updateMany({
      where: { id: ask.id, state: 'open', task_id: ask.task_id, ...notHeldByMike },
      data: { state: 'handled', closed_at: now, closed_reason: reason, closed_by: by, draft_started_at: null, draft_url: null },
    });
    if (r.count === 1) closed.push({ ask, reason });
  }
  return closed;
}

function recordOf(origin: ClosedBy, closed: { ask: CandidateAsk; reason: TaskCloseReason }[], linked?: LinkedAskRecord[]): WorkCloseRecord {
  return {
    kind: 'work_close',
    origin,
    asks: closed.map((c) => ({ id: c.ask.id, task_id: c.ask.task_id, closed_reason: c.reason, previous_state: 'open' as const })),
    task_ids: Array.from(new Set(closed.map((c) => c.ask.task_id).concat((linked ?? []).map((l) => l.task_id)))),
    ...(linked && linked.length > 0 ? { linked } : {}),
  };
}

/** Write the one Handled line (home_actions, source keeper) for the owner, with Undo for 72 hours. Null when no owner is on the home view. */
export async function writeCloseLine(
  db: HomeDb,
  owner: { id: string } | null,
  rec: WorkCloseRecord,
  line: string,
  details: string[],
  href: string | null,
  now: Date,
): Promise<string | null> {
  if (!owner) return null;
  const row = await appendHomeAction(db, owner.id, {
    item_key: null,
    action: WORK_CLOSE_ACTION,
    source: 'keeper',
    before: { states: [], work_close: rec },
    after: { states: [], work_close: rec, line, details, href },
    undo_until: new Date(now.getTime() + WORK_CLOSE_UNDO_HOURS * HOUR_MS),
  });
  return row.id;
}

// ----------------------------------------------------------------------------
// The one closure
// ----------------------------------------------------------------------------

export interface CloseResult {
  /** Ask ids this call closed (empty when none, or when the call was a no-op). */
  closed: string[];
  /** The home_actions row (the Handled line and its Undo), or null. */
  action_ids: string[];
  /** Tasks whose asks were left alone, and why. */
  held: { security: string[]; undone: string[] };
  /** 'home_off': no home owner is on the home view, so nothing was written (every screen change is owner only). */
  skipped?: 'home_off';
}

const NOTHING: CloseResult = { closed: [], action_ids: [], held: { security: [], undone: [] } };

export interface CloseOptions {
  now?: Date;
  /** Who is closing. 'task' (default) is a task ending; 'backfill' and 'catchup' are the tidy and the nightly step. */
  by?: ClosedBy;
  /** When the task finished, for the "arrived after it finished" rule. Default: now. */
  finishedAt?: Date;
}

/**
 * The task `taskId` has just reached `newStatus`. Closes its open linked asks when that status is done or abandoned.
 * Call it inside the same transaction as the status write when there is one. See the file header for the rules.
 */
export async function closeAsksForTask(db: HomeDb, taskId: string, newStatus: string, opts: CloseOptions = {}): Promise<CloseResult> {
  return closeAsksForTasks(db, [taskId], newStatus, opts);
}

/** closeAsksForTask for several tasks that reached the same status together. One Handled line per task that closed emails. */
export async function closeAsksForTasks(db: HomeDb, taskIds: readonly string[], newStatus: string, opts: CloseOptions = {}): Promise<CloseResult> {
  if (!isFinishedStatus(newStatus) || taskIds.length === 0) return NOTHING;
  const now = opts.now ?? new Date();
  const by = opts.by ?? 'task';
  const finishedAt = opts.finishedAt ?? now;
  const ids = Array.from(new Set(taskIds));

  // Cheap exit: nothing linked and open means nothing to do (the common case), with no transaction.
  const any = await db.emailAsk.findFirst({ where: { task_id: { in: ids }, state: 'open' }, select: { id: true } });
  if (!any) return NOTHING;

  return inOneTransaction(db, async (tx) => {
    const tasks = await tx.task.findMany({ where: { id: { in: ids }, is_deleted: false, status: newStatus }, select: { id: true, title: true, tags: true } });
    if (tasks.length === 0) return NOTHING;
    const owner = await homeOwner(tx);
    if (!owner) return { ...NOTHING, skipped: 'home_off' as const };
    const security = tasks.filter((t) => isSecurityTagged(t.tags)).map((t) => t.id);
    const held = await heldTaskIds(tx, owner?.id ?? null, tasks.map((t) => t.id), now);
    const live = tasks.filter((t) => !security.includes(t.id) && !held.has(t.id));
    const out: CloseResult = { closed: [], action_ids: [], held: { security, undone: Array.from(held) } };
    if (live.length === 0) return out;

    const asks = await tx.emailAsk.findMany({
      where: { task_id: { in: live.map((t) => t.id) }, state: 'open', is_urgent: false, received_at: { lte: finishedAt }, ...notHeldByMike },
      select: CANDIDATE_SELECT,
      orderBy: { received_at: 'asc' },
    });
    const candidates = asks.filter((a): a is CandidateAsk => !!a.task_id);
    const reason = reasonFor(newStatus);
    for (const task of live) {
      const mine = candidates.filter((a) => a.task_id === task.id);
      if (mine.length === 0) continue;
      const closed = await closeCandidates(tx, mine, () => reason, by, now);
      if (closed.length === 0) continue;
      out.closed.push(...closed.map((c) => c.ask.id));
      const newest = closed.reduce((a, c) => (c.ask.received_at.getTime() > a.received_at.getTime() ? c.ask : a), closed[0].ask);
      const rec = recordOf(by, closed);
      const line = taskClosedLine({ count: closed.length, from: closed.map((c) => c.ask.from_name || c.ask.from_email), title: task.title, status: newStatus, date: newest.received_at, zone: owner?.timezone });
      const id = await writeCloseLine(tx, owner, rec, line, [...closed.map((c) => askDetail(c.ask, owner?.timezone)), taskDetail(task)], newest.deep_link || null, now);
      if (id) out.action_ids.push(id);
    }
    return out;
  });
}

// ----------------------------------------------------------------------------
// The nightly catch-up
// ----------------------------------------------------------------------------

/**
 * Any open ask whose task is done or abandoned closes with closed_by 'catchup' (the net under the callers). Same rules as
 * closeAsksForTask; the finish time is the task's completed_at, else its last update. One Handled line for the run.
 * `dry` plans and writes nothing.
 */
export async function catchUpClosures(
  db: HomeDb,
  now: Date,
  opts: { dry?: boolean; owner?: { id: string; timezone: string } } = {},
): Promise<{ would_close: number; closed: string[]; action_ids: string[] }> {
  const rows = await db.emailAsk.findMany({
    where: { state: 'open', is_urgent: false, task_id: { not: null }, task: { is_deleted: false, status: { in: ['done', 'abandoned'] } }, ...notHeldByMike },
    select: { ...CANDIDATE_SELECT, task: { select: { id: true, title: true, status: true, tags: true, completed_at: true, updated_at: true } } },
    orderBy: { received_at: 'asc' },
    take: CATCHUP_TAKE,
  });
  if (rows.length === 0) return { would_close: 0, closed: [], action_ids: [] };
  const owner = opts.owner ?? (await homeOwner(db));
  if (!owner) return { would_close: 0, closed: [], action_ids: [] }; // owner only: nothing is written without a home owner
  const held = await heldTaskIds(db, owner?.id ?? null, Array.from(new Set(rows.map((r) => r.task_id as string))), now);
  const eligible = rows.filter((r) => {
    const t = r.task;
    if (!t || !isFinishedStatus(t.status) || isSecurityTagged(t.tags) || held.has(t.id)) return false;
    return r.received_at.getTime() <= (t.completed_at ?? t.updated_at).getTime();
  });
  if (opts.dry || eligible.length === 0) return { would_close: eligible.length, closed: [], action_ids: [] };

  return inOneTransaction(db, async (tx) => {
    const status = new Map(eligible.map((r) => [r.task_id as string, r.task!.status as FinishedStatus]));
    const candidates: CandidateAsk[] = eligible.map((r) => ({ id: r.id, task_id: r.task_id as string, from_name: r.from_name, from_email: r.from_email, subject: r.subject, received_at: r.received_at, deep_link: r.deep_link }));
    const closed = await closeCandidates(tx, candidates, (a) => reasonFor(status.get(a.task_id) ?? 'done'), 'catchup', now);
    if (closed.length === 0) return { would_close: eligible.length, closed: [], action_ids: [] };
    const rec = recordOf('catchup', closed);
    const taskTitles = new Map(eligible.map((r) => [r.task_id as string, r.task!.title]));
    const details = [
      ...closed.map((c) => askDetail(c.ask, owner?.timezone)),
      ...rec.task_ids.map((id) => taskDetail({ id, title: taskTitles.get(id) ?? '' })),
    ];
    const lineId = await writeCloseLine(tx, owner, rec, catchupLine(closed.length, rec.task_ids.length), details, null, now);
    return { would_close: eligible.length, closed: closed.map((c) => c.ask.id), action_ids: lineId ? [lineId] : [] };
  });
}

// ----------------------------------------------------------------------------
// The one-time tidy's record (used by the backfill route)
// ----------------------------------------------------------------------------

/** Close the given asks for the backfill (same compare-and-set), and write its one line. The route decides which asks. */
export async function closeForBackfill(
  tx: HomeDb,
  owner: { id: string; timezone: string } | null,
  plan: { closes: { ask: CandidateAsk; status: FinishedStatus; title: string }[]; linked: LinkedAskRecord[] },
  now: Date,
): Promise<{ closed: string[]; action_id: string | null }> {
  const status = new Map(plan.closes.map((c) => [c.ask.id, c.status]));
  const closed = await closeCandidates(tx, plan.closes.map((c) => c.ask), (a) => reasonFor(status.get(a.id) ?? 'done'), 'backfill', now);
  if (closed.length === 0 && plan.linked.length === 0) return { closed: [], action_id: null };
  const rec = recordOf('backfill', closed, plan.linked);
  const titles = new Map(plan.closes.map((c) => [c.ask.task_id, c.title]));
  const details = [...closed.map((c) => askDetail(c.ask, owner?.timezone)), ...rec.task_ids.map((id) => taskDetail({ id, title: titles.get(id) ?? '' }))];
  const id = await writeCloseLine(tx, owner, rec, backfillLine(plan.linked.length, closed.length), details, null, now);
  return { closed: closed.map((c) => c.ask.id), action_id: id };
}

// ----------------------------------------------------------------------------
// Undo
// ----------------------------------------------------------------------------

/**
 * Undo of a work_close row (called from runHomeUndo inside its transaction). Reopens only asks that are still handled
 * with the reason this close wrote, as they were; anything Mike changed since stays as he left it. Then holds each task
 * for 30 days so nothing closes its asks again.
 */
export async function undoWorkClose(db: HomeDb, userId: string, rec: WorkCloseRecord, now: Date): Promise<{ reopened: string[] }> {
  const reopened: string[] = [];
  for (const a of rec.asks) {
    const r = await db.emailAsk.updateMany({
      where: { id: a.id, state: 'handled', closed_reason: a.closed_reason, task_id: a.task_id },
      data: { state: a.previous_state, closed_at: null, closed_reason: null, closed_by: null },
    });
    if (r.count === 1) reopened.push(a.id);
  }
  for (const taskId of rec.task_ids) await putTaskHold(db, userId, taskId, now);
  return { reopened };
}

