/**
 * Slice 7b: his own taps as signals. Pure.
 * Up: matters_more, bring_forward, arc_add (origins in_view and search). Down: not_now, arc_remove.
 * Nothing else counts, keeper rows never count, and a tap that was undone never counts.
 */

import { addDaysYmd } from './working-hours';

export const UP_ACTIONS = ['matters_more', 'bring_forward', 'arc_add'] as const;
export const DOWN_ACTIONS = ['not_now', 'arc_remove'] as const;
export const SIGNAL_ACTIONS: readonly string[] = [...UP_ACTIONS, ...DOWN_ACTIONS];
export const SIGNAL_ORIGINS: readonly string[] = ['in_view', 'search'];

export type Direction = 'up' | 'down';

/** One home_actions row as the store reads it. */
export interface TapRow {
  item_key: string | null;
  action: string;
  /** home_actions.after.origin for arc_add, else null. */
  origin: string | null;
  /** The zoned day of the tap, YYYY-MM-DD. */
  day: string;
  source: string;
  undone: boolean;
}

/** What the store resolved for one item key: its evidence keys, and whether it is protected from a down shift. */
export interface ResolvedEvidence {
  keys: string[];
  /** A lead or an emergency-tagged task: it can feed an up shift, never a down shift. */
  protected: boolean;
}

export interface Signal {
  item_key: string;
  dir: Direction;
  day: string;
  keys: string[];
}

export function directionOf(row: Pick<TapRow, 'action' | 'origin'>): Direction | null {
  if ((DOWN_ACTIONS as readonly string[]).includes(row.action)) return 'down';
  if (row.action === 'arc_add') return row.origin !== null && SIGNAL_ORIGINS.includes(row.origin) ? 'up' : null;
  if ((UP_ACTIONS as readonly string[]).includes(row.action)) return 'up';
  return null;
}

/** The first zoned day of the 28-day window that ends on `today` (inclusive). */
export function windowStartDay(today: string, days: number): string {
  return addDaysYmd(today, -(days - 1));
}

export function buildSignals(rows: readonly TapRow[], evidence: ReadonlyMap<string, ResolvedEvidence>): Signal[] {
  const out: Signal[] = [];
  for (const r of rows) {
    if (r.source !== 'home' || r.undone || !r.item_key) continue;
    const dir = directionOf(r);
    if (!dir) continue;
    const ev = evidence.get(r.item_key);
    if (!ev || ev.keys.length === 0) continue;
    if (dir === 'down' && ev.protected) continue;
    out.push({ item_key: r.item_key, dir, day: r.day, keys: ev.keys });
  }
  return out;
}

export interface KeyTally {
  key: string;
  up: number;
  down: number;
  items: number;
  days: number;
}

export function tally(signals: readonly Signal[]): KeyTally[] {
  const by = new Map<string, { up: number; down: number; items: Set<string>; days: Set<string> }>();
  for (const s of signals) {
    for (const k of s.keys) {
      let t = by.get(k);
      if (!t) {
        t = { up: 0, down: 0, items: new Set(), days: new Set() };
        by.set(k, t);
      }
      if (s.dir === 'up') t.up += 1;
      else t.down += 1;
      t.items.add(s.item_key);
      t.days.add(s.day);
    }
  }
  return Array.from(by, ([key, t]) => ({ key, up: t.up, down: t.down, items: t.items.size, days: t.days.size })).sort((a, b) => (a.key < b.key ? -1 : 1));
}
