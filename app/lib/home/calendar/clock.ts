/**
 * Home screen Slice 10a: clock words for the strip, in his zone. "2:00" on the 12 hour clock
 * with no am or pm from 7:00 to 18:59, "6:30 am" and "8:00 pm" outside that.
 */

export interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone);
  } catch {
    parts = fmt('America/New_York');
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
}

export function clockLabel(date: Date, timeZone: string): string {
  const { h, min } = zonedParts(date, timeZone);
  const twelve = h % 12 === 0 ? 12 : h % 12;
  const base = `${twelve}:${String(min).padStart(2, '0')}`;
  if (h >= 7 && h <= 18) return base;
  return `${base} ${h < 12 ? 'am' : 'pm'}`;
}

export function weekdayName(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/New_York' }).format(date);
  }
}

function wallClockAsUtc(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const sec = Number(new Intl.DateTimeFormat('en-US', { timeZone, second: 'numeric' }).format(date));
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, Number.isFinite(sec) ? sec : 0);
}

/** The UTC instant of local midnight at the start of y-m-d in the zone. */
function midnightUtc(y: number, m: number, d: number, timeZone: string): Date {
  const nominal = Date.UTC(y, m - 1, d);
  let guess = nominal;
  for (let i = 0; i < 3; i++) guess = nominal - (wallClockAsUtc(new Date(guess), timeZone) - guess);
  return new Date(guess);
}

/** [start, end) of the zoned calendar day that contains `now` (the same answer as load.ts zonedDayBounds, kept here so the pure files do not import the loader). */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const { y, m, d } = zonedParts(now, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: midnightUtc(y, m, d, timeZone), end: midnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone) };
}
