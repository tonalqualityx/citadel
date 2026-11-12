/**
 * Work stage F: the two clocks (the Citadel side). Two kinds, stored together in work_clock and kept apart from time_entries:
 *   mike_estimate  Bast's estimate of the owner's active time, inferred by the machine from session timestamps (never text).
 *   bast_run       Bast's own measured working time (unattended worker passes, interactive turns, subagent minutes).
 *
 * Rules this file keeps:
 *  - A time ENTRY exists only after the owner's own tap (logClock, reached only from POST /api/home/reconcile, a browser session).
 *    Nothing here writes a time entry on its own, and a bast_run row can never become one.
 *  - Nothing from either clock reaches a client. The portal, client reports, retainer reports and Steward never import this file or
 *    query work_clock (clock-guard.test.ts fails the build if they do).
 *  - An estimate is always shown as an estimate with what it was inferred from.
 *  - The machine posts rows (upsertClocks, by dedupe_key). A row a tap has already used (time_entry_id set) keeps that link on re-post.
 */

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { displayText } from '@/lib/home/copy';
import { zonedToUtc } from '@/lib/home/act';
import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import type { HomeActResponse } from '@/lib/home/types';
import { homeOwner } from './ask-closure';
import { clip, parseTargetKey } from './keys';
import { CLOCK_MESSAGES, LOG_CHOICES, bastLine, formatMinutes, inferredFrom, mikeLine, roundToStep } from './clocks-copy';

export const CLOCK_KINDS = ['mike_estimate', 'bast_run'] as const;
export type ClockKind = (typeof CLOCK_KINDS)[number];
export const CLOCK_SOURCES = ['session', 'citadel-worker', 'workflow', 'track'] as const;
/** What each kind may come from. The owner's time is only ever inferred from a session (or his Track it); a worker pass is Bast's. */
const SOURCES_OF: Record<ClockKind, readonly string[]> = {
  mike_estimate: ['session', 'track'],
  bast_run: ['session', 'citadel-worker', 'workflow'],
};
export const CLOCKS_MAX_ROWS = 200;
export const ROW_MINUTES_MAX = 1440;
export const AGENT_MINUTES_MAX = 100_000;
export const LOG_CLOCK_ACTION = 'work_log_clock';
export const LOG_UNDO_HOURS = 24;
const HOUR_MS = 3_600_000;

const iso = z.string().datetime({ offset: true });
export const clockRowSchema = z
  .object({
    kind: z.enum(CLOCK_KINDS),
    target_key: z.string().refine((k) => parseTargetKey(k) !== null, 'A target key is project:<id> or task:<id>').nullable(),
    session_external_id: z.string().min(1).max(255).nullable(),
    source: z.enum(CLOCK_SOURCES),
    started_at: iso,
    ended_at: iso,
    minutes: z.number().int().min(1).max(ROW_MINUTES_MAX),
    agent_minutes: z.number().int().min(0).max(AGENT_MINUTES_MAX).nullable().optional(),
    cost_usd: z.number().min(0).max(1000).nullable().optional(),
    model: z.string().min(1).max(20).nullable().optional(),
    basis: z.string().max(300).nullable().optional(),
    dedupe_key: z.string().min(1).max(300),
  })
  .strict();
export type ClockRow = z.output<typeof clockRowSchema>;

/** The body is a list; each row is judged on its own, so one bad row never sinks the others. */
export const clocksBodySchema = z.object({ rows: z.array(z.unknown()).min(1).max(CLOCKS_MAX_ROWS) }).strict();

export type RefusalReason = 'bad_shape' | 'bad_pairing' | 'bad_window' | 'target_missing' | 'kind_changed';
export interface ClockRefusal {
  index: number;
  dedupe_key: string | null;
  reason: RefusalReason;
}
export interface UpsertOutcome {
  result: 'saved' | 'skipped';
  skipped?: 'home_off';
  created: number;
  updated: number;
  refused: ClockRefusal[];
}

/** Pure: a row's own sense check (kind and source pair, the window), or the reason it fails. */
export function checkRow(row: ClockRow, now: Date): RefusalReason | null {
  if (!SOURCES_OF[row.kind].includes(row.source)) return 'bad_pairing';
  if (row.kind === 'mike_estimate' && (row.cost_usd != null || row.agent_minutes != null)) return 'bad_pairing';
  const s = Date.parse(row.started_at);
  const e = Date.parse(row.ended_at);
  if (!(e >= s)) return 'bad_window';
  if (e > now.getTime() + 24 * HOUR_MS) return 'bad_window';
  return null;
}

/** A stored basis: no em or en dash, clipped. Always present on an estimate. */
export const cleanBasis = (basis: string | null | undefined): string | null => {
  const b = clip(displayText(basis ?? ''), 300).trim();
  return b === '' ? null : b;
};

/** Machine side: save rows, upsert by dedupe_key. The owner's rows carry the owner's id (set here, never taken from the machine). */
export async function upsertClocks(db: PrismaClient, rawRows: readonly unknown[], now = new Date()): Promise<UpsertOutcome> {
  const owner = await homeOwner(db as unknown as HomeDb);
  if (!owner) return { result: 'skipped', skipped: 'home_off', created: 0, updated: 0, refused: [] };

  const refused: ClockRefusal[] = [];
  const good: { index: number; row: ClockRow }[] = [];
  rawRows.forEach((raw, index) => {
    const p = clockRowSchema.safeParse(raw);
    const key = raw && typeof raw === 'object' && typeof (raw as { dedupe_key?: unknown }).dedupe_key === 'string' ? ((raw as { dedupe_key: string }).dedupe_key).slice(0, 300) : null;
    if (!p.success) return void refused.push({ index, dedupe_key: key, reason: 'bad_shape' });
    const why = checkRow(p.data, now);
    if (why) return void refused.push({ index, dedupe_key: p.data.dedupe_key, reason: why });
    good.push({ index, row: p.data });
  });

  const taskIds = [...new Set(good.map((g) => parseTargetKey(g.row.target_key)).filter((t) => t?.type === 'task').map((t) => t!.id))];
  const projectIds = [...new Set(good.map((g) => parseTargetKey(g.row.target_key)).filter((t) => t?.type === 'project').map((t) => t!.id))];
  const [tasks, projects, existing] = await Promise.all([
    taskIds.length ? db.task.findMany({ where: { id: { in: taskIds }, is_deleted: false }, select: { id: true, project_id: true } }) : [],
    projectIds.length ? db.project.findMany({ where: { id: { in: projectIds }, is_deleted: false }, select: { id: true } }) : [],
    db.workClock.findMany({ where: { dedupe_key: { in: good.map((g) => g.row.dedupe_key) } }, select: { dedupe_key: true, kind: true } }),
  ]);
  const taskProject = new Map(tasks.map((t) => [t.id, t.project_id]));
  const projectSet = new Set(projects.map((p) => p.id));
  const kindOf = new Map(existing.map((e) => [e.dedupe_key, e.kind]));

  let created = 0;
  let updated = 0;
  for (const { index, row } of good) {
    const t = parseTargetKey(row.target_key);
    if (t && (t.type === 'task' ? !taskProject.has(t.id) : !projectSet.has(t.id))) {
      refused.push({ index, dedupe_key: row.dedupe_key, reason: 'target_missing' });
      continue;
    }
    const prior = kindOf.get(row.dedupe_key);
    if (prior && prior !== row.kind) {
      refused.push({ index, dedupe_key: row.dedupe_key, reason: 'kind_changed' });
      continue;
    }
    const data = {
      kind: row.kind,
      user_id: row.kind === 'mike_estimate' ? owner.id : null,
      target_key: t ? `${t.type}:${t.id}` : null,
      project_id: t ? (t.type === 'project' ? t.id : (taskProject.get(t.id) ?? null)) : null,
      task_id: t?.type === 'task' ? t.id : null,
      session_external_id: row.session_external_id,
      source: row.source,
      started_at: new Date(row.started_at),
      ended_at: new Date(row.ended_at),
      minutes: row.minutes,
      agent_minutes: row.agent_minutes ?? null,
      cost_usd: row.cost_usd ?? null,
      model: row.model ?? null,
      basis: cleanBasis(row.basis),
    };
    // update leaves time_entry_id alone: a tap's link survives a re-post.
    await db.workClock.upsert({ where: { dedupe_key: row.dedupe_key }, create: { ...data, dedupe_key: row.dedupe_key }, update: data });
    if (prior) updated += 1;
    else created += 1;
  }
  refused.sort((a, b) => a.index - b.index);
  return { result: 'saved', created, updated, refused };
}

// ============================================================================
// What the owner sees
// ============================================================================

export interface ClockSummary {
  target_key: string;
  month_start: string;
  mike: null | {
    minutes: number;
    unlogged_minutes: number;
    logged_minutes: number;
    sessions: number;
    days: number;
    inferred_from: string;
    basis: string[];
    /** Preselected in the Log it choices: the unlogged estimate in steps of five minutes, or null when nothing is left to log. */
    suggested: number | null;
    choices: number[];
    line: string;
  };
  bast: null | { minutes: number; agent_minutes: number | null; cost_usd: number | null; line: string };
}

/** Pure: the first instant of the month in the owner's zone. */
export function monthStart(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return zonedToUtc(get('year'), get('month'), 1, 0, 0, timeZone);
}

function whereTarget(targetKey: string) {
  const t = parseTargetKey(targetKey);
  if (!t) return null;
  // A project total includes its tasks' rows (project_id is set on both); a task shows its own.
  return t.type === 'project' ? { project_id: t.id } : { task_id: t.id };
}

interface ClockRowRead {
  id: string;
  kind: string;
  session_external_id: string | null;
  started_at: Date;
  minutes: number;
  agent_minutes: number | null;
  cost_usd: { toString(): string } | null;
  basis: string | null;
  time_entry_id: string | null;
  source: string;
}

/** Rows this month for a target, newest first. The caller decides what to show. */
export async function loadClockRows(db: HomeDb, targetKey: string, from: Date): Promise<ClockRowRead[]> {
  const where = whereTarget(targetKey);
  if (!where) return [];
  return db.workClock.findMany({
    where: { ...where, started_at: { gte: from } },
    orderBy: { started_at: 'desc' },
    take: 2000,
    select: { id: true, kind: true, session_external_id: true, started_at: true, minutes: true, agent_minutes: true, cost_usd: true, basis: true, time_entry_id: true, source: true },
  });
}

/** Pure: the two lines from a list of rows. */
export function summarize(targetKey: string, rows: readonly ClockRowRead[], from: Date, timeZone: string): ClockSummary {
  const mikeRows = rows.filter((r) => r.kind === 'mike_estimate');
  const bastRows = rows.filter((r) => r.kind === 'bast_run');
  let mike: ClockSummary['mike'] = null;
  if (mikeRows.length > 0) {
    const unlogged = mikeRows.filter((r) => r.time_entry_id === null).reduce((n, r) => n + r.minutes, 0);
    const logged = mikeRows.filter((r) => r.time_entry_id !== null).reduce((n, r) => n + r.minutes, 0);
    const sessions = new Set(mikeRows.filter((r) => r.source === 'session' && r.session_external_id).map((r) => r.session_external_id)).size;
    const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const days = new Set(mikeRows.map((r) => dayOf(r.started_at))).size;
    const from_ = inferredFrom(sessions, days);
    const basis = [...new Set(mikeRows.map((r) => r.basis).filter((b): b is string => !!b))].slice(0, 3);
    const suggested = unlogged > 0 ? Math.max(5, roundToStep(unlogged)) : null;
    mike = {
      minutes: unlogged + logged,
      unlogged_minutes: unlogged,
      logged_minutes: logged,
      sessions,
      days,
      inferred_from: from_,
      basis,
      suggested,
      choices: [...LOG_CHOICES],
      line: mikeLine(unlogged, logged, from_),
    };
  }
  let bast: ClockSummary['bast'] = null;
  if (bastRows.length > 0) {
    const minutes = bastRows.reduce((n, r) => n + r.minutes, 0);
    const costed = bastRows.filter((r) => r.cost_usd !== null);
    const cost = costed.length > 0 ? costed.reduce((n, r) => n + Number(r.cost_usd!.toString()), 0) : null;
    const agentRows = bastRows.filter((r) => r.agent_minutes !== null);
    const agent = agentRows.length > 0 ? agentRows.reduce((n, r) => n + (r.agent_minutes ?? 0), 0) : null;
    bast = { minutes, agent_minutes: agent, cost_usd: cost, line: bastLine(minutes, cost, costed.length === bastRows.length) };
  }
  return { target_key: targetKey, month_start: from.toISOString(), mike, bast };
}

export async function loadClockSummary(db: HomeDb, targetKey: string, now: Date, timeZone: string): Promise<ClockSummary> {
  const from = monthStart(now, timeZone);
  return summarize(targetKey, await loadClockRows(db, targetKey, from), from, timeZone);
}

// ============================================================================
// His tap: Log it
// ============================================================================

export interface LogClockRecord {
  kind: 'log_clock';
  target_key: string;
  time_entry_id: string;
  started_at: string;
  duration: number;
  clock_ids: string[];
}

export interface LogClockReq {
  target_key: string;
  minutes: number;
  billable?: boolean;
  now: Date;
  timezone: string;
}

/**
 * The one writer of a time entry from the clocks. Called only from POST /api/home/reconcile (browser session). It needs unlogged
 * mike_estimate rows on the target this month, makes ONE entry for the minutes he chose, and stamps every unlogged estimate row it
 * answered so the same estimate is not offered twice. bast_run rows are never touched. Undo is a soft delete plus un-stamping.
 */
export async function logClock(db: PrismaClient, userId: string, req: LogClockReq): Promise<HomeActResponse> {
  const t = parseTargetKey(req.target_key);
  if (!t) throw new ApiError(CLOCK_MESSAGES.notFound, 404, 'not_found');
  const minutes = Math.max(1, Math.min(ROW_MINUTES_MAX, Math.round(req.minutes)));
  return db.$transaction(
    async (txc) => {
      const tx = txc as unknown as PrismaClient;
      let taskId: string | null = null;
      let projectId: string | null = null;
      if (t.type === 'task') {
        const row = await tx.task.findUnique({ where: { id: t.id }, select: { id: true, project_id: true, is_deleted: true } });
        if (!row || row.is_deleted) throw new ApiError(CLOCK_MESSAGES.notFound, 404, 'not_found');
        taskId = row.id;
        projectId = row.project_id;
      } else {
        const row = await tx.project.findUnique({ where: { id: t.id }, select: { id: true, is_deleted: true } });
        if (!row || row.is_deleted) throw new ApiError(CLOCK_MESSAGES.notFound, 404, 'not_found');
        projectId = row.id;
      }
      const from = monthStart(req.now, req.timezone);
      const rows = (await loadClockRows(tx, req.target_key, from)).filter((r) => r.kind === 'mike_estimate' && r.time_entry_id === null);
      if (rows.length === 0) throw new ApiError(CLOCK_MESSAGES.noEstimate, 409, 'no_estimate');
      const summary = summarize(req.target_key, rows, from, req.timezone);
      const lastEnd = await tx.workClock.findFirst({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { ended_at: 'desc' }, select: { ended_at: true } });
      const ended = new Date(Math.min(req.now.getTime(), (lastEnd?.ended_at ?? req.now).getTime()));
      const started = new Date(ended.getTime() - minutes * 60_000);
      const entry = await tx.timeEntry.create({
        data: {
          user_id: userId,
          task_id: taskId,
          project_id: projectId,
          started_at: started,
          ended_at: ended,
          duration: minutes,
          is_running: false,
          description: CLOCK_MESSAGES.entryDescription(summary.mike?.inferred_from ?? 'your sessions'),
          is_billable: req.billable ?? true,
          hourly_rate: null,
        },
        select: { id: true, started_at: true, duration: true },
      });
      const ids = rows.map((r) => r.id);
      const stamped = await tx.workClock.updateMany({ where: { id: { in: ids }, kind: 'mike_estimate', time_entry_id: null }, data: { time_entry_id: entry.id } });
      if (stamped.count !== ids.length) throw new ApiError('Changed since. Open the task.', 409, 'changed_since');
      const rec: LogClockRecord = { kind: 'log_clock', target_key: req.target_key, time_entry_id: entry.id, started_at: entry.started_at.toISOString(), duration: entry.duration, clock_ids: ids };
      const undoUntil = new Date(req.now.getTime() + LOG_UNDO_HOURS * HOUR_MS);
      const row = await appendHomeAction(tx as unknown as HomeDb, userId, {
        item_key: req.target_key,
        action: LOG_CLOCK_ACTION,
        before: { states: [], reconcile: rec },
        after: { states: [], reconcile: rec },
        undo_until: undoUntil,
      });
      return { ok: true as const, action_id: row.id, undo_until: undoUntil.toISOString(), item_key: req.target_key, message: CLOCK_MESSAGES.logged(entry.duration) };
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

export { formatMinutes };
