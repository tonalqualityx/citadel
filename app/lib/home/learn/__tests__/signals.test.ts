import { describe, it, expect } from 'vitest';
import { buildSignals, directionOf, tally, windowStartDay, type ResolvedEvidence, type TapRow } from '../signals';

const tap = (over: Partial<TapRow> = {}): TapRow => ({ item_key: 'task:a', action: 'matters_more', origin: null, day: '2026-11-17', source: 'home', undone: false, ...over });
const ev = new Map<string, ResolvedEvidence>([
  ['task:a', { keys: ['client:x', 'type:task'], protected: false }],
  ['task:b', { keys: ['client:x', 'type:task'], protected: true }],
]);

describe('signals', () => {
  it('up: matters_more, bring_forward, arc_add from in_view or search; down: not_now, arc_remove', () => {
    expect(directionOf({ action: 'matters_more', origin: null })).toBe('up');
    expect(directionOf({ action: 'bring_forward', origin: null })).toBe('up');
    expect(directionOf({ action: 'arc_add', origin: 'in_view' })).toBe('up');
    expect(directionOf({ action: 'arc_add', origin: 'search' })).toBe('up');
    expect(directionOf({ action: 'arc_add', origin: 'created' })).toBeNull();
    expect(directionOf({ action: 'not_now', origin: null })).toBe('down');
    expect(directionOf({ action: 'arc_remove', origin: null })).toBe('down');
  });
  it('nothing else counts: other actions, keeper rows, undone taps, rows with no key', () => {
    const rows = [tap({ action: 'complete' }), tap({ source: 'keeper' }), tap({ undone: true }), tap({ item_key: null }), tap({ item_key: 'task:unknown' })];
    expect(buildSignals(rows, ev)).toEqual([]);
  });
  it('an emergency-tagged task or a lead feeds an up shift but never a down shift', () => {
    expect(buildSignals([tap({ item_key: 'task:b', action: 'not_now' })], ev)).toEqual([]);
    expect(buildSignals([tap({ item_key: 'task:b', action: 'matters_more' })], ev)).toHaveLength(1);
  });
  it('tally counts taps, distinct items and distinct days per key', () => {
    const s = buildSignals([tap(), tap({ day: '2026-11-18' }), tap({ item_key: 'task:b', day: '2026-11-18' })], ev);
    const t = tally(s).find((x) => x.key === 'client:x')!;
    expect(t).toEqual({ key: 'client:x', up: 3, down: 0, items: 2, days: 2 });
  });
  it('the 28 day window starts 27 days back', () => {
    expect(windowStartDay('2026-11-23', 28)).toBe('2026-10-27');
  });
});
