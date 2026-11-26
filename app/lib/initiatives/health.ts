/**
 * Initiative health, computed (design.md 2.2, rules 0 to 4) and the caps.
 *
 * Pure: no database, no clock of its own. The API routes load the numbers and the latest check-in, call
 * computeInitiativeHealth, and store the result on the initiative.
 */

export const MAX_ACTIVE = 5;
export const MAX_NUMBERS = 3;

export const NUMBER_UNITS = ['count', 'percent', 'dollars', 'hours'] as const;
export const NUMBER_DIRECTIONS = ['up', 'down'] as const;

export type InitiativeHealthValue = 'on_track' | 'behind' | 'unchecked';

type Numberish = number | string | { toString(): string } | null | undefined;

export interface HealthNumber {
  label: string;
  direction: 'up' | 'down' | string;
  baseline_value: Numberish;
  baseline_at: Date | null | undefined;
  target_value: Numberish;
  target_by: Date;
  last_value: Numberish;
  last_read_at: Date | null | undefined;
  source?: string | null;
}

export interface HealthCheckIn {
  health: InitiativeHealthValue;
  note?: string | null;
  created_at: Date;
}

export interface HealthInput {
  check_date: Date | null | undefined;
  numbers: HealthNumber[];
  latest_check_in: HealthCheckIn | null | undefined;
  now: Date;
}

export interface HealthResult {
  health: InitiativeHealthValue;
  health_reason: string;
}

export type NumberPace = 'no_pace' | 'met' | 'on_pace' | 'behind';

const REASON_MAX = 200;

function num(v: Numberish): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clip(s: string): string {
  return s.length <= REASON_MAX ? s : `${s.slice(0, REASON_MAX - 1)}…`;
}

/** The value a number should have reached by `now` if it moves in a straight line from baseline to target_by. */
export function expectedValue(n: HealthNumber, now: Date): number | null {
  const base = num(n.baseline_value);
  const target = num(n.target_value);
  if (base === null || target === null || !n.baseline_at) return null;
  const start = n.baseline_at.getTime();
  const end = n.target_by.getTime();
  const span = end - start;
  const fraction = span <= 0 ? 1 : Math.min(1, Math.max(0, (now.getTime() - start) / span));
  return base + (target - base) * fraction;
}

/** Rule 0 and 1: where one number stands. A number with no reading after its baseline has no pace yet. */
export function numberPace(n: HealthNumber, now: Date): { pace: NumberPace; expected: number | null } {
  const last = num(n.last_value);
  const target = num(n.target_value);
  if (last === null || target === null || !n.last_read_at || !n.baseline_at || n.last_read_at.getTime() <= n.baseline_at.getTime()) {
    return { pace: 'no_pace', expected: null };
  }
  const up = n.direction !== 'down';
  if (up ? last >= target : last <= target) return { pace: 'met', expected: target };
  const expected = expectedValue(n, now);
  if (expected === null) return { pace: 'no_pace', expected: null };
  const onPace = up ? last >= expected : last <= expected;
  return { pace: onPace ? 'on_pace' : 'behind', expected };
}

/** Said in the health line while a quotes-sent number reads zero, so nobody reads the zero as no quotes (Dox, task a1cb8a07). */
export const PROPOSALS_ZERO_NOTE = 'Only quotes with a project on this initiative count.';

function readsZeroQuotes(n: HealthNumber): boolean {
  return n.source === 'citadel:proposals_sent' && !!n.last_read_at && num(n.last_value) === 0;
}

export function computeInitiativeHealth(input: HealthInput): HealthResult {
  const result = baseHealth(input);
  if (!input.numbers.some(readsZeroQuotes)) return result;
  const room = REASON_MAX - PROPOSALS_ZERO_NOTE.length - 2;
  const base = result.health_reason.trim();
  const cut = (base.length > room ? base.slice(0, room) : base).trimEnd().replace(/[.:,;…]+$/, '');
  return { ...result, health_reason: cut ? `${cut}. ${PROPOSALS_ZERO_NOTE}` : PROPOSALS_ZERO_NOTE };
}

function baseHealth(input: HealthInput): HealthResult {
  const { numbers, latest_check_in: checkIn, now } = input;
  const checkDate = input.check_date ?? null;

  const newestReading = numbers.reduce<number>(
    (max, n) => (n.last_read_at ? Math.max(max, n.last_read_at.getTime()) : max),
    0,
  );
  const checkDatePassed = checkDate !== null && checkDate.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // Rule 2: a check-in newer than the newest reading wins until the next check date.
  if (checkIn && checkIn.created_at.getTime() > newestReading && !checkDatePassed) {
    const note = checkIn.note?.trim();
    return {
      health: checkIn.health,
      health_reason: clip(note ? `Mike's check-in: ${note}` : `Mike's check-in on ${fmtDay(checkIn.created_at)}`),
    };
  }

  const paces = numbers.map((n) => ({ n, ...numberPace(n, now) }));
  const measured = paces.filter((p) => p.pace !== 'no_pace');

  // Rule 3, no pace anywhere: a fresh initiative is neutral, not a fault.
  if (measured.length === 0) {
    const first = numbers.length > 0 && checkDate ? `First reading due ${fmtDay(checkDate)}` : 'Not checked yet: no reading after the baseline';
    return { health: 'unchecked', health_reason: clip(first) };
  }

  // Rule 3, the check date passed with no reading or check-in since.
  if (checkDatePassed && checkDate) {
    const lastActivity = Math.max(newestReading, checkIn ? checkIn.created_at.getTime() : 0);
    if (lastActivity < checkDate.getTime()) {
      return { health: 'unchecked', health_reason: clip(`Not checked since the ${fmtDay(checkDate)} check date`) };
    }
  }

  const behind = paces.find((p) => p.pace === 'behind');
  if (behind) {
    return {
      health: 'behind',
      health_reason: clip(`${behind.n.label} is behind pace: ${fmt(num(behind.n.last_value) ?? 0)} of ${fmt(behind.expected ?? 0)} expected by now`),
    };
  }

  // Rule 4: name the number that decided it.
  const decider = measured.find((p) => p.pace === 'on_pace') ?? measured[0];
  return {
    health: 'on_track',
    health_reason: clip(
      decider.pace === 'met'
        ? `${decider.n.label} reached its target of ${fmt(num(decider.n.target_value) ?? 0)}`
        : `${decider.n.label} is on pace: ${fmt(num(decider.n.last_value) ?? 0)} against ${fmt(decider.expected ?? 0)} expected by now`,
    ),
  };
}
