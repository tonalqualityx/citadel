/**
 * Slice 7a: working hours and business-day helpers for the weekly measures. Pure.
 * Working hours are Monday to Friday, 09:00 to 17:00 on his wall clock. There is no holiday calendar in this repo.
 */

import { zonedToUtc } from '../act';

export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 17;
const HOUR_MS = 3_600_000;

/** 'YYYY-MM-DD' parts. */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parseYmd(s: string): Ymd {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function ymdString(p: Ymd): string {
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** The day `n` days after (or before, when negative) a 'YYYY-MM-DD'. */
export function addDaysYmd(ymd: string, n: number): string {
  const p = parseYmd(ymd);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return ymdString({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** 0 Sunday to 6 Saturday. */
export function weekdayOfYmd(ymd: string): number {
  const p = parseYmd(ymd);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

export function isWeekdayYmd(ymd: string): boolean {
  const w = weekdayOfYmd(ymd);
  return w >= 1 && w <= 5;
}

/** 'YYYY-MM-DD' of the instant on the wall clock of the zone. */
export function ymdInZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days from `a` to `b` (both 'YYYY-MM-DD'). */
export function daysBetweenYmd(a: string, b: string): number {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Monday to Friday days from `from` to `to`, both included. 0 when `to` is before `from`. */
export function weekdaysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const span = daysBetweenYmd(from, to);
  for (let i = 0; i <= span && i < 400; i++) {
    const day = addDaysYmd(from, i);
    if (isWeekdayYmd(day)) out.push(day);
  }
  return out;
}

/** The Monday to Sunday week before the one `today` falls in. */
export function previousWeek(today: string): { start: string; end: string } {
  const w = weekdayOfYmd(today);
  const sinceMonday = (w + 6) % 7;
  const thisMonday = addDaysYmd(today, -sinceMonday);
  return { start: addDaysYmd(thisMonday, -7), end: addDaysYmd(thisMonday, -1) };
}

/**
 * Hours of working time between two instants: Monday to Friday 09:00 to 17:00 in the zone.
 * Friday 16:00 to Monday 10:00 is 2. Zero when `to` is not after `from`.
 */
export function workingHoursBetween(from: Date, to: Date, timeZone: string): number {
  if (to.getTime() <= from.getTime()) return 0;
  const first = ymdInZone(from, timeZone);
  const last = ymdInZone(to, timeZone);
  let ms = 0;
  const span = daysBetweenYmd(first, last);
  for (let i = 0; i <= span && i < 400; i++) {
    const day = addDaysYmd(first, i);
    if (!isWeekdayYmd(day)) continue;
    const p = parseYmd(day);
    const open = zonedToUtc(p.y, p.m, p.d, WORK_START_HOUR, 0, timeZone).getTime();
    const close = zonedToUtc(p.y, p.m, p.d, WORK_END_HOUR, 0, timeZone).getTime();
    const lo = Math.max(open, from.getTime());
    const hi = Math.min(close, to.getTime());
    if (hi > lo) ms += hi - lo;
  }
  return ms / HOUR_MS;
}
