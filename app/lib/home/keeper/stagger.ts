/**
 * Slice 2a keeper, part 1: give each waiting task a day to come back. Pure: no database, no clock of its own.
 *
 * The pool is what the screen shows as "Waiting their turn" for the owner's own tasks and that does not meet the
 * Next rule. Emergencies, pinned and boosted items, items with a future view_at, items under a keeper hold, and
 * everything that is not a task never enter it. Days are business days in the owner's zone; each holds KEEPER.perDay,
 * counting every other item already coming back that day (his own Not now returns included). Days already given
 * are never moved.
 */

import { KEEPER } from '../rules';
import { meetsNextRule, rankCompare, type Candidate, type SelectResult } from '../select';
import { zonedDateString, zonedToUtc } from '../act';
import type { KeeperStaggerChange, RawItemState } from '../types';

const DAY_MS = 86_400_000;
/** A safety stop for the day search (a backlog of 3 a day for years would still fit). */
const MAX_DAYS = 3000;

/** 'YYYY-MM-DD' to a day number (days since 1970, UTC civil arithmetic). */
export function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** A day number back to 'YYYY-MM-DD'. */
export function dayString(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday to Friday. */
export function isBusinessDayNumber(n: number): boolean {
  const wd = new Date(n * DAY_MS).getUTCDay();
  return wd !== 0 && wd !== 6;
}

/** The weekday name of a 'YYYY-MM-DD'. */
export function weekdayName(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** The long form used in lines: "Thursday, November 12". */
export function longDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Whether a candidate is in the keeper's pool. */
export function inKeeperPool(c: Candidate, now: Date): boolean {
  if (c.kind !== 'task' || c.botTask) return false;
  if (c.section !== 'rest' || c.restGroup !== 'waiting_turn') return false;
  if (c.rule !== null || c.boosted || c.pinned || c.parked) return false;
  if (meetsNextRule(c)) return false;
  const hold = c.state?.keeper_hold_until;
  if (hold && hold.getTime() > now.getTime()) return false;
  return true;
}

/**
 * Plan the days. `sel` is the screen as it stands, `states` the owner's item states. Returns the changes in the
 * order given (best first). Nothing is written.
 */
export function planStagger(sel: SelectResult, states: readonly RawItemState[], now: Date, tz: string): KeeperStaggerChange[] {
  const pool = sel.candidates.filter((c) => inKeeperPool(c, now)).sort(rankCompare);
  if (pool.length === 0) return [];

  const today = dayNumber(zonedDateString(now, tz));

  // How many items already come back on each day, from this day on. Only items still on the screen count.
  const taken = new Map<number, number>();
  for (const s of states) {
    if (!s.view_at || !sel.byKey.has(s.item_key)) continue;
    const day = dayNumber(zonedDateString(s.view_at, tz));
    if (day < today) continue;
    if (s.view_at.getTime() <= now.getTime() && s.view_set_by !== 'keeper') continue;
    taken.set(day, (taken.get(day) ?? 0) + 1);
  }

  const changes: KeeperStaggerChange[] = [];
  let day = today;
  for (const c of pool) {
    let guard = 0;
    while (guard++ < MAX_DAYS && (!isBusinessDayNumber(day) || (taken.get(day) ?? 0) >= KEEPER.perDay)) day += 1;
    if (guard > MAX_DAYS) break;
    taken.set(day, (taken.get(day) ?? 0) + 1);
    const ymd = dayString(day);
    const [y, m, d] = ymd.split('-').map(Number);
    changes.push({
      item_key: c.key,
      title: c.item.title,
      day: ymd,
      view_at: zonedToUtc(y, m, d, KEEPER.slotHour, KEEPER.slotMinute, tz).toISOString(),
    });
  }
  return changes;
}
