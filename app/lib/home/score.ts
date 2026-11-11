/**
 * Home screen Slice 1: importance, consequence class and urgency (plan section 1.3, task H4).
 *
 * Server side only in spirit: nothing in this file, and nothing derived from it, is ever sent
 * to the browser or shown. select.ts and today.ts read the Score and turn it into order and
 * into one-line reasons. Every number comes from the named constants in ./rules.ts.
 *
 * Time: business days use lib/waits/business-days.ts primitives through rules.ts (America/New_York,
 * Monday to Friday). Hard dates are counted on New York calendar dates; a task's date-only due
 * date (stored at exactly midnight UTC) counts as that calendar date, not the evening before.
 */

import { zonedParts } from '@/lib/waits/business-days';
import {
  CONSEQUENCE,
  DATE_READ,
  FRESH_ACTIVITY_HOURS,
  IMPORTANCE,
  URGENCY,
  businessDaysElapsed,
  businessDaysUntil,
  hardDateOf,
  hasMoneyOrLifelineTag,
  isVenture,
} from './rules';
import type { RawEmailAsk, RawReviewFold, RawSessionAsk, RawTask, RawThread, RawWait } from './types';

/** Which rule gave a task its hard date (Slice 2 precedence: hard_due, then promised, then read). */
export type HardDateKind = 'hard_due' | 'promised' | 'read';

/** The keeper's reading of a task's due_date, from its item state (RawItemState.read_hard_due_*). */
export interface ReadHardDate {
  at: Date | null;
  source: string | null;
}

/** 1 is the most consequential band, 4 the least. Internal only. */
export type ConsequenceClass = 1 | 2 | 3 | 4;

export interface Score {
  /** 0 to 100. */
  importance: number;
  /** 0 to 100. */
  urgency: number;
  klass: ConsequenceClass;
  /** The three importance parts, after their caps. */
  clientTrust: number;
  money: number;
  unblocks: number;
  /** The hard date (Task.hard_due_at, else rules.ts hardDateOf, else the keeper's reading; date-only values normalized), or null. */
  hardDate: Date | null;
  /** Where the hard date came from: Task.hard_due_at, the Slice 1 rule (promise or lifeline tag), or the keeper's reading. Null when no hard date. */
  hardKind: HardDateKind | null;
  /** The source text that goes in the chip for hard_due and read dates; null for promised dates (the chip names promised_to). */
  hardSource: string | null;
  /** When the person-waiting clock started, or null when nobody is waiting. */
  waitingSince: Date | null;
  /** Client or project names one of the other ventures. */
  venture: boolean;
}

// ============================================================================
// Date helpers
// ============================================================================

const DATE_ONLY_NOON_UTC_HOUR = 16;

/** True when the instant is exactly 00:00:00.000 UTC: a date-only value stored as a timestamp. */
export function isDateOnlyValue(d: Date): boolean {
  return (
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  );
}

/**
 * The civil date a due date stands for. A date-only value (exactly midnight UTC) is that UTC
 * calendar day. Any other instant is converted to its New York calendar day.
 */
export function dueCivil(d: Date): { y: number; m: number; d: number } {
  if (isDateOnlyValue(d)) return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  const p = zonedParts(d);
  return { y: p.year, m: p.month, d: p.day };
}

/**
 * An instant that falls on the same New York calendar day as dueCivil(d), so the business-day
 * helpers in rules.ts (which convert to New York) read the right day. A date-only value moves
 * to 16:00 UTC of its day (11:00 or 12:00 in New York); any other instant is returned as is.
 */
export function normalizeDueDate(d: Date): Date {
  if (!isDateOnlyValue(d)) return d;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DATE_ONLY_NOON_UTC_HOUR, 0, 0));
}

function civilNum(c: { y: number; m: number; d: number }): number {
  return Date.UTC(c.y, c.m - 1, c.d) / 86_400_000;
}

/** Calendar days from today (New York) to the due date's civil day. Negative when it has passed. */
export function calendarDaysUntilDue(due: Date, now: Date): number {
  const n = zonedParts(now);
  return civilNum(dueCivil(due)) - civilNum({ y: n.year, m: n.month, d: n.day });
}

export interface TaskHardDate {
  date: Date;
  kind: HardDateKind;
  /** Source text for the chip (hard_due and read), else null. */
  source: string | null;
}

type HardDateTaskFields = Pick<RawTask, 'due_date' | 'promised_to' | 'tags'> &
  Partial<Pick<RawTask, 'hard_due_at' | 'hard_due_source'>>;

/**
 * The task's hard date and where it came from, date-only values normalized. Precedence:
 * Task.hard_due_at (with its source), then the Slice 1 rule (promised_to or a lifeline or
 * job-watch tag on due_date), then the keeper's reading of an existing due_date.
 */
export function hardDateInfo(task: HardDateTaskFields, read?: ReadHardDate | null): TaskHardDate | null {
  if (task.hard_due_at) {
    return { date: normalizeDueDate(task.hard_due_at), kind: 'hard_due', source: task.hard_due_source ?? null };
  }
  const hard = hardDateOf({ due_date: task.due_date, promised_to: task.promised_to, tags: task.tags });
  if (hard) return { date: normalizeDueDate(hard), kind: 'promised', source: null };
  if (read?.at) {
    return { date: normalizeDueDate(read.at), kind: 'read', source: read.source?.trim() || DATE_READ.unclearSource };
  }
  return null;
}

/** The task's hard date with a date-only value normalized, or null when it has none. */
export function hardDateOfTask(task: HardDateTaskFields, read?: ReadHardDate | null): Date | null {
  return hardDateInfo(task, read)?.date ?? null;
}

// ============================================================================
// Core
// ============================================================================

interface ScoreParts {
  clientTrust: number;
  money: number;
  unblocks: number;
  hardDate: Date | null;
  hardKind?: HardDateKind | null;
  hardSource?: string | null;
  /** Person-waiting clock start; null when nobody waits. */
  waitingSince: Date | null;
  /** A message newer than FRESH_ACTIVITY_HOURS adds the fresh bonus. */
  freshAt: Date | null;
  venture: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hardDateUrgency(hardDate: Date, now: Date): number {
  const days = businessDaysUntil(hardDate, now);
  if (days < 0) return URGENCY.hardDate.past;
  const step = URGENCY.hardDate.steps.find((s) => days <= s.maxBusinessDays);
  return step ? step.urgency : URGENCY.hardDate.beyond;
}

function waitingUrgency(since: Date, now: Date): number {
  const elapsed = businessDaysElapsed(since, now);
  const step = URGENCY.waiting.find((s) => elapsed >= s.minBusinessDays);
  return step ? step.urgency : URGENCY.other;
}

function finish(p: ScoreParts, now: Date): Score {
  const trust = Math.min(IMPORTANCE.clientTrust.cap, p.clientTrust);
  const money = Math.min(IMPORTANCE.money.cap, p.money);
  const unblocks = Math.min(IMPORTANCE.unblocks.cap, p.unblocks);
  let importance = clamp(IMPORTANCE.base + trust + money + unblocks, 0, IMPORTANCE.max);
  if (p.venture) importance = Math.min(importance, IMPORTANCE.ventureCap);

  let klass: ConsequenceClass = 4;
  const hardSoon = p.hardDate !== null && calendarDaysUntilDue(p.hardDate, now) <= CONSEQUENCE.class2HardDateDays;
  if (trust >= CONSEQUENCE.class1MinClientTrust) klass = 1;
  else if (money >= CONSEQUENCE.class2MinMoney || hardSoon) klass = 2;
  else if (unblocks > 0) klass = 3;

  let urgency: number = URGENCY.other;
  if (p.hardDate) urgency = Math.max(urgency, hardDateUrgency(p.hardDate, now));
  if (p.waitingSince) urgency = Math.max(urgency, waitingUrgency(p.waitingSince, now));
  if (p.freshAt && now.getTime() - p.freshAt.getTime() <= FRESH_ACTIVITY_HOURS * 3_600_000 && p.freshAt <= now) {
    urgency += URGENCY.freshBonus;
  }
  urgency = clamp(urgency, 0, URGENCY.max);

  return {
    importance,
    urgency,
    klass,
    clientTrust: trust,
    money,
    unblocks,
    hardDate: p.hardDate,
    hardKind: p.hardDate ? (p.hardKind ?? null) : null,
    hardSource: p.hardDate ? (p.hardSource ?? null) : null,
    waitingSince: p.waitingSince,
    venture: p.venture,
  };
}

// ============================================================================
// Per source
// ============================================================================

/** A task is "waiting on" a person when it carries a promise or a requesting contact. */
export function taskHasPersonWaiting(task: Pick<RawTask, 'promised_to' | 'requested_by_contact_id'>): boolean {
  return (!!task.promised_to && task.promised_to.trim() !== '') || !!task.requested_by_contact_id;
}

export function scoreTask(task: RawTask, now: Date, read?: ReadHardDate | null): Score {
  const promised = !!task.promised_to && task.promised_to.trim() !== '';
  const trust =
    (task.client?.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0) +
    (promised ? IMPORTANCE.clientTrust.promise : 0) +
    (task.requested_by_contact_id || task.client_visible || task.has_open_email_ask ? IMPORTANCE.clientTrust.contact : 0);
  const money =
    (hasMoneyOrLifelineTag(task.tags) ? IMPORTANCE.money.tags : 0) +
    (task.charter_id || task.accord_id || (task.billing_amount ?? 0) > 0 ? IMPORTANCE.money.link : 0) +
    (task.site_id ? IMPORTANCE.money.site : 0);
  const unblocks = Math.min(
    IMPORTANCE.unblocks.blockedTaskCap,
    task.open_blocking_count * IMPORTANCE.unblocks.perBlockedTask,
  );
  const hard = hardDateInfo(task, read);
  return finish(
    {
      clientTrust: trust,
      money,
      unblocks,
      hardDate: hard?.date ?? null,
      hardKind: hard?.kind ?? null,
      hardSource: hard?.source ?? null,
      waitingSince: taskHasPersonWaiting(task) ? task.clock_started_at : null,
      freshAt: null,
      venture: isVenture({ client_name: task.client?.name, project_name: task.project?.name }),
    },
    now,
  );
}

export function reviewUnblocks(pieceCount: number): number {
  return IMPORTANCE.unblocks.reviewBase + Math.floor(pieceCount / IMPORTANCE.unblocks.reviewPiecesPerPoint);
}

export function scoreReview(fold: RawReviewFold, now: Date): Score {
  return finish(
    {
      clientTrust: fold.client?.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0,
      money: 0,
      unblocks: reviewUnblocks(fold.pieces.length),
      hardDate: null,
      waitingSince: fold.waiting_since,
      freshAt: null,
      venture: isVenture({ client_name: fold.client?.name, project_name: fold.project?.name }),
    },
    now,
  );
}

export function scoreSession(s: RawSessionAsk, now: Date): Score {
  const blocking = s.ask_severity === 'client_blocking' || s.ask_severity === 'launch_blocking';
  return finish(
    {
      clientTrust:
        (s.client?.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0) +
        (blocking ? IMPORTANCE.clientTrust.promise : 0),
      money: 0,
      unblocks: IMPORTANCE.unblocks.session,
      hardDate: null,
      waitingSince: s.asked_at,
      freshAt: null,
      venture: isVenture({ client_name: s.client?.name, project_name: s.project?.name }),
    },
    now,
  );
}

/** The wait clock: client_waiting_since, else due_at once it has passed, else none. */
export function waitClockStart(w: Pick<RawWait, 'client_waiting_since' | 'due_at'>, now: Date): Date | null {
  if (w.client_waiting_since) return w.client_waiting_since;
  return w.due_at.getTime() <= now.getTime() ? w.due_at : null;
}

export function scoreWait(w: RawWait, now: Date): Score {
  const personWaiting = !!w.client || w.blocks_client;
  return finish(
    {
      clientTrust:
        (w.client?.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0) +
        (w.blocks_client ? IMPORTANCE.clientTrust.promise : 0),
      money: w.charter_id ? IMPORTANCE.money.link : 0,
      unblocks: 0,
      hardDate: null,
      waitingSince: personWaiting ? waitClockStart(w, now) : null,
      freshAt: null,
      venture: isVenture({ client_name: w.client?.name, project_name: w.project?.name }),
    },
    now,
  );
}

/** The client of a thread: the first ask (newest first) that has one. */
export function threadClient(t: RawThread): RawEmailAsk['client'] {
  for (const a of t.asks) if (a.client) return a.client;
  return null;
}

export function threadProject(t: RawThread): RawEmailAsk['project'] {
  for (const a of t.asks) if (a.project) return a.project;
  return null;
}

export function scoreThread(t: RawThread, now: Date): Score {
  const client = threadClient(t);
  const project = threadProject(t);
  const newest = t.asks[0];
  return finish(
    {
      clientTrust: client?.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0,
      money: 0,
      unblocks: 0,
      hardDate: null,
      waitingSince: newest.received_at,
      freshAt: newest.received_at,
      venture: isVenture({ client_name: client?.name, project_name: project?.name }),
    },
    now,
  );
}

export function scoreCrisis(a: RawEmailAsk, now: Date): Score {
  return finish(
    {
      clientTrust: a.client?.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0,
      money: 0,
      unblocks: 0,
      hardDate: null,
      waitingSince: a.received_at,
      freshAt: null,
      venture: isVenture({ client_name: a.client?.name, project_name: a.project?.name }),
    },
    now,
  );
}

/** Slice 6a: a client site that is down. The clock is when it went down; the client's trust band applies. */
export function scoreSite(site: { client: { status: string } | null; started_at: Date; venture?: boolean }, now: Date): Score {
  return finish(
    {
      clientTrust: site.client?.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0,
      money: 0,
      unblocks: 0,
      hardDate: null,
      waitingSince: site.started_at,
      freshAt: null,
      venture: site.venture === true,
    },
    now,
  );
}

/** Slice 6a: the Monday hands row has no clock and no client of its own. */
export function scoreHands(now: Date): Score {
  return finish({ clientTrust: 0, money: 0, unblocks: 0, hardDate: null, waitingSince: null, freshAt: null, venture: false }, now);
}

/**
 * Slice 8b: a project's next step that is his. Client trust comes from the project's client; the person-waiting clock is the
 * project's last task activity (the step itself is rewritten nightly). No money, no unblocks, no hard date: it enters Next only by
 * the normal class and urgency bands.
 */
export function scoreStep(
  step: { client: { status: string; name?: string | null }; project_name?: string | null; last_activity_at: Date },
  now: Date,
): Score {
  const s = finish(
    {
      clientTrust: step.client.status === 'active' ? IMPORTANCE.clientTrust.activeClient : 0,
      money: 0,
      unblocks: 0,
      hardDate: null,
      waitingSince: step.last_activity_at,
      freshAt: null,
      venture: isVenture({ client_name: step.client.name, project_name: step.project_name }),
    },
    now,
  );
  // A quiet project reads as a long wait; the cap keeps its one step in Next sorting among his class 1 tasks, not always above them.
  return { ...s, urgency: Math.min(STEP_URGENCY_CAP, s.urgency) };
}

/** Slice 8b: the most urgency a project next step can read. */
export const STEP_URGENCY_CAP = 60;
