/**
 * Slice 7a: the section 7 measures and the approval-speed guard. Pure: it takes rows the store read and returns numbers
 * and plain details. It writes nothing and changes no ranking.
 *
 * A measure is `ok` (it may produce a sentence) only when its week holds at least LEARN.minBusinessDays business days
 * of data. Logs count from the day of his first home action; snapshots count the weekday snapshots in the week.
 */

import { LEARN, cleanLabel, hoursText, timeErrorSentence } from './copy';
import { isWeekdayYmd, weekdaysInRange, workingHoursBetween } from './working-hours';

// ============================================================================
// Inputs (all Date values are real instants)
// ============================================================================

export type EmergencyKind = 'task' | 'mail' | 'site' | 'wait';

/** One emergency that started in the week, or was still waiting for his first action at the end of it. */
export interface EmergencyEvent {
  key: string;
  kind: EmergencyKind;
  label: string;
  started_at: Date;
  /** His earliest action on it, or null. */
  first_action_at: Date | null;
  /** The thing cleared by itself before he acted (a site back up). */
  cleared_on_own: boolean;
}

/** A thread that waited for a reply, as the nightly snapshot saw it. */
export interface OwedEntry {
  key: string;
  label: string;
  /** Whole business days since the newest ask. */
  age_bd: number;
}

/** One night's snapshot (the `daily` home_measures value). */
export interface DailySnapshot {
  date: string;
  open_items: number;
  past_day: number;
  owed: OwedEntry[];
}

/** A task he changed status or approval on, here or elsewhere. */
export interface TaskChange {
  task_id: string;
  here: boolean;
}

export interface HardDateRow {
  label: string;
  /** Done by its hard date. */
  met: boolean;
}

/** One home_day row. */
export interface TodayDay {
  date: string;
  kept: boolean;
  proposed: number;
  done: number;
}

export interface WeekInput {
  week_start: string;
  week_end: string;
  tz: string;
  now: Date;
  emergencies: EmergencyEvent[];
  /** Daily snapshots dated inside the week. */
  snapshots: DailySnapshot[];
  /** The last weekday snapshot of the week before, or null. */
  prev_snapshot: DailySnapshot | null;
  task_changes: TaskChange[];
  /** 'YYYY-MM-DD' of his first home action ever, or null when there is none. */
  first_action_day: string | null;
  hard_dates: HardDateRow[];
  today_days: TodayDay[];
  /** Slice 7c: finished tasks that carried a time guess, with their counted minutes. Omitted when not read. */
  guess_errors?: GuessError[];
}

/** One finished task that had a time guess: the guess and the minutes its time entries counted (7c rules). */
export interface GuessError {
  guessed: number;
  actual: number;
}

/** Fewest finished, guessed tasks with time entries before the Show line appears. */
export const GUESS_ERROR_MIN_TASKS = 5;

/** The average miss in minutes over the finished tasks, or null with fewer than GUESS_ERROR_MIN_TASKS of them. */
export function minutesError(rows: readonly GuessError[]): { minutes: number; n: number } | null {
  if (rows.length < GUESS_ERROR_MIN_TASKS) return null;
  const total = rows.reduce((sum, r) => sum + Math.abs(r.guessed - r.actual), 0);
  return { minutes: Math.round(total / rows.length), n: rows.length };
}

// ============================================================================
// Outputs (JSON safe: they are stored in home_measures)
// ============================================================================

export interface Measure<T> {
  /** Enough data for a sentence. */
  ok: boolean;
  /** Business days of data behind it. */
  business_days: number;
  value: T;
  details: string[];
}

export interface WeekMeasures {
  week_start: string;
  week_end: string;
  emergencies: Measure<{ total: number; seen_in_time: number; not_seen_in_time: number; cleared_on_own: number }>;
  owed: Measure<{ count: number }>;
  where: Measure<{ total: number; here: number }>;
  plate: Measure<{ open: number; past_day: number; change: number | null; hard_met: number; hard_missed: number }>;
  today: Measure<{ days: number; days_kept: number; share_done: number | null }>;
  /** Slice 7c, only when the guess errors were read. Details only. */
  time_guess?: Measure<{ minutes: number; tasks: number } | null>;
}

const DETAIL_CAP = 40;

const capped = (lines: string[]): string[] =>
  lines.length <= DETAIL_CAP ? lines : [...lines.slice(0, DETAIL_CAP), `and ${lines.length - DETAIL_CAP} more`];

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Weekdays of the week from his first home action on, so a week he only joined midway counts only what exists. */
function logBusinessDays(input: WeekInput): number {
  if (!input.first_action_day) return 0;
  const from = input.first_action_day > input.week_start ? input.first_action_day : input.week_start;
  return weekdaysInRange(from, input.week_end).length;
}

function snapshotBusinessDays(input: WeekInput): number {
  return new Set(input.snapshots.filter((s) => isWeekdayYmd(s.date) && s.date >= input.week_start && s.date <= input.week_end).map((s) => s.date)).size;
}

function lastSnapshot(input: WeekInput): DailySnapshot | null {
  const inWeek = input.snapshots.filter((s) => isWeekdayYmd(s.date) && s.date >= input.week_start && s.date <= input.week_end);
  return inWeek.length ? inWeek.reduce((a, b) => (a.date >= b.date ? a : b)) : null;
}

export function measuresWeek(input: WeekInput): WeekMeasures {
  const logDays = logBusinessDays(input);
  const snapDays = snapshotBusinessDays(input);
  const enough = (days: number) => days >= LEARN.minBusinessDays;

  // 1. Emergencies seen in time. One that cleared on its own before he acted is listed, not counted.
  const counted = input.emergencies.filter((e) => !e.cleared_on_own);
  const cleared = input.emergencies.filter((e) => e.cleared_on_own);
  const hoursOf = (e: EmergencyEvent): number | null => (e.first_action_at ? workingHoursBetween(e.started_at, e.first_action_at, input.tz) : null);
  const inTime = counted.filter((e) => {
    const h = hoursOf(e);
    return h !== null && h <= LEARN.emergencyHours;
  });
  const emergencyDetails = [
    ...counted.map((e) => {
      const h = hoursOf(e);
      return h === null ? `${cleanLabel(e.label)}: not seen yet` : `${cleanLabel(e.label)}: first action after ${hoursText(h)} working ${h === 1 ? 'hour' : 'hours'}`;
    }),
    ...cleared.map((e) => `${cleanLabel(e.label)}: cleared on its own`),
  ];

  // 2. Owed replies, from the newest snapshot of the week that has any, counted on any night: the most any night saw.
  const owedByKey = new Map<string, OwedEntry>();
  for (const s of input.snapshots) {
    for (const o of s.owed) {
      if (o.age_bd <= LEARN.owedDays) continue;
      const prior = owedByKey.get(o.key);
      if (!prior || o.age_bd > prior.age_bd) owedByKey.set(o.key, o);
    }
  }
  const owed = [...owedByKey.values()].sort((a, b) => b.age_bd - a.age_bd || a.key.localeCompare(b.key));

  // 3. Where he acts.
  const total = new Set(input.task_changes.map((c) => c.task_id)).size;
  const here = new Set(input.task_changes.filter((c) => c.here).map((c) => c.task_id)).size;

  // 4. The plate.
  const last = lastSnapshot(input);
  const open = last?.open_items ?? 0;
  const change = last && input.prev_snapshot ? last.open_items - input.prev_snapshot.open_items : null;
  const hardMet = input.hard_dates.filter((h) => h.met);
  const hardMissed = input.hard_dates.filter((h) => !h.met);
  const plateDetails: string[] = [];
  if (change !== null) {
    plateDetails.push(
      change === 0 ? 'The plate is the same size as the week before.' : `${plural(Math.abs(change), 'item', 'items')} ${change > 0 ? 'more' : 'fewer'} on the plate than the week before.`,
    );
  }
  plateDetails.push(`Hard dates met: ${hardMet.length}. Hard dates missed: ${hardMissed.length}.`);
  for (const h of hardMissed) plateDetails.push(`Missed: ${cleanLabel(h.label)}`);

  // Today measures (details only).
  const days = input.today_days.filter((d) => isWeekdayYmd(d.date));
  const kept = days.filter((d) => d.kept).length;
  const proposed = days.reduce((n, d) => n + d.proposed, 0);
  const done = days.reduce((n, d) => n + d.done, 0);
  const share = proposed > 0 ? Math.round((done / proposed) * 100) : null;
  const todayDetails = days.length
    ? [
        `Kept the proposed day on ${kept} of ${days.length} days.`,
        ...(share === null ? [] : [`${share} percent of the proposed steps were done by the end of their day.`]),
      ]
    : [];

  const miss = input.guess_errors ? minutesError(input.guess_errors) : null;

  return {
    week_start: input.week_start,
    week_end: input.week_end,
    ...(input.guess_errors
      ? {
          time_guess: {
            ok: miss !== null,
            business_days: 0,
            value: miss ? { minutes: miss.minutes, tasks: miss.n } : null,
            details: miss ? [timeErrorSentence(miss.minutes, miss.n)] : [],
          },
        }
      : {}),
    emergencies: {
      ok: enough(logDays),
      business_days: logDays,
      value: { total: counted.length, seen_in_time: inTime.length, not_seen_in_time: counted.length - inTime.length, cleared_on_own: cleared.length },
      details: capped(emergencyDetails),
    },
    owed: {
      ok: enough(snapDays),
      business_days: snapDays,
      value: { count: owed.length },
      details: capped(owed.map((o) => `${cleanLabel(o.label)}: waited ${plural(o.age_bd, 'business day', 'business days')}`)),
    },
    where: {
      // Nothing changed means nothing to say: the sentence needs at least one change.
      ok: enough(logDays) && total > 0,
      business_days: logDays,
      value: { total, here },
      details: [],
    },
    plate: {
      ok: enough(snapDays) && !!last,
      business_days: snapDays,
      value: { open, past_day: last?.past_day ?? 0, change, hard_met: hardMet.length, hard_missed: hardMissed.length },
      details: capped(plateDetails),
    },
    today: {
      ok: enough(days.length) && todayDetails.length > 0,
      business_days: days.length,
      value: { days: days.length, days_kept: kept, share_done: share },
      details: todayDetails,
    },
  };
}

// ============================================================================
// The approval-speed guard
// ============================================================================

/** His first home action in the week on a sign-off or a wait approval. */
export interface GuardRow {
  item_key: string;
  /** The recorded button: approve_all, approve_wait, complete_wait, open_*, let_it_go, or not_now. */
  did: string;
  /** Milliseconds since his previous home action the same day, or null when it was his first that day. */
  gap_ms: number | null;
}

export const APPROVAL_DID: readonly string[] = ['approve_all', 'approve_wait', 'complete_wait'];

export interface GuardResult {
  rows: number;
  approvals: number;
  median_gap_ms: number;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Fires at LEARN.guardRows or more rows, more than LEARN.guardShare of them approvals, and a median gap under
 * LEARN.guardGapMs. Null otherwise. It only informs; nothing becomes automatic.
 */
export function guard(rows: GuardRow[]): GuardResult | null {
  if (rows.length < LEARN.guardRows) return null;
  const approvals = rows.filter((r) => APPROVAL_DID.includes(r.did)).length;
  if (approvals / rows.length <= LEARN.guardShare) return null;
  const gaps = rows.map((r) => r.gap_ms).filter((g): g is number => g !== null);
  const med = median(gaps);
  if (med === null || med >= LEARN.guardGapMs) return null;
  return { rows: rows.length, approvals, median_gap_ms: med };
}
