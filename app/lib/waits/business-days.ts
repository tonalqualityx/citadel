/**
 * Wait record clock math (specs/citadel-shape-SPEC.md section 2.4).
 *
 * Business days are Monday to Friday in America/New_York with no holiday calendar, matching
 * W7's senders. N business days ends at 17:00 Eastern on the Nth business day after the start
 * day. A start after 17:00 counts from the next business day; a weekend start does too.
 * `hours` is exact elapsed time. All civil-date math runs in the zone, so the 2026-11-01
 * clock change never shifts a 17:00 due time.
 *
 * No dependencies: Intl.DateTimeFormat does the zone conversion.
 */

export const WAIT_TIMEZONE = 'America/New_York';
export const DUE_HOUR = 17;
export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 18;

export type WaitUnitName = 'hours' | 'calendar_days' | 'business_days';

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday, in the zone. */
  weekday: number;
}

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: WAIT_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function zonedParts(date: Date): ZonedParts {
  const map: Record<string, number> = {};
  for (const p of formatter.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const weekday = new Date(Date.UTC(map.year, map.month - 1, map.day)).getUTCDay();
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
    weekday,
  };
}

function offsetMs(utcMs: number): number {
  const p = zonedParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant at which the wall clock in the zone reads the given civil time. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const o1 = offsetMs(guess);
  let t = guess - o1;
  const o2 = offsetMs(t);
  if (o2 !== o1) t = guess - o2;
  return new Date(t);
}

interface Civil {
  year: number;
  month: number;
  day: number;
}

function civilPlusDays(c: Civil, n: number): Civil {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function civilWeekday(c: Civil): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

function isBusinessCivil(c: Civil): boolean {
  const w = civilWeekday(c);
  return w >= 1 && w <= 5;
}

function nextBusinessCivil(c: Civil): Civil {
  let n = civilPlusDays(c, 1);
  while (!isBusinessCivil(n)) n = civilPlusDays(n, 1);
  return n;
}

function civilKey(c: Civil): number {
  return c.year * 10000 + c.month * 100 + c.day;
}

export function isBusinessDay(date: Date): boolean {
  const p = zonedParts(date);
  return p.weekday >= 1 && p.weekday <= 5;
}

/**
 * The day business-day counting starts from: the same day when it is a business day before
 * 17:00, otherwise the next business day (after 17:00, or a weekend).
 */
function countingBase(start: Date): Civil {
  const p = zonedParts(start);
  const civil = { year: p.year, month: p.month, day: p.day };
  const business = p.weekday >= 1 && p.weekday <= 5;
  if (business && p.hour < DUE_HOUR) return civil;
  return nextBusinessCivil(civil);
}

/** 17:00 Eastern on the Nth business day after the start day (N = 0 gives the base day). */
export function addBusinessDays(start: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 0) throw new Error(`addBusinessDays: n must be a non-negative integer, got ${n}`);
  let c = countingBase(start);
  for (let i = 0; i < n; i++) c = nextBusinessCivil(c);
  return zonedTimeToUtc(c.year, c.month, c.day, DUE_HOUR, 0);
}

/** Same local wall-clock time, n calendar days later (a DST change does not shift the hour). */
export function addCalendarDays(start: Date, n: number): Date {
  const p = zonedParts(start);
  const c = civilPlusDays({ year: p.year, month: p.month, day: p.day }, n);
  return zonedTimeToUtc(c.year, c.month, c.day, p.hour, p.minute);
}

export function addHours(start: Date, n: number): Date {
  return new Date(start.getTime() + n * 3_600_000);
}

export function computeDueAt(start: Date, value: number, unit: WaitUnitName): Date {
  switch (unit) {
    case 'hours':
      return addHours(start, value);
    case 'calendar_days':
      return addCalendarDays(start, value);
    case 'business_days':
      return addBusinessDays(start, value);
  }
}

/**
 * Business days elapsed after the due day, up to and including the day of `now`. Due Tuesday,
 * now Friday gives 3. Same day or earlier gives 0. Drives the visibility ladder (3 and 5 days
 * late).
 */
export function businessDaysLate(dueAt: Date, now: Date): number {
  const d = zonedParts(dueAt);
  const n = zonedParts(now);
  let c: Civil = { year: d.year, month: d.month, day: d.day };
  const end: Civil = { year: n.year, month: n.month, day: n.day };
  let count = 0;
  let guard = 0;
  while (civilKey(c) < civilKey(end) && guard++ < 4000) {
    c = civilPlusDays(c, 1);
    if (isBusinessCivil(c)) count++;
  }
  return count;
}

/** Whole days of waiting, by civil date in the zone ("waiting 8 days"). */
export function calendarDaysSince(since: Date, now: Date): number {
  const a = zonedParts(since);
  const b = zonedParts(now);
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** True while `date` is inside the send window: 08:00 to 18:00 Eastern on a business day. */
export function isWithinSendWindow(date: Date): boolean {
  const p = zonedParts(date);
  if (p.weekday < 1 || p.weekday > 5) return false;
  return p.hour >= SEND_WINDOW_START_HOUR && p.hour < SEND_WINDOW_END_HOUR;
}

/** The next instant at or after `date` inside the send window. */
export function nextSendWindowStart(date: Date): Date {
  if (isWithinSendWindow(date)) return date;
  const p = zonedParts(date);
  const civil = { year: p.year, month: p.month, day: p.day };
  const business = p.weekday >= 1 && p.weekday <= 5;
  if (business && p.hour < SEND_WINDOW_START_HOUR) {
    return zonedTimeToUtc(civil.year, civil.month, civil.day, SEND_WINDOW_START_HOUR, 0);
  }
  const next = nextBusinessCivil(civil);
  return zonedTimeToUtc(next.year, next.month, next.day, SEND_WINDOW_START_HOUR, 0);
}

/** Start of the zone's civil day (00:00) containing `date`. */
export function startOfZonedDay(date: Date): Date {
  const p = zonedParts(date);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0);
}

/** End of the zone's civil day (the instant before the next local midnight). */
export function endOfZonedDay(date: Date): Date {
  const p = zonedParts(date);
  const next = civilPlusDays({ year: p.year, month: p.month, day: p.day }, 1);
  return new Date(zonedTimeToUtc(next.year, next.month, next.day, 0, 0).getTime() - 1);
}

/** True when both instants fall on the same civil date in the zone. */
export function sameZonedDay(a: Date, b: Date): boolean {
  const x = zonedParts(a);
  const y = zonedParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}
