/**
 * Slice 7c: effort, unknowns and drain guesses from his own history. Pure. It reads nothing and writes nothing; the
 * learn step stores the answer on his home_item_state rows, for display only. A value a person set always wins (the
 * caller never asks for a guess on a task that has one), and nothing here ever reaches a Task field.
 */

import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { MINUTES } from '../rules';

export const EFFORT = {
  /** A time entry counts only inside this range of minutes (accidental timers and left-running timers fall outside). */
  minEntryMinutes: 3,
  maxEntryMinutes: 480,
  /** A finished task counts only with at least this many counted minutes in all. */
  minTaskMinutes: 5,
  /** ...and a history guess needs at least this many such tasks. */
  minTasks: 3,
  /** The nightly step guesses for at most this many tasks. */
  nightlyCap: 300,
  /** The size of the one-line read the keyword rules look at. */
  textCap: 4000,
} as const;

export type EffortSource = 'history' | 'energy' | 'kind';
export type Unknowns = 'none' | 'some' | 'many';
export type Drain = 'call' | 'high';

/** One finished task's counted minutes, or null when it does not qualify. */
export function countedMinutes(durations: readonly number[]): number | null {
  let total = 0;
  for (const d of durations) {
    if (Number.isFinite(d) && d >= EFFORT.minEntryMinutes && d <= EFFORT.maxEntryMinutes) total += d;
  }
  return total >= EFFORT.minTaskMinutes ? total : null;
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The median of the qualifying finished tasks' totals (nulls are skipped), or null with fewer than minTasks of them. */
export function historyGuess(totals: ReadonlyArray<number | null>): { minutes: number; n: number } | null {
  const ok = totals.filter((t): t is number => t !== null && t > 0);
  if (ok.length < EFFORT.minTasks) return null;
  return { minutes: Math.max(1, Math.round(medianOf(ok))), n: ok.length };
}

export interface MinutesInput {
  /** The total counted minutes of each finished task that shares this task's SOP (null when a task does not qualify). */
  history: ReadonlyArray<number | null>;
  energy_estimate: number | null;
}

export interface MinutesGuess {
  minutes: number;
  source: EffortSource;
  n: number | null;
}

/** History, else the energy estimate, else the kind of work (a task: 30 minutes). */
export function guessMinutes(input: MinutesInput): MinutesGuess {
  const h = historyGuess(input.history);
  if (h) return { minutes: h.minutes, source: 'history', n: h.n };
  const e = calculateEstimatedMinutes(input.energy_estimate, 'none', 'average_drain');
  if (e) return { minutes: e, source: 'energy', n: null };
  return { minutes: MINUTES.taskDefault, source: 'kind', n: null };
}

const MANY_RE = /\b(?:investigat\w*|research\w*|figure out|look(?:ing)? into|debug\w*|diagnos\w*|why|audit\w*|explor\w*)\b/i;
const CALL_RE = /\b(?:calls?|meetings?|walkthroughs?|talk to)\b/i;
const HIGH_RE = /\b(?:pric(?:e|es|ing)|quotes?|invoices?|billing|payments?|budgets?|contracts?)\b/i;

export interface UnknownsInput {
  title: string;
  description: string | null;
  requirements: number;
  sop_id: string | null;
}

const clip = (s: string | null | undefined): string => (s ?? '').slice(0, EFFORT.textCap);

/** many: an investigating word; some: no description, no requirements and no SOP; none: an SOP is set. */
export function guessUnknowns(t: UnknownsInput): Unknowns {
  if (MANY_RE.test(`${clip(t.title)} ${clip(t.description)}`)) return 'many';
  if (t.sop_id) return 'none';
  if (!(t.description ?? '').trim() && t.requirements === 0) return 'some';
  return 'none';
}

/** A call, or a draining kind of work (money and contracts), or null. */
export function guessDrain(t: { title: string; description: string | null }): Drain | null {
  const text = `${clip(t.title)} ${clip(t.description)}`;
  if (CALL_RE.test(text)) return 'call';
  if (HIGH_RE.test(text)) return 'high';
  return null;
}
