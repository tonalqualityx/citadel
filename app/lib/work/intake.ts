/**
 * Work stage B: closing and reopening asks by intake decision.
 *
 * Every close here is visible and undoable, and nothing closes silently:
 * - birth closes (no_action, waiting_them) are written by the email-sync route and show as a quiet "Recorded as handled" line
 *   with Undo and in the 30-day list (loadHandledMail);
 * - the replay (applyDecisions) closes legacy asks marked no_action with ONE Handled line (home_actions, action intake_close, Undo
 *   for 72 hours) and each stays in the 30-day list with its own Undo;
 * - meeting asks close when the meeting is booked (closeMeetingAsks), one Handled line.
 *
 * Undo (reopenAsk, or Undo of a batch line) sets state open, disposition reply_mike, decided_by 'mike', and clears the closed_*
 * fields. decided_by 'mike' is the hold: every closer skips an ask he decided (notHeldByMike). Urgent, admin, sales and
 * security-task asks are never closed here, and no mail is sent, drafted or changed.
 */

import { appendHomeAction, type HomeDb } from '@/lib/home/state';
import { cleanReason, decideReplay, MACHINE_DECIDERS, notHeldByMike, type Disposition, type FloorExempt, type ReplayAsk } from './decision';
import { homeOwner, isSecurityTagged } from './ask-closure';
import { intakeBatchLine, meetingBookedLine, askDetail } from './copy';

export const INTAKE_CLOSE_ACTION = 'intake_close';
export const REOPEN_ASK_ACTION = 'reopen_ask';
export const INTAKE_CLOSE_UNDO_HOURS = 72;
/** How long a recorded-as-handled mail stays in the list and can be reopened. */
export const HANDLED_MAIL_DAYS = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Reasons an intake decision writes on a closed ask (the only closes the list and reopen_ask cover). */
export const INTAKE_CLOSE_REASONS = ['no_action', 'waiting_them'] as const;

export const ASK_REF_RE = /^ask:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const askRef = (id: string): string => `ask:${id}`;
export const askIdOfRef = (ref: string): string | null => (ASK_REF_RE.test(ref) ? ref.slice(4) : null);

export class IntakeError extends Error {
  constructor(public code: 'not_found' | 'not_reopenable' | 'undo_expired', message: string) {
    super(message);
  }
}

// ----------------------------------------------------------------------------
// Records
// ----------------------------------------------------------------------------

export interface IntakeCloseRecord {
  kind: 'intake_close';
  asks: { id: string; closed_reason: string }[];
}

export function readIntakeCloseRecord(v: unknown): IntakeCloseRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = (v as { intake_close?: unknown }).intake_close;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const r = rec as Partial<IntakeCloseRecord>;
  if (r.kind !== 'intake_close' || !Array.isArray(r.asks)) return null;
  return r as IntakeCloseRecord;
}

const REOPEN_DATA = {
  state: 'open' as const,
  disposition: 'reply_mike',
  owner: 'mike',
  decided_by: 'mike',
  closed_at: null,
  closed_reason: null,
  closed_by: null,
};

/** Reopen exactly these asks (compare-and-set: still handled with the reason the close wrote). Returns the ids reopened. */
export async function reopenAsks(db: HomeDb, asks: readonly { id: string; closed_reason: string }[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of asks) {
    const r = await db.emailAsk.updateMany({ where: { id: a.id, state: 'handled', closed_reason: a.closed_reason }, data: REOPEN_DATA });
    if (r.count === 1) out.push(a.id);
  }
  return out;
}

/** Undo of an intake_close line (called from runHomeUndo inside its transaction). */
export async function undoIntakeClose(db: HomeDb, rec: IntakeCloseRecord): Promise<{ reopened: string[] }> {
  return { reopened: await reopenAsks(db, rec.asks) };
}

/**
 * The home act reopen_ask: Undo of one recorded-as-handled mail, allowed for 30 days after it closed. Writes a home_actions row (the
 * reopen count the weekly measures line reads, and the calibration examples the classifier reads).
 */
export async function reopenAsk(db: HomeDb, userId: string, ref: string, now: Date): Promise<{ action_id: string; ask_id: string }> {
  const id = askIdOfRef(ref);
  if (!id) throw new IntakeError('not_found', 'That is not a recorded email.');
  const ask = await db.emailAsk.findUnique({ where: { id }, select: { id: true, state: true, closed_at: true, closed_reason: true, closed_by: true, subject: true, disposition_reason: true } });
  if (!ask) throw new IntakeError('not_found', 'That email is gone.');
  if (ask.state !== 'handled' || !ask.closed_reason || !(INTAKE_CLOSE_REASONS as readonly string[]).includes(ask.closed_reason)) {
    throw new IntakeError('not_reopenable', 'That email is not recorded as handled.');
  }
  if (ask.closed_at && ask.closed_at.getTime() < now.getTime() - HANDLED_MAIL_DAYS * DAY_MS) {
    throw new IntakeError('undo_expired', 'That one was recorded more than 30 days ago.');
  }
  const r = await db.emailAsk.updateMany({ where: { id, state: 'handled', closed_reason: ask.closed_reason }, data: REOPEN_DATA });
  if (r.count !== 1) throw new IntakeError('not_reopenable', 'That email changed since.');
  const row = await appendHomeAction(db, userId, {
    item_key: null,
    action: REOPEN_ASK_ACTION,
    source: 'keeper',
    before: { states: [], reopen_ask: { id, closed_reason: ask.closed_reason, closed_by: ask.closed_by, subject: ask.subject, reason: ask.disposition_reason } },
    after: { states: [], reopen_ask: { id } },
    undo_until: null,
  });
  return { action_id: row.id, ask_id: id };
}

// ----------------------------------------------------------------------------
// The replay: decision-replay (reads) and apply-decisions (writes) share decideReplay
// ----------------------------------------------------------------------------

export interface ReplayItem {
  ask_id: string;
  disposition: string;
  reason?: string | null;
  /** A claim that the mail is a routine provider receipt. The server checks it itself (decision.ts isVerifiedProviderReceipt). */
  floor_exempt?: FloorExempt | null;
}

export interface ReplayRowOut {
  ask_id: string;
  verdict: 'close' | 'set' | 'leave' | 'refused';
  disposition: Disposition | null;
  why: string | null;
  /** What the ask is now (state and disposition), for the reader of the dry run. */
  now: { state: string; disposition: string | null } | null;
  subject: string | null;
}

export interface ReplayCounts {
  total: number;
  would_close: number;
  would_set: number;
  left: number;
  refused: number;
  by_disposition: Record<string, number>;
}

const ASK_FACTS = {
  id: true,
  state: true,
  disposition: true,
  decided_by: true,
  is_urgent: true,
  intent: true,
  task_id: true,
  gist: true,
  subject: true,
  from_name: true,
  from_email: true,
  received_at: true,
  deep_link: true,
  task: { select: { tags: true, is_deleted: true } },
} as const;

/** What each item would change. Reads only. */
export async function planReplay(db: HomeDb, items: readonly ReplayItem[]): Promise<{ rows: ReplayRowOut[]; counts: ReplayCounts }> {
  const ids = Array.from(new Set(items.map((i) => i.ask_id)));
  const asks = await db.emailAsk.findMany({ where: { id: { in: ids } }, select: ASK_FACTS });
  const byId = new Map(asks.map((a) => [a.id, a]));
  const rows: ReplayRowOut[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const a = byId.get(item.ask_id);
    if (seen.has(item.ask_id)) {
      rows.push({ ask_id: item.ask_id, verdict: 'leave', disposition: null, why: 'repeated_in_list', now: a ? { state: a.state, disposition: a.disposition } : null, subject: a?.subject ?? null });
      continue;
    }
    seen.add(item.ask_id);
    const facts: ReplayAsk | null = a
      ? {
          id: a.id,
          state: a.state,
          disposition: a.disposition,
          decided_by: a.decided_by,
          is_urgent: a.is_urgent,
          intent: a.intent,
          task_id: a.task && !a.task.is_deleted ? a.task_id : null,
          task_security: !!a.task && isSecurityTagged(a.task.tags),
          subject: a.subject,
          from_email: a.from_email,
          gist: a.gist,
        }
      : null;
    const d = decideReplay(facts, item);
    rows.push({ ask_id: item.ask_id, verdict: d.verdict, disposition: d.disposition, why: d.why, now: a ? { state: a.state, disposition: a.disposition } : null, subject: a?.subject ?? null });
  }
  const counts: ReplayCounts = { total: rows.length, would_close: 0, would_set: 0, left: 0, refused: 0, by_disposition: {} };
  for (const r of rows) {
    if (r.verdict === 'close') counts.would_close++;
    else if (r.verdict === 'set') counts.would_set++;
    else if (r.verdict === 'refused') counts.refused++;
    else counts.left++;
    if (r.disposition) counts.by_disposition[r.disposition] = (counts.by_disposition[r.disposition] ?? 0) + 1;
  }
  return { rows, counts };
}

export interface ApplyResult {
  dry: boolean;
  counts: ReplayCounts;
  rows: ReplayRowOut[];
  closed: string[];
  set: string[];
  action_id: string | null;
  skipped?: 'home_off';
}

/**
 * apply-decisions. Dry: the same plan, nothing written. Real: closes no_action asks (compare-and-set, one Handled line with Undo)
 * and stores the other dispositions on the open asks. Needs the home owner on the home view (every close has a line); without one it
 * answers skipped home_off and writes nothing.
 */
export async function applyDecisions(db: HomeDb, items: readonly ReplayItem[], opts: { dry: boolean; now?: Date }): Promise<ApplyResult> {
  const now = opts.now ?? new Date();
  const plan = await planReplay(db, items);
  const empty: ApplyResult = { dry: opts.dry, counts: plan.counts, rows: plan.rows, closed: [], set: [], action_id: null };
  if (opts.dry) return empty;
  const owner = await homeOwner(db);
  if (!owner) return { ...empty, skipped: 'home_off' };

  const reasons = new Map(items.map((i) => [i.ask_id, i.reason ?? null]));
  const run = async (tx: HomeDb): Promise<ApplyResult> => {
    const closed: string[] = [];
    const set: string[] = [];
    for (const r of plan.rows) {
      if (r.verdict !== 'close' && r.verdict !== 'set') continue;
      const reason = cleanReason(reasons.get(r.ask_id));
      if (r.verdict === 'close') {
        const w = await tx.emailAsk.updateMany({
          // Compare and set on what the plan read: an undecided ask, or (verified receipt only) a reply_mike a machine stored.
          where:
            r.now?.disposition === 'reply_mike'
              ? { id: r.ask_id, state: 'open', disposition: 'reply_mike', is_urgent: false, decided_by: { in: [...MACHINE_DECIDERS] } }
              : { id: r.ask_id, state: 'open', disposition: null, is_urgent: false, ...notHeldByMike },
          data: { state: 'handled', disposition: 'no_action', disposition_reason: reason, owner: 'nobody', decided_by: 'intake', closed_at: now, closed_reason: 'no_action', closed_by: 'backfill', draft_started_at: null, draft_url: null },
        });
        if (w.count === 1) closed.push(r.ask_id);
      } else if (r.disposition) {
        const w = await tx.emailAsk.updateMany({
          where: { id: r.ask_id, state: 'open', disposition: null, ...notHeldByMike },
          data: { disposition: r.disposition, disposition_reason: reason, owner: r.disposition === 'work' ? null : 'mike', decided_by: 'intake' },
        });
        if (w.count === 1) set.push(r.ask_id);
      }
    }
    let action_id: string | null = null;
    if (closed.length > 0) {
      const asks = await tx.emailAsk.findMany({ where: { id: { in: closed } }, select: { id: true, from_name: true, from_email: true, subject: true, received_at: true, deep_link: true }, orderBy: { received_at: 'asc' } });
      const rec: IntakeCloseRecord = { kind: 'intake_close', asks: closed.map((id) => ({ id, closed_reason: 'no_action' })) };
      const row = await appendHomeAction(tx, owner.id, {
        item_key: null,
        action: INTAKE_CLOSE_ACTION,
        source: 'keeper',
        before: { states: [], intake_close: rec },
        after: {
          states: [],
          intake_close: rec,
          line: intakeBatchLine(closed.length),
          details: asks.map((a) => askDetail(a, owner.timezone)),
          href: null,
        },
        undo_until: new Date(now.getTime() + INTAKE_CLOSE_UNDO_HOURS * HOUR_MS),
      });
      action_id = row.id;
    }
    return { ...empty, closed, set, action_id };
  };
  const d = db as unknown as { $transaction?: (f: (tx: HomeDb) => Promise<ApplyResult>) => Promise<ApplyResult> };
  return typeof d.$transaction === 'function' ? d.$transaction((tx) => run(tx)) : run(db);
}

// ----------------------------------------------------------------------------
// Meeting closure (the calendar sync's write path)
// ----------------------------------------------------------------------------

function attendeeEmails(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  const out: string[] = [];
  for (const a of attendees) {
    if (a && typeof a === 'object') {
      const e = (a as { email?: unknown }).email;
      if (typeof e === 'string' && e.includes('@')) out.push(e.trim().toLowerCase());
    }
  }
  return out;
}

/**
 * An open `meeting` ask whose sender is among the event's attendees closes as meeting_booked, when the event was created after the
 * ask arrived (and does not start before it). One Handled line with Undo. Never an urgent ask; never one Mike reopened. Owner only.
 */
export async function closeMeetingAsks(
  db: HomeDb,
  event: { title: string; attendees: unknown; created_at: Date; starts_at: Date },
  now: Date = new Date(),
): Promise<{ closed: string[]; action_id: string | null }> {
  const emails = attendeeEmails(event.attendees);
  if (emails.length === 0) return { closed: [], action_id: null };
  const candidates = await db.emailAsk.findMany({
    where: {
      state: 'open',
      disposition: 'meeting',
      is_urgent: false,
      received_at: { lt: event.created_at, lte: event.starts_at },
      from_email: { in: emails, mode: 'insensitive' },
      ...notHeldByMike,
    },
    select: { id: true, from_name: true, from_email: true, subject: true, received_at: true, deep_link: true },
    orderBy: { received_at: 'asc' },
  });
  if (candidates.length === 0) return { closed: [], action_id: null };
  const owner = await homeOwner(db);
  if (!owner) return { closed: [], action_id: null };
  const closed: typeof candidates = [];
  for (const c of candidates) {
    const r = await db.emailAsk.updateMany({
      where: { id: c.id, state: 'open', disposition: 'meeting', ...notHeldByMike },
      data: { state: 'handled', closed_at: now, closed_reason: 'meeting_booked', closed_by: 'intake', draft_started_at: null, draft_url: null },
    });
    if (r.count === 1) closed.push(c);
  }
  if (closed.length === 0) return { closed: [], action_id: null };
  const rec: IntakeCloseRecord = { kind: 'intake_close', asks: closed.map((c) => ({ id: c.id, closed_reason: 'meeting_booked' })) };
  const row = await appendHomeAction(db, owner.id, {
    item_key: null,
    action: INTAKE_CLOSE_ACTION,
    source: 'keeper',
    before: { states: [], intake_close: rec },
    after: {
      states: [],
      intake_close: rec,
      line: meetingBookedLine(closed.map((c) => c.from_name || c.from_email), event.title, event.starts_at, owner.timezone),
      details: closed.map((c) => askDetail(c, owner.timezone)),
      href: closed.length === 1 ? closed[0].deep_link || null : null,
    },
    undo_until: new Date(now.getTime() + INTAKE_CLOSE_UNDO_HOURS * HOUR_MS),
  });
  return { closed: closed.map((c) => c.id), action_id: row.id };
}

// ----------------------------------------------------------------------------
// Reads for the screen
// ----------------------------------------------------------------------------

export interface HandledMailRow {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  reason: string | null;
  deep_link: string;
  closed_at: Date;
  client_name: string | null;
  /** closed_reason: no_action | waiting_them */
  kind: string;
}

/** Mail recorded as handled by an intake decision in the last 30 days, newest first. Read only. */
export async function loadHandledMail(db: HomeDb, now: Date, take = 300): Promise<HandledMailRow[]> {
  const rows = await db.emailAsk.findMany({
    where: { state: 'handled', closed_reason: { in: [...INTAKE_CLOSE_REASONS] }, closed_at: { gte: new Date(now.getTime() - HANDLED_MAIL_DAYS * DAY_MS) } },
    select: { id: true, from_name: true, from_email: true, subject: true, disposition_reason: true, deep_link: true, closed_at: true, closed_reason: true, client: { select: { name: true } } },
    orderBy: { closed_at: 'desc' },
    take,
  });
  return rows.flatMap((r) =>
    r.closed_at && r.closed_reason
      ? [{ id: r.id, from_name: r.from_name, from_email: r.from_email, subject: r.subject, reason: r.disposition_reason, deep_link: r.deep_link, closed_at: r.closed_at, client_name: r.client?.name ?? null, kind: r.closed_reason }]
      : [],
  );
}

/** The weekly measure: mail recorded as handled in the window (those he reopened included), and how many he reopened. */
export async function handledMailMeasure(db: HomeDb, userId: string, since: Date, until: Date): Promise<{ recorded: number; reopened: number }> {
  const [stillClosed, reopened] = await Promise.all([
    db.emailAsk.count({ where: { closed_reason: { in: [...INTAKE_CLOSE_REASONS] }, closed_at: { gte: since, lt: until } } }),
    db.homeAction.count({ where: { user_id: userId, action: REOPEN_ASK_ACTION, created_at: { gte: since, lt: until } } }),
  ]);
  return { recorded: stillClosed + reopened, reopened };
}

// ----------------------------------------------------------------------------
// Route bodies (strict)
// ----------------------------------------------------------------------------

import { z } from 'zod';
import { DISPOSITIONS as DISPOSITION_LIST, FLOOR_EXEMPTIONS } from './decision';

export const APPLY_DECISIONS_MAX = 300;
export const REPLAY_ITEMS_MAX = 500;
const replayItem = z
  .object({ ask_id: z.string().uuid(), disposition: z.enum(DISPOSITION_LIST), reason: z.string().max(200).optional().nullable(), floor_exempt: z.enum(FLOOR_EXEMPTIONS).optional().nullable() })
  .strict();
export const applyDecisionsBodySchema = z.object({ dry: z.boolean(), items: z.array(replayItem).min(1).max(APPLY_DECISIONS_MAX) }).strict();
export const decisionReplayBodySchema = z.object({ items: z.array(replayItem).min(1).max(REPLAY_ITEMS_MAX) }).strict();
