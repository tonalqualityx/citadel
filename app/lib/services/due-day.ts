/**
 * What calendar day a task's due_date means.
 *
 * The task form, the arc board and the peek drawer store the day someone PICKED as midnight UTC (a date input turned into an ISO string), so
 * that value is a calendar day, not an instant: 2026-11-20T00:00:00Z means "the 20th" for everyone, and converting it into a time zone
 * (New York would read it as 7pm on the 19th) moves it a day early. A few writers store a real time of day instead (the kickoff task is due
 * "N business days from now", with the clock time of its creation; the generators and imports can carry one too). Those are real moments, so
 * the day they fall on is the day in the reader's zone.
 *
 * Rule: a value at exactly 00:00:00.000 UTC is a calendar day; any other value is an instant read in the zone given. The result is YYYY-MM-DD.
 */
import { getZonedDateString } from '@/lib/utils/time';

const DAY_MS = 24 * 3600 * 1000;

export function isCalendarDay(due: Date): boolean {
  return due.getTime() % DAY_MS === 0;
}

/** The calendar day the due date means, YYYY-MM-DD. */
export function dueDay(due: Date, zone: string): string {
  return isCalendarDay(due) ? due.toISOString().slice(0, 10) : getZonedDateString(due, zone);
}

/** Add whole days to a YYYY-MM-DD, YYYY-MM-DD out (calendar arithmetic, no zone). */
export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (YYYY-MM-DD each); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
