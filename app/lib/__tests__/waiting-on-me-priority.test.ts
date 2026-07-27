import { describe, it, expect } from 'vitest';
import { floatHighPriority } from '../waiting-on-me-priority';

function item(id: string, priority: number | null) {
  return { id, priority };
}

describe('floatHighPriority', () => {
  it('floats priority-1 items to the top', () => {
    const result = floatHighPriority([item('a', 3), item('b', 1), item('c', 5)]);
    expect(result.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('floats priority-2 items above everything but priority-1', () => {
    const result = floatHighPriority([item('a', 3), item('b', 2), item('c', 1), item('d', 4)]);
    expect(result.map((i) => i.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('preserves relative order WITHIN each tier (stable)', () => {
    const result = floatHighPriority([
      item('p1-first', 1),
      item('p3-first', 3),
      item('p2-first', 2),
      item('p1-second', 1),
      item('p3-second', 3),
      item('p2-second', 2),
    ]);
    expect(result.map((i) => i.id)).toEqual([
      'p1-first',
      'p1-second',
      'p2-first',
      'p2-second',
      'p3-first',
      'p3-second',
    ]);
  });

  it('treats null priority (session_ask cards) as the lowest tier, order preserved', () => {
    const result = floatHighPriority([item('null-1', null), item('p1', 1), item('null-2', null)]);
    expect(result.map((i) => i.id)).toEqual(['p1', 'null-1', 'null-2']);
  });

  it('is a no-op reorder when nothing is priority 1 or 2', () => {
    const result = floatHighPriority([item('a', 3), item('b', 5), item('c', 4)]);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty array', () => {
    expect(floatHighPriority([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [item('a', 3), item('b', 1)];
    const result = floatHighPriority(input);
    expect(input.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result).not.toBe(input);
  });
});
