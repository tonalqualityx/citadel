import { describe, expect, it } from 'vitest';
import { sameValue } from '../direction-model';

describe('sameValue', () => {
  it('ignores the order of object keys at every depth', () => {
    expect(sameValue([{ design_note_id: 'n1', how_honoured: 'x' }], [{ how_honoured: 'x', design_note_id: 'n1' }])).toBe(true);
    expect(sameValue({ a: { b: 1, c: [{ d: 1, e: 2 }] } }, { a: { c: [{ e: 2, d: 1 }], b: 1 } })).toBe(true);
  });

  it('still sees a changed value, a changed array order and a missing key', () => {
    expect(sameValue({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(sameValue('1', 1)).toBe(false);
  });

  it('treats null, undefined and an undefined key as the same nothing', () => {
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});
