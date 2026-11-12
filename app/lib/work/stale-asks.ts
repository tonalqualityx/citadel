/**
 * Work stage E: the one-time clear of old parked session questions, server side.
 *
 * A session parks a question on the owner (OracleSession.waiting_on) and leaves. Questions that piled up on sessions nobody has touched
 * for a week are cleared the way the owner's own "Clear it" does it: the owner's home_item_state row for `session:<external id>` gets
 * the hash of the text it cleared. The session's own record is never touched (its heartbeat would send the text back), and a NEW
 * question from the same session shows again, because it hashes differently.
 *
 * Every clear is written FIRST to the ledger (work_stale_ask_clear: the full text, its hash, who asked, when), and one Handled line
 * with Undo (72 hours) is written. Any ledger row can be restored later by run key, with no time limit, while the owner has not cleared
 * or changed that mark since (compare-and-set on the hash).
 *
 * Never cleared, never hidden: a question marked client_blocking or launch_blocking; anything security-tagged (a task tagged security
 * that this session made or is linked to, or security words in the question, its title or its goal); a session that is still live
 * (running or waiting); a question newer than the cutoff; a question the owner already cleared. A dry run writes nothing at all.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { EXCLUDED_SESSION_STATUSES, hasSecurityTag } from '@/lib/home/rules';
import { sessionAskHash } from '@/lib/home/session-clear';
import { appendHomeAction, upsertItemState, type HomeDb } from '@/lib/home/state';
import { displayText } from '@/lib/home/copy';
import { homeOwner } from './ask-closure';
import { STALE_MESSAGES, staleClearedLine } from './session-copy';

export const STALE_ASK_DAYS = 7;
export const STALE_UNDO_HOURS = 72;
export const STALE_ACTION = 'work_stale_clear';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SAMPLE = 10;
/** The most one run clears (the plan counts 357 today). */
export const STALE_RUN_MAX = 2000;

const SECURITY_WORDS = /\b(security|compromis\w*|malware|breach\w*|hack\w*|phish\w*|ransom\w*|vulnerab\w*|backdoor|exploit\w*|intrusion|spam\s+dirs?)\b/i;

export const isLiveSessionStatus = (status: string): boolean => status === 'running' || status === 'waiting';

export interface StaleCandidateFacts {
  status: string;
  ask_severity: string | null;
  asked_at: Date;
  title: string | null;
  goal: string | null;
  waiting_on: string;
  /** A security-tagged task made by or linked to this session. */
  security_task: boolean;
  already_cleared: boolean;
}

export type StaleVerdict = 'clear' | 'live' | 'ended_hidden' | 'too_new' | 'client_blocking' | 'launch_blocking' | 'security' | 'already_cleared';

/** Pure: what the clear does with one parked question. The order is fixed: the protected ones are checked before anything else. */
export function staleVerdict(f: StaleCandidateFacts, now: Date, days: number): StaleVerdict {
  if (f.ask_severity === 'client_blocking') return 'client_blocking';
  if (f.ask_severity === 'launch_blocking') return 'launch_blocking';
  if (f.security_task || SECURITY_WORDS.test(`${f.waiting_on} ${f.title ?? ''} ${f.goal ?? ''}`)) return 'security';
  if (isLiveSessionStatus(f.status)) return 'live';
  if ((EXCLUDED_SESSION_STATUSES as readonly string[]).includes(f.status)) return 'ended_hidden'; // never on the screen already
  if (now.getTime() - f.asked_at.getTime() < days * DAY_MS) return 'too_new';
  if (f.already_cleared) return 'already_cleared';
  return 'clear';
}

export interface StaleRunResult {
  dry: boolean;
  skipped?: 'home_off';
  run_key?: string;
  /** Sessions holding a parked question (not archived). */
  with_ask: number;
  would_clear: number;
  cleared: number;
  kept: Record<Exclude<StaleVerdict, 'clear'>, number>;
  sample: { title: string; days: number }[];
  action_id?: string | null;
}

const emptyKept = (): StaleRunResult['kept'] => ({ live: 0, ended_hidden: 0, too_new: 0, client_blocking: 0, launch_blocking: 0, security: 0, already_cleared: 0 });

export function staleRunKey(now: Date, zone: string): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return `stale-asks-${d}`;
}

export interface ClearRecord {
  kind: 'stale_clear';
  run_key: string;
  ledger_ids: string[];
}

export function readStaleRecord(v: unknown): ClearRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = (v as { stale_clear?: unknown }).stale_clear as Partial<ClearRecord> | undefined;
  return r && r.kind === 'stale_clear' && typeof r.run_key === 'string' && Array.isArray(r.ledger_ids) ? (r as ClearRecord) : null;
}


/** The sessions of one run: the ones holding a question, with what the verdict needs. Reads only. */
async function gather(db: PrismaClient, userId: string, now: Date, days: number) {
  const sessions = await db.oracleSession.findMany({
    where: { waiting_on: { not: null }, archived_at: null },
    select: { id: true, external_id: true, title: true, goal: true, waiting_on: true, ask_severity: true, status: true, last_event_at: true, updated_at: true },
    orderBy: { last_event_at: 'asc' },
    take: 5000,
  });
  const live = sessions.filter((s) => (s.waiting_on ?? '').trim() !== '');
  const refs = live.map((s) => s.external_id);
  const [states, madeTasks, linkRows] = await Promise.all([
    refs.length ? db.homeItemState.findMany({ where: { user_id: userId, item_key: { in: refs.map((r) => `session:${r}`) }, session_cleared_hash: { not: null } }, select: { item_key: true } }) : Promise.resolve([]),
    refs.length ? db.task.findMany({ where: { source_session_external_id: { in: refs }, is_deleted: false }, select: { source_session_external_id: true, tags: true } }) : Promise.resolve([]),
    refs.length ? db.workLink.findMany({ where: { kind: 'session', ref: { in: refs }, state: 'active' }, select: { ref: true, task_id: true, project_id: true } }) : Promise.resolve([]),
  ]);
  const cleared = new Set(states.map((s) => s.item_key));
  const securitySessions = new Set<string>();
  for (const t of madeTasks) if (t.source_session_external_id && hasSecurityTag(t.tags)) securitySessions.add(t.source_session_external_id);
  const taskIds = linkRows.map((l) => l.task_id).filter((x): x is string => !!x);
  const projectIds = linkRows.map((l) => l.project_id).filter((x): x is string => !!x);
  const [secTasks, secProjectTasks] = await Promise.all([
    taskIds.length ? db.task.findMany({ where: { id: { in: taskIds }, is_deleted: false }, select: { id: true, tags: true } }) : Promise.resolve([]),
    projectIds.length ? db.task.findMany({ where: { project_id: { in: projectIds }, is_deleted: false, status: { notIn: ['done', 'abandoned'] } }, select: { project_id: true, tags: true } }) : Promise.resolve([]),
  ]);
  const secTaskIds = new Set(secTasks.filter((t) => hasSecurityTag(t.tags)).map((t) => t.id));
  const secProjectIds = new Set(secProjectTasks.filter((t) => hasSecurityTag(t.tags)).map((t) => t.project_id as string));
  for (const l of linkRows) if ((l.task_id && secTaskIds.has(l.task_id)) || (l.project_id && secProjectIds.has(l.project_id))) securitySessions.add(l.ref);
  void now;
  void days;
  return live.map((s) => ({
    s,
    facts: {
      status: s.status,
      ask_severity: s.ask_severity,
      asked_at: s.last_event_at ?? s.updated_at,
      title: s.title,
      goal: s.goal,
      waiting_on: s.waiting_on as string,
      security_task: securitySessions.has(s.external_id),
      already_cleared: cleared.has(`session:${s.external_id}`),
    } satisfies StaleCandidateFacts,
  }));
}

/**
 * The clear. `dry` reads and counts and writes nothing. Without `dry` it writes the ledger rows, the owner's cleared marks and one
 * Handled line, in one transaction. A second run on the same day clears only questions that became stale since.
 */
export async function runStaleClear(db: PrismaClient, opts: { dry: boolean; older_than_days?: number; now: Date }): Promise<StaleRunResult> {
  const days = opts.older_than_days ?? STALE_ASK_DAYS;
  const empty: StaleRunResult = { dry: opts.dry, with_ask: 0, would_clear: 0, cleared: 0, kept: emptyKept(), sample: [] };
  const owner = await homeOwner(db as unknown as HomeDb);
  if (!owner) return { ...empty, skipped: 'home_off' };
  const rows = await gather(db, owner.id, opts.now, days);
  const kept = emptyKept();
  const todo: typeof rows = [];
  for (const r of rows) {
    const v = staleVerdict(r.facts, opts.now, days);
    if (v === 'clear') todo.push(r);
    else kept[v] += 1;
  }
  const sample = todo.slice(0, SAMPLE).map((r) => ({ title: displayText(r.s.title ?? 'A session') || 'A session', days: Math.floor((opts.now.getTime() - r.facts.asked_at.getTime()) / DAY_MS) }));
  const run_key = staleRunKey(opts.now, owner.timezone);
  const base: StaleRunResult = { dry: opts.dry, run_key, with_ask: rows.length, would_clear: todo.length, cleared: 0, kept, sample };
  if (opts.dry || todo.length === 0) return base;
  if (todo.length > STALE_RUN_MAX) throw new ApiError(`That would clear ${todo.length} questions at once. Stop and check.`, 409, 'too_many');

  return db.$transaction(async (tx) => {
    const ledger = await tx.workStaleAskClear.createManyAndReturn({
      data: todo.map((r) => ({
        user_id: owner.id,
        run_key,
        session_external_id: r.s.external_id,
        session_title: r.s.title ? r.s.title.slice(0, 500) : null,
        ask_text: r.facts.waiting_on,
        ask_hash: sessionAskHash(r.facts.waiting_on),
        ask_severity: r.s.ask_severity,
        asked_at: r.facts.asked_at,
      })),
      skipDuplicates: true,
      select: { id: true, session_external_id: true, ask_hash: true },
    });
    const wanted = new Map(todo.map((r) => [r.s.external_id, r]));
    for (const l of ledger) {
      if (!wanted.has(l.session_external_id)) continue;
      await upsertItemState(tx as unknown as HomeDb, owner.id, `session:${l.session_external_id}`, { session_cleared_at: opts.now, session_cleared_hash: l.ask_hash });
    }
    const rec: ClearRecord = { kind: 'stale_clear', run_key, ledger_ids: ledger.map((l) => l.id) };
    let action_id: string | null = null;
    if (ledger.length > 0) {
      const line = staleClearedLine(ledger.length);
      const row = await appendHomeAction(tx as unknown as HomeDb, owner.id, {
        item_key: null,
        action: STALE_ACTION,
        source: 'keeper',
        before: { states: [], stale_clear: rec },
        after: { states: [], stale_clear: rec, line, details: [`Run ${run_key}. Each question is kept in a ledger and can be brought back.`], href: null },
        undo_until: new Date(opts.now.getTime() + STALE_UNDO_HOURS * HOUR_MS),
      });
      action_id = row.id;
      await tx.workStaleAskClear.updateMany({ where: { id: { in: rec.ledger_ids } }, data: { home_action_id: row.id } });
    }
    return { ...base, cleared: ledger.length, action_id };
  }, { timeout: 60_000, maxWait: 10_000 });
}

export interface RestoreResult {
  dry: boolean;
  skipped?: 'home_off';
  run_key: string;
  in_ledger: number;
  restored: number;
  left_as_is: number;
  message?: string;
}

/**
 * Bring back the questions of one run (or the ones of an Undo). A row is restored only while the owner's mark on that session is still
 * the one the clear wrote (the same hash); a mark he changed since stays as it is. The ledger row is marked restored, never deleted.
 */
export async function restoreStaleClear(db: HomeDb, opts: { run_key?: string; ledger_ids?: string[]; dry: boolean; now: Date }): Promise<RestoreResult> {
  const run_key = opts.run_key ?? '';
  const owner = await homeOwner(db);
  if (!owner) return { dry: opts.dry, skipped: 'home_off', run_key, in_ledger: 0, restored: 0, left_as_is: 0 };
  const where: Prisma.WorkStaleAskClearWhereInput = { user_id: owner.id, state: 'cleared', ...(opts.ledger_ids ? { id: { in: opts.ledger_ids } } : { run_key }) };
  const rows = await db.workStaleAskClear.findMany({ where, orderBy: { created_at: 'asc' }, take: STALE_RUN_MAX * 2 });
  let restored = 0;
  let left = 0;
  for (const r of rows) {
    const key = `session:${r.session_external_id}`;
    const st = await db.homeItemState.findUnique({ where: { user_id_item_key: { user_id: owner.id, item_key: key } }, select: { session_cleared_hash: true } });
    if (st?.session_cleared_hash !== r.ask_hash) {
      left += 1;
      continue;
    }
    if (!opts.dry) {
      const u = await db.homeItemState.updateMany({ where: { user_id: owner.id, item_key: key, session_cleared_hash: r.ask_hash }, data: { session_cleared_at: null, session_cleared_hash: null } });
      if (u.count !== 1) {
        left += 1;
        continue;
      }
      await db.workStaleAskClear.updateMany({ where: { id: r.id, state: 'cleared' }, data: { state: 'restored', restored_at: opts.now } });
    }
    restored += 1;
  }
  return { dry: opts.dry, run_key, in_ledger: rows.length, restored, left_as_is: left, message: opts.dry ? undefined : STALE_MESSAGES.restored(restored) };
}

/** Undo of the Handled line (called from runHomeUndo inside its transaction). */
export async function undoStaleClear(db: HomeDb, rec: ClearRecord, now: Date): Promise<void> {
  await restoreStaleClear(db, { run_key: rec.run_key, ledger_ids: rec.ledger_ids, dry: false, now });
}
