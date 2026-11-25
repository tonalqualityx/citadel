/**
 * Quarter priorities ("rocks"): pure helpers. All dates are UTC.
 * A rock's status is derived, never stored.
 */

import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

export const ROCK_CAP = 7;
export const WAITING_ON_MIKE_DAYS = 7;
export const QUARTER_PATTERN = /^\d{4}-Q[1-4]$/;

export type RockStatus = 'done' | 'off_track' | 'on_track';

export function isValidQuarter(q: unknown): q is string {
  return typeof q === 'string' && QUARTER_PATTERN.test(q);
}

function parseQuarter(q: string): { year: number; quarter: number } {
  if (!isValidQuarter(q)) {
    throw new Error(`Invalid quarter: ${q}`);
  }
  return { year: Number(q.slice(0, 4)), quarter: Number(q.slice(6)) };
}

/** Last day of the quarter as a UTC date at 00:00 (2027-Q1 -> 2027-03-31). */
export function lastDayOfQuarter(q: string): Date {
  const { year, quarter } = parseQuarter(q);
  // Day 0 of the month after the quarter's last month is that month's last day.
  return new Date(Date.UTC(year, quarter * 3, 0));
}

export function currentQuarter(now: Date = new Date()): string {
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  return `${now.getUTCFullYear()}-Q${quarter}`;
}

/** The current quarter plus the next `count` quarters, in order. */
export function upcomingQuarters(count: number, now: Date = new Date()): string[] {
  const { year, quarter } = parseQuarter(currentQuarter(now));
  const result: string[] = [];
  for (let i = 0; i <= count; i++) {
    const index = quarter - 1 + i;
    result.push(`${year + Math.floor(index / 4)}-Q${(index % 4) + 1}`);
  }
  return result;
}

export interface RockProject {
  next_step_text?: string | null;
  next_step_owner_id?: string | null;
  next_step_at?: Date | string | null;
}

interface RockMilestone {
  rock_quarter?: string | null;
  completed_at?: Date | string | null;
  target_date?: Date | string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 12" from a date, read in UTC. */
export function formatMonthDayUtc(date: Date | string): string {
  const d = new Date(date);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Mar 31, 2027" from a calendar date stored as UTC midnight. */
export function formatCalendarDateUtc(date: Date | string): string {
  const d = new Date(date);
  return `${formatMonthDayUtc(d)}, ${d.getUTCFullYear()}`;
}

/** True when the project's next step has waited on Mike for more than 7 days. */
function nextStepWaitedOnMike(project: RockProject | null | undefined, now: Date): boolean {
  if (!project?.next_step_at || project.next_step_owner_id !== MIKE_USER_ID) return false;
  const waitedMs = now.getTime() - new Date(project.next_step_at).getTime();
  return waitedMs > WAITING_ON_MIKE_DAYS * 24 * 60 * 60 * 1000;
}

export function rockStatus(
  milestone: RockMilestone,
  now: Date = new Date(),
  project?: RockProject | null
): RockStatus | null {
  if (!milestone.rock_quarter) return null;
  if (milestone.completed_at) return 'done';
  if (nextStepWaitedOnMike(project, now)) return 'off_track';
  if (milestone.target_date) {
    const target = new Date(milestone.target_date);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
    if (targetUtc < todayUtc) return 'off_track';
  }
  return 'on_track';
}

/** "Waiting on you since Nov 12: approve the ADA audit outline", or null when it does not apply. */
export function rockDecisionLine(
  milestone: RockMilestone,
  now: Date = new Date(),
  project?: RockProject | null
): string | null {
  if (!milestone.rock_quarter || milestone.completed_at) return null;
  if (!project?.next_step_text || !project.next_step_at) return null;
  if (!nextStepWaitedOnMike(project, now)) return null;
  return `Waiting on you since ${formatMonthDayUtc(project.next_step_at)}: ${project.next_step_text}`;
}
