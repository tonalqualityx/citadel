/**
 * Slice 7b: when a weight may move, and by how much. Pure.
 * Only on a Monday run, only with learning on, 5 at a time, at most 3 a week, only on the evidence floor, never a held key.
 */

import { isLearnableKey } from './evidence';
import { tally, type Signal } from './signals';

export const WEIGHT = {
  start: 100,
  min: 80,
  max: 120,
  step: 5,
  maxPerWeek: 3,
  /** Days of home actions needed before anything is learned. */
  historyDays: 14,
  /** The window of taps read. */
  windowDays: 28,
  minTaps: 3,
  minItems: 2,
  minDays: 2,
  /** Net of at least this share of the taps one way. */
  lean: 0.5,
  holdDays: 30,
  undoDays: 7,
  /** Combined multiplier clamp. */
  multMin: 0.8,
  multMax: 1.2,
} as const;

export interface CurrentWeight {
  weight_pct: number;
  held_until: Date | null;
}

export interface Shift {
  evidence_key: string;
  from: number;
  to: number;
  up: number;
  down: number;
  items: number;
  days: number;
  net: number;
  strength: number;
}

export function clampPct(n: number): number {
  return Math.max(WEIGHT.min, Math.min(WEIGHT.max, n));
}

export interface PlanInput {
  signals: readonly Signal[];
  current: ReadonlyMap<string, CurrentWeight>;
  /** Whole days from his first home action to now. */
  historyDays: number;
  now: Date;
  monday: boolean;
  learning: boolean;
}

/** The shifts to write: empty unless it is a Monday, learning is on and the history is long enough. */
export function planShifts(input: PlanInput): Shift[] {
  if (!input.monday || !input.learning) return [];
  if (input.historyDays < WEIGHT.historyDays) return [];
  const out: Shift[] = [];
  for (const t of tally(input.signals)) {
    if (!isLearnableKey(t.key)) continue;
    const taps = t.up + t.down;
    if (taps < WEIGHT.minTaps || t.items < WEIGHT.minItems || t.days < WEIGHT.minDays) continue;
    const net = (t.up - t.down) / taps;
    if (Math.abs(net) < WEIGHT.lean) continue;
    const cur = input.current.get(t.key);
    if (cur?.held_until && cur.held_until.getTime() > input.now.getTime()) continue;
    const from = cur?.weight_pct ?? WEIGHT.start;
    const to = clampPct(from + (net > 0 ? WEIGHT.step : -WEIGHT.step));
    if (to === from) continue;
    out.push({ evidence_key: t.key, from, to, up: t.up, down: t.down, items: t.items, days: t.days, net, strength: Math.abs(net) * taps });
  }
  out.sort((a, b) => b.strength - a.strength || (a.evidence_key < b.evidence_key ? -1 : 1));
  return out.slice(0, WEIGHT.maxPerWeek);
}
