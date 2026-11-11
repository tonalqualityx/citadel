/**
 * Slice 7b: a learned weight applied to one item's urgency. Pure. select.ts calls it once per candidate.
 * It copies klass, importance and the hard date untouched, and changes nothing but urgency.
 */

import type { Score } from '../score';
import { hasLifelineTag, hasSecurityTag } from '../rules';
import type { HomeSourceKind } from '../types';
import { WEIGHT } from './weights';

export interface WeightRow {
  evidence_key: string;
  label: string;
  weight_pct: number;
}

export interface ApplyInput {
  kind: HomeSourceKind;
  /** The emergency rule the item meets (after "Not an emergency"), or null. */
  rule: boolean;
  botTask: boolean;
  lead: boolean;
  tags: readonly string[];
  hardDate: boolean;
  keys: readonly string[];
  /** A ceiling the weighted urgency may not pass (a project step's 60). */
  cap?: number;
}

export interface Applied {
  score: Score;
  /** The evidence that moved it most (for the footer sentence). */
  key: string;
  label: string;
  dir: 'up' | 'down';
}

/** The combined multiplier of the item's weights, clamped to 0.80 to 1.20. */
export function multiplierFor(keys: readonly string[], weights: ReadonlyMap<string, WeightRow>): number {
  let m = 1;
  for (const k of keys) {
    const w = weights.get(k);
    if (w) m *= w.weight_pct / 100;
  }
  return Math.max(WEIGHT.multMin, Math.min(WEIGHT.multMax, m));
}

/** Kinds that never take a weight, whatever else is true. */
const NEVER: readonly HomeSourceKind[] = ['crisis', 'site', 'hands'];

export function lowerBlocked(i: Pick<ApplyInput, 'lead' | 'tags' | 'hardDate'>): boolean {
  return i.lead || hasSecurityTag(i.tags) || hasLifelineTag(i.tags) || i.hardDate;
}

/** The weighted score and why, or null when the item is unchanged. */
export function applyWeights(score: Score, input: ApplyInput, weights: ReadonlyMap<string, WeightRow>): Applied | null {
  if (weights.size === 0) return null;
  if (input.rule || input.botTask || NEVER.includes(input.kind)) return null;
  const mult = multiplierFor(input.keys, weights);
  if (mult === 1) return null;
  if (mult < 1 && lowerBlocked(input)) return null;
  let urgency = Math.max(0, Math.min(100, Math.round(score.urgency * mult)));
  // A cap never pulls an item below where it already stands.
  if (input.cap !== undefined) urgency = Math.min(urgency, Math.max(input.cap, score.urgency));
  if (urgency === score.urgency) return null;
  let lead: WeightRow | null = null;
  let best = 0;
  for (const k of input.keys) {
    const w = weights.get(k);
    if (!w || w.weight_pct === 100) continue;
    const dev = Math.abs(w.weight_pct - 100);
    const sameWay = (w.weight_pct > 100) === (mult > 1);
    if (sameWay && dev > best) {
      best = dev;
      lead = w;
    }
  }
  if (!lead) return null;
  return { score: { ...score, urgency }, key: lead.evidence_key, label: lead.label, dir: mult > 1 ? 'up' : 'down' };
}
