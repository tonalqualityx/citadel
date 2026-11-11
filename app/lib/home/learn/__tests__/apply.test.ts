import { describe, it, expect } from 'vitest';
import type { Score } from '../../score';
import { applyWeights, multiplierFor, type ApplyInput, type WeightRow } from '../apply';

const score = (over: Partial<Score> = {}): Score => ({
  importance: 60,
  urgency: 50,
  klass: 2,
  clientTrust: 20,
  money: 0,
  unblocks: 0,
  hardDate: null,
  hardKind: null,
  hardSource: null,
  waitingSince: null,
  venture: false,
  ...over,
});
const input = (over: Partial<ApplyInput> = {}): ApplyInput => ({ kind: 'task', rule: false, botTask: false, lead: false, tags: [], hardDate: false, keys: ['client:x', 'type:task'], ...over });
const W = (pct: number, key = 'client:x'): WeightRow => ({ evidence_key: key, label: 'X', weight_pct: pct });
const map = (...w: WeightRow[]) => new Map(w.map((x) => [x.evidence_key, x]));

describe('applyWeights', () => {
  it('multiplies urgency and copies klass, importance and hardDate untouched', () => {
    const hd = new Date('2026-12-01T00:00:00Z');
    const r = applyWeights(score({ hardDate: hd, hardKind: 'hard_due', urgency: 40 }), input({ hardDate: true }), map(W(120)))!;
    expect(r.score.urgency).toBe(48);
    expect(r.score.klass).toBe(2);
    expect(r.score.importance).toBe(60);
    expect(r.score.hardDate).toBe(hd);
    expect(r.score.hardKind).toBe('hard_due');
    expect(r).toMatchObject({ key: 'client:x', dir: 'up' });
  });
  it('an emergency candidate, crisis, site, hands row and bot task are unchanged', () => {
    const w = map(W(120), W(120, 'type:task'));
    expect(applyWeights(score(), input({ rule: true }), w)).toBeNull();
    for (const kind of ['crisis', 'site', 'hands'] as const) expect(applyWeights(score(), input({ kind }), w)).toBeNull();
    expect(applyWeights(score(), input({ botTask: true }), w)).toBeNull();
  });
  it('a lead, a security tagged task and a hard-dated task are unchanged at multiplier 0.8', () => {
    const w = map(W(80));
    expect(applyWeights(score(), input({ lead: true }), w)).toBeNull();
    for (const tag of ['security', 'security-report', 'lifeline', 'job-watch', 'job-watch:claude-signin']) {
      expect(applyWeights(score(), input({ tags: [tag] }), w), tag).toBeNull();
    }
    expect(applyWeights(score(), input({ hardDate: true }), w)).toBeNull();
    expect(applyWeights(score(), input(), w)!.score.urgency).toBe(40);
  });
  it('with multiplier 1.2 the same three rise', () => {
    const w = map(W(120));
    expect(applyWeights(score(), input({ lead: true }), w)!.score.urgency).toBe(60);
    expect(applyWeights(score(), input({ tags: ['security'] }), w)!.score.urgency).toBe(60);
    expect(applyWeights(score(), input({ hardDate: true }), w)!.score.urgency).toBe(60);
  });
  it('three keys at 120 give 1.20, not 1.73', () => {
    const w = map(W(120, 'client:x'), W(120, 'project:p'), W(120, 'sop:s'));
    expect(multiplierFor(['client:x', 'project:p', 'sop:s'], w)).toBe(1.2);
    expect(applyWeights(score({ urgency: 50 }), input({ keys: ['client:x', 'project:p', 'sop:s'] }), w)!.score.urgency).toBe(60);
  });
  it('opposite weights cancel and a clamp keeps 0.80 as the floor', () => {
    expect(applyWeights(score(), input(), map(W(120), W(80, 'type:task')))!.score.urgency).toBe(48);
    expect(multiplierFor(['a', 'b', 'c'], map(W(80, 'a'), W(80, 'b'), W(80, 'c')))).toBe(0.8);
  });
  it('urgency stays between 0 and 100 and a cap holds (a project step at 60)', () => {
    expect(applyWeights(score({ urgency: 95 }), input(), map(W(120)))!.score.urgency).toBe(100);
    expect(applyWeights(score({ urgency: 60 }), input({ kind: 'step', keys: ['type:step'], cap: 60 }), map(W(120, 'type:step')))).toBeNull();
    expect(applyWeights(score({ urgency: 55 }), input({ kind: 'step', keys: ['type:step'], cap: 60 }), map(W(120, 'type:step')))!.score.urgency).toBe(60);
  });
  it('returns null when the weight does not change the number, or every weight is at 100', () => {
    expect(applyWeights(score({ urgency: 5 }), input(), map(W(105)))).toBeNull(); // 5.25 rounds back to 5
    expect(applyWeights(score(), input(), new Map())).toBeNull();
  });
  it('property: klass, importance and hardDate never change, urgency stays within 20 percent, over random scores', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 500; i++) {
      const s = score({ urgency: Math.floor(rnd() * 101), importance: Math.floor(rnd() * 101), klass: (1 + Math.floor(rnd() * 4)) as Score['klass'] });
      const pct = 80 + 5 * Math.floor(rnd() * 9);
      const r = applyWeights(s, input({ lead: rnd() < 0.2, hardDate: rnd() < 0.2, tags: rnd() < 0.2 ? ['security'] : [] }), map(W(pct)));
      if (!r) continue;
      expect(r.score.klass).toBe(s.klass);
      expect(r.score.importance).toBe(s.importance);
      expect(r.score.hardDate).toBe(s.hardDate);
      expect(r.score.urgency).toBeGreaterThanOrEqual(Math.round(s.urgency * 0.8));
      expect(r.score.urgency).toBeLessThanOrEqual(Math.min(100, Math.round(s.urgency * 1.2)));
    }
  });
});
