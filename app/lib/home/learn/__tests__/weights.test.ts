import { describe, it, expect } from 'vitest';
import type { Signal } from '../signals';
import { WEIGHT, clampPct, planShifts, type CurrentWeight } from '../weights';

const NOW = new Date('2026-11-30T15:00:00Z');
const sig = (key: string, item: string, day: string, dir: 'up' | 'down' = 'up'): Signal => ({ item_key: `task:${item}`, dir, day, keys: [key] });
const good = (key: string): Signal[] => [sig(key, 'a', '2026-11-20'), sig(key, 'b', '2026-11-21'), sig(key, 'c', '2026-11-22')];
const plan = (signals: Signal[], over: Partial<Parameters<typeof planShifts>[0]> = {}) =>
  planShifts({ signals, current: new Map(), historyDays: 20, now: NOW, monday: true, learning: true, ...over });

describe('planShifts: the evidence floor', () => {
  it('3 taps on 3 items over 3 days with 14 days of history shift by exactly 5', () => {
    const r = plan(good('client:x'));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ evidence_key: 'client:x', from: 100, to: 105 });
  });
  it('2 taps never shift', () => {
    expect(plan(good('client:x').slice(0, 2))).toEqual([]);
  });
  it('3 taps on one item never shift (needs 2 items)', () => {
    expect(plan([sig('client:x', 'a', '2026-11-20'), sig('client:x', 'a', '2026-11-21'), sig('client:x', 'a', '2026-11-22')])).toEqual([]);
  });
  it('3 taps on one day never shift (needs 2 days)', () => {
    expect(plan([sig('client:x', 'a', '2026-11-20'), sig('client:x', 'b', '2026-11-20'), sig('client:x', 'c', '2026-11-20')])).toEqual([]);
  });
  it('13 days of history never shift, 14 do', () => {
    expect(plan(good('client:x'), { historyDays: 13 })).toEqual([]);
    expect(plan(good('client:x'), { historyDays: 14 })).toHaveLength(1);
  });
  it('no clear lean (net under half the taps) never shifts', () => {
    const mixed = [...good('client:x'), sig('client:x', 'd', '2026-11-23', 'down'), sig('client:x', 'e', '2026-11-24', 'down')]; // 3 up 2 down: net 0.2
    expect(plan(mixed)).toEqual([]);
    const lean = [...good('client:x'), sig('client:x', 'd', '2026-11-23', 'up'), sig('client:x', 'e', '2026-11-24', 'down')]; // 4 up 1 down: net 0.6
    expect(plan(lean)).toHaveLength(1);
  });
  it('a down lean shifts down by 5', () => {
    const down = good('client:x').map((s) => ({ ...s, dir: 'down' as const }));
    expect(plan(down)[0]).toMatchObject({ from: 100, to: 95 });
  });
});

describe('planShifts: the other gates', () => {
  it('only on a Monday run, and only with learning on', () => {
    expect(plan(good('client:x'), { monday: false })).toEqual([]);
    expect(plan(good('client:x'), { learning: false })).toEqual([]);
  });
  it('a weight at 120 never goes past 120; at 80 never below 80', () => {
    const cur = new Map<string, CurrentWeight>([['client:x', { weight_pct: 120, held_until: null }]]);
    expect(plan(good('client:x'), { current: cur })).toEqual([]);
    const low = new Map<string, CurrentWeight>([['client:x', { weight_pct: 80, held_until: null }]]);
    expect(plan(good('client:x').map((s) => ({ ...s, dir: 'down' as const })), { current: low })).toEqual([]);
    expect(clampPct(125)).toBe(WEIGHT.max);
    expect(clampPct(70)).toBe(WEIGHT.min);
  });
  it('5 eligible keys give 3 shifts, the strongest first', () => {
    const keys = ['client:a', 'client:b', 'client:c', 'client:d', 'client:e'];
    const signals = keys.flatMap((k, i) => [...good(k), ...Array.from({ length: i }, (_, n) => sig(k, `x${n}`, '2026-11-2' + (3 + n)))]);
    const r = plan(signals);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.evidence_key)).toEqual(['client:e', 'client:d', 'client:c']);
  });
  it('a held key is skipped, and an expired hold is not', () => {
    const held = new Map<string, CurrentWeight>([['client:x', { weight_pct: 100, held_until: new Date('2026-12-15T00:00:00Z') }]]);
    expect(plan(good('client:x'), { current: held })).toEqual([]);
    const expired = new Map<string, CurrentWeight>([['client:x', { weight_pct: 100, held_until: new Date('2026-11-01T00:00:00Z') }]]);
    expect(plan(good('client:x'), { current: expired })).toHaveLength(1);
  });
  it('reaching a cap from 100 takes four weeks', () => {
    let pct = 100;
    let weeks = 0;
    while (pct < WEIGHT.max) {
      const r = plan(good('client:x'), { current: new Map([['client:x', { weight_pct: pct, held_until: null }]]) });
      pct = r[0].to;
      weeks += 1;
    }
    expect(weeks).toBe(4);
  });
});
