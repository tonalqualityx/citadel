/**
 * "Do it on a day": the owner says WHEN HE will do an item, and it leaves his view until then (home_item_state.on_day, plus the
 * same view_at / view_set_by / parked_at a Not now writes). Pure: no database in here.
 *
 * It is not a Not now (no park_count step, nothing for the learner) and not a date owed to anyone (no Task field is written).
 * An emergency he decides to do on a day leaves Needs you now and Quick until that day; it returns, it is not dismissed. On the
 * day it returns boosted for that day only, with "You said today."
 */

import { ApiError } from '@/lib/api/errors';
import { screenDateLine, weekdayName, zonedDateString } from './copy';
import { dueCivil } from './score';
import type { HomeChoice, RawItemState } from './types';

export const ON_DAY_MAX_DAYS = 60;
export const ON_DAY_BAD_DAY = 'Pick a day after today.';
export const ON_DAY_TOO_FAR = `Pick a day within ${ON_DAY_MAX_DAYS} days.`;
/** The muted line on the card on its day. */
export const ON_DAY_WHY_NOW = 'You said today.';
/** The footer reason on its day (the screen puts "Why it's here:" in front). */
export const ON_DAY_REASON = 'You said you would do this today.';
export const ON_DAY_CHECK_SUFFIX = 'You picked the day.';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(s: string): { y: number; m: number; d: number } | null {
  const m = DAY_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

function dayNumber(c: { y: number; m: number; d: number }): number {
  return Math.round(Date.UTC(c.y, c.m - 1, c.d) / 86_400_000);
}

/** The chosen day, checked against today (his zone): tomorrow or later, at most 60 days out. Throws a 400. */
export function checkOnDay(date: string, todayString: string): { y: number; m: number; d: number } {
  const c = parseDay(date);
  const today = parseDay(todayString);
  if (!c || !today) throw new ApiError(ON_DAY_BAD_DAY, 400, 'bad_day');
  const ahead = dayNumber(c) - dayNumber(today);
  if (ahead < 1) throw new ApiError(ON_DAY_BAD_DAY, 400, 'bad_day');
  if (ahead > ON_DAY_MAX_DAYS) throw new ApiError(ON_DAY_TOO_FAR, 400, 'bad_day');
  return c;
}

/** The column value: a calendar day stored as UTC midnight. */
export function dayToDate(c: { y: number; m: number; d: number }): Date {
  return new Date(Date.UTC(c.y, c.m - 1, c.d));
}

export function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "Thursday" within the coming week, else "Thursday, November 26". */
export function dayWords(c: { y: number; m: number; d: number }, todayString: string): string {
  const today = parseDay(todayString);
  const ahead = today ? dayNumber(c) - dayNumber(today) : 99;
  const name = weekdayName(c.y, c.m, c.d);
  if (ahead >= 1 && ahead <= 6) return name;
  return screenDateLine(dayToDate(c), 'UTC');
}

/**
 * The server's line for a saved day. When the item has a date (hard, promised or lifeline end) before the chosen day, it says so
 * plainly and the action still applies.
 */
export function onDayMessage(c: { y: number; m: number; d: number }, todayString: string, hardDate: Date | null): string {
  const set = `Set for ${dayWords(c, todayString)}.`;
  if (!hardDate) return set;
  const h = dueCivil(hardDate);
  const gap = dayNumber(c) - dayNumber(h);
  if (gap < 1) return set;
  const hardWords = dayWords(h, todayString);
  const before = gap === 1 ? 'the day before' : `${gap} days before`;
  return `${set} Its date is ${hardWords}, ${before}.`;
}

/** Parked until a day he picked, and that day has not come. A new message from a person (the thread wake) is the caller's rule. */
export function isDayParked(st: Pick<RawItemState, 'on_day' | 'view_at' | 'view_set_by'> | null | undefined, now: Date): boolean {
  return !!st?.on_day && !!st.view_at && st.view_at.getTime() > now.getTime() && (st.view_set_by ?? 'user') === 'user';
}

/** His day has come: it is that calendar day in his zone and the park has ended. Boosted for that day only. */
export function isDayArrived(st: Pick<RawItemState, 'on_day' | 'view_at' | 'view_set_by'> | null | undefined, now: Date, timeZone: string): boolean {
  if (!st?.on_day || !st.view_at || (st.view_set_by ?? 'user') !== 'user') return false;
  if (st.view_at.getTime() > now.getTime()) return false;
  return dayString(st.on_day) === zonedDateString(now, timeZone);
}

/** The drawer check text: "Back Thursday, November 12. You picked the day." */
export function onDayCheckText(day: Date): string {
  return `Back ${screenDateLine(day, 'UTC')}. ${ON_DAY_CHECK_SUFFIX}`;
}

export type DayChoice = HomeChoice & { date: string };

function addDays(c: { y: number; m: number; d: number }, n: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const fmt = (c: { y: number; m: number; d: number }): string => `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;

/** Tomorrow, the next four business days after it by weekday name, and next Monday as "Next week". */
export function dayChoices(now: Date, timeZone: string): DayChoice[] {
  const today = parseDay(zonedDateString(now, timeZone)) as { y: number; m: number; d: number };
  const out: DayChoice[] = [];
  const tomorrow = addDays(today, 1);
  out.push({ label: 'Tomorrow', date: fmt(tomorrow) });
  // Next Monday strictly after today.
  const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
  const toMonday = ((8 - dow) % 7) || 7;
  const monday = fmt(addDays(today, toMonday));
  let n = 1;
  let found = 0;
  while (found < 4 && n < 14) {
    n += 1;
    const c = addDays(today, n);
    const w = new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
    if (w === 0 || w === 6) continue;
    found += 1;
    if (fmt(c) === monday) continue; // the Next week choice stands for it
    out.push({ label: weekdayName(c.y, c.m, c.d), date: fmt(c) });
  }
  out.push({ label: 'Next week', date: monday });
  return out;
}

// ============================================================================
// Snooze: a short park that returns the item to its place
// ============================================================================

export const SNOOZE_MIN_MINUTES = 15;
export const SNOOZE_MAX_HOURS = 24;
export const SNOOZE_TOO_LONG = 'Pick a day instead.';
export const SNOOZE_TOO_SHORT = 'Pick a time at least 15 minutes ahead.';
export const SNOOZE_BACK_WHY = 'Back from a snooze.';
export const SNOOZE_CHECK_SUFFIX = 'Snoozed.';
export const SNOOZE_THIRD_LINE = 'That is the third time today.';
const HOUR = 3_600_000;

/** The instant of h:mi on the wall clock of the zone on a civil day. */
function zonedInstant(c: { y: number; m: number; d: number }, h: number, mi: number, timeZone: string): Date {
  const nominal = Date.UTC(c.y, c.m - 1, c.d, h, mi);
  let guess = nominal;
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') === 24 ? 0 : g('hour'), g('minute'), g('second'));
    guess = nominal - (wall - guess);
  }
  return new Date(guess);
}

/** "2:00" (his zone, 12 hour clock, no am or pm). */
export function clockWords(at: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(at);
  return `${p.find((x) => x.type === 'hour')?.value}:${p.find((x) => x.type === 'minute')?.value}`;
}

/** "2:00" for today, "Thursday 2:00" for another day (his zone). */
export function snoozeWhen(until: Date, now: Date, timeZone: string): string {
  const clock = clockWords(until, timeZone);
  const day = zonedDateString(until, timeZone);
  if (day === zonedDateString(now, timeZone)) return clock;
  const c = parseDay(day) as { y: number; m: number; d: number };
  return `${weekdayName(c.y, c.m, c.d)} ${clock}`;
}

/** The instant a snooze request names, checked: 15 minutes to 24 hours from now. Throws a 400. */
export function snoozeInstant(req: { until?: string; hours?: number }, now: Date): Date {
  const hasUntil = req.until !== undefined;
  const hasHours = req.hours !== undefined;
  if (hasUntil === hasHours) throw new ApiError('Send either until or hours.', 400, 'bad_snooze');
  const until = hasHours ? new Date(now.getTime() + (req.hours as number) * HOUR) : new Date(req.until as string);
  if (Number.isNaN(until.getTime())) throw new ApiError(SNOOZE_TOO_SHORT, 400, 'bad_snooze');
  // A whole hour request is exact; allow a second of slack on a named instant so a choice made a moment ago still lands.
  const ahead = until.getTime() - now.getTime();
  if (ahead > SNOOZE_MAX_HOURS * HOUR) throw new ApiError(SNOOZE_TOO_LONG, 400, 'bad_snooze');
  if (ahead < SNOOZE_MIN_MINUTES * 60_000) throw new ApiError(SNOOZE_TOO_SHORT, 400, 'bad_snooze');
  return until;
}

/** The count of snoozes of this item on today's day (his zone), counting this one. */
export function snoozeCountToday(st: Pick<RawItemState, 'snooze_count' | 'snooze_day'> | null | undefined, now: Date, timeZone: string): number {
  const today = zonedDateString(now, timeZone);
  const same = !!st?.snooze_day && dayString(st.snooze_day) === today;
  return (same ? (st?.snooze_count ?? 0) : 0) + 1;
}

function ordinal(n: number): string {
  return n === 3 ? 'third' : n === 4 ? 'fourth' : n === 5 ? 'fifth' : `${n}th`;
}

/** "Snoozed until 2:00." plus the date sentence and the count sentence. `hardDate` is the item's hard, promised or lifeline end date. */
export function snoozeMessage(until: Date, now: Date, timeZone: string, hardDate: Date | null, countToday: number): string {
  let m = `Snoozed until ${snoozeWhen(until, now, timeZone)}.`;
  if (hardDate && hardDate.getTime() < until.getTime()) {
    const h = dueCivil(hardDate);
    const today = zonedDateString(now, timeZone);
    const hs = `${h.y}-${String(h.m).padStart(2, '0')}-${String(h.d).padStart(2, '0')}`;
    if (hs === today) m += ' Its date is today.';
    else if (hs < today) m += ` Its date was ${weekdayName(h.y, h.m, h.d)}.`;
    else m += ' Its date is tomorrow.';
  }
  if (countToday >= 3) m += countToday === 3 ? ` ${SNOOZE_THIRD_LINE}` : ` That is the ${ordinal(countToday)} time today.`;
  return m;
}

/** Parked by a snooze that has not ended. */
export function isSnoozeParked(st: Pick<RawItemState, 'snoozed_until' | 'view_at' | 'view_set_by'> | null | undefined, now: Date): boolean {
  return !!st?.snoozed_until && st.snoozed_until.getTime() > now.getTime() && !!st.view_at && st.view_at.getTime() > now.getTime() && (st.view_set_by ?? 'user') === 'user';
}

/** A snooze ended earlier today (his zone): the card says "Back from a snooze." for the rest of that day. */
export function isSnoozeBack(st: Pick<RawItemState, 'snoozed_until' | 'view_at' | 'view_set_by'> | null | undefined, now: Date, timeZone: string): boolean {
  if (!st?.snoozed_until || !st.view_at || (st.view_set_by ?? 'user') !== 'user') return false;
  if (st.snoozed_until.getTime() > now.getTime() || st.view_at.getTime() !== st.snoozed_until.getTime()) return false;
  return zonedDateString(st.snoozed_until, timeZone) === zonedDateString(now, timeZone);
}

/** The drawer check text: "Back at 2:00 today. Snoozed." */
export function snoozeCheckText(until: Date, now: Date, timeZone: string): string {
  const clock = clockWords(until, timeZone);
  const day = zonedDateString(until, timeZone);
  if (day === zonedDateString(now, timeZone)) return `Back at ${clock} today. ${SNOOZE_CHECK_SUFFIX}`;
  const c = parseDay(day) as { y: number; m: number; d: number };
  return `Back ${weekdayName(c.y, c.m, c.d)} at ${clock}. ${SNOOZE_CHECK_SUFFIX}`;
}

/** 1 hour, 3 hours, After lunch (13:00) and End of day (16:00) in his zone; a clock time only when it is at least 15 minutes ahead. */
export function snoozeChoices(now: Date, timeZone: string): HomeChoice[] {
  const out: HomeChoice[] = [
    { label: '1 hour', hours: 1 },
    { label: '3 hours', hours: 3 },
  ];
  const today = parseDay(zonedDateString(now, timeZone)) as { y: number; m: number; d: number };
  for (const [label, hour] of [['After lunch', 13], ['End of day', 16]] as const) {
    const at = zonedInstant(today, hour, 0, timeZone);
    if (at.getTime() - now.getTime() >= SNOOZE_MIN_MINUTES * 60_000) out.push({ label, until: at.toISOString() });
  }
  return out;
}
