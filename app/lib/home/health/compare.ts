/**
 * Home health tiles (task 183ec7a8): how a tile's number compares with that measure's own 12 week average.
 * Mike's answer, 2026-11-26: "Own 12 week average now, initiative targets later". Pure: no Prisma, no clock.
 *
 * A tile says "Look at this" only when its number has moved the bad way from its usual by more than a quarter AND by at least the
 * measure's floor (so 1 against an average of 0.5 is not news). Otherwise it is "Normal". With fewer than MIN_HISTORY_DAYS of
 * history there is no usual yet: the tile is "Normal" and says it is still building its average, never a guess.
 */

/** Which way is bad for this measure. */
export type HealthDirection = 'up_is_bad' | 'down_is_bad';

export const WINDOW_DAYS = 84; // 12 weeks
export const MIN_HISTORY_DAYS = 7;
export const CHANGE_SHARE = 0.25;

export interface HealthPoint {
  /** YYYY-MM-DD */
  day: string;
  value: number;
}

/** The days in the window before `today` (YYYY-MM-DD), as YYYY-MM-DD strings: [today - 84, today - 1]. */
export function windowStart(today: string): string {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

/** The mean of the points inside the window before today, or null with too little history. Today's own point never counts. */
export function twelveWeekAverage(points: HealthPoint[], today: string): { average: number | null; days: number } {
  const start = windowStart(today);
  const inWindow = points.filter((p) => p.day >= start && p.day < today && Number.isFinite(p.value));
  if (inWindow.length < MIN_HISTORY_DAYS) return { average: null, days: inWindow.length };
  const sum = inWindow.reduce((s, p) => s + p.value, 0);
  return { average: sum / inWindow.length, days: inWindow.length };
}

/** True when the value has moved the bad way from the average by more than CHANGE_SHARE and by at least `floor`. */
export function needsALook(value: number, average: number | null, direction: HealthDirection, floor: number): boolean {
  if (average === null) return false;
  const diff = direction === 'up_is_bad' ? value - average : average - value;
  if (diff < floor) return false;
  if (average === 0) return diff > 0;
  return diff / Math.abs(average) > CHANGE_SHARE;
}

/** Weekly totals for a measure counted from dated events (for example cards finished), as one point per week ending yesterday. */
export function weeklyTotals(eventDays: string[], today: string, weeks = 12): number[] {
  const totals = new Array<number>(weeks).fill(0);
  const t = new Date(`${today}T00:00:00.000Z`).getTime();
  for (const day of eventDays) {
    const ageDays = Math.floor((t - new Date(`${day}T00:00:00.000Z`).getTime()) / 86_400_000);
    // this week = today and the 6 days before it (age 0..6) is not history; week 1 = age 7..13, and so on
    const week = Math.floor(ageDays / 7);
    if (week >= 1 && week <= weeks) totals[week - 1] += 1;
  }
  return totals;
}
