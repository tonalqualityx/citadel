import { describe, it, expect } from 'vitest';
import type { HomeItem } from '@/lib/home/types';
import {
  arcHeading,
  buildAddOptions,
  dayOverflows,
  moveIndex,
  moveKey,
  orderSteps,
  rankCandidates,
  rowMeta,
  sameOrder,
  shouldCreate,
  taskKey,
  whyLine,
} from '../today-list-logic';

function item(key: string, title: string, extra: Partial<HomeItem> = {}): HomeItem {
  return { key, title, who: null, effort: 'About 10 minutes', age: '3 days', hard_date: null, client: null, project: null, ...extra } as HomeItem;
}

describe('today-list-logic', () => {
  it('builds the arc heading and the why line', () => {
    expect(arcHeading('Grok of the Rock')).toBe("Today's arc: Grok of the Rock");
    expect(whyLine('A security flag is open.')).toBe('Why this arc: a security flag is open');
    expect(whyLine('')).toBe('');
  });

  it('shows effort then the hard date, else the age', () => {
    expect(rowMeta(item('a', 'A'))).toContain('About 10 minutes');
    expect(rowMeta(item('a', 'A'))).toContain('3 days');
    expect(rowMeta(item('a', 'A', { hard_date: 'Due Friday, November 14' }))).toContain('Due Friday');
    expect(rowMeta(item('a', 'A', { hard_date: 'Due Friday, November 14' }))).not.toContain('3 days');
  });

  it('uses no em or en dash in the meta separator', () => {
    expect(rowMeta(item('a', 'A'))).not.toMatch(/[–—]/);
  });

  it('flags a day that does not fit', () => {
    expect(dayOverflows(190, 120)).toBe(true);
    expect(dayOverflows(100, 120)).toBe(false);
  });

  it('lowercases task keys', () => {
    expect(taskKey('ABC-1')).toBe('task:abc-1');
  });

  it('ranks the same client first, excludes steps, filters by every word', () => {
    const list = [
      item('task:1', 'Fix footer', { client: { id: 'c2', name: 'Other' } as never }),
      item('task:2', 'Fix header', { client: { id: 'c1', name: 'Grok' } as never }),
      item('task:3', 'Write post', { client: { id: 'c1', name: 'Grok' } as never }),
    ];
    expect(rankCandidates(list, 'fix', 'c1', []).map((i) => i.key)).toEqual(['task:2', 'task:1']);
    expect(rankCandidates(list, 'fix', 'c1', ['task:2']).map((i) => i.key)).toEqual(['task:1']);
    expect(rankCandidates(list, 'grok post', 'c1', []).map((i) => i.key)).toEqual(['task:3']);
    expect(rankCandidates(list, '', 'c1', []).map((i) => i.key)).toEqual(['task:2', 'task:3', 'task:1']);
  });

  it('merges local and remote without duplicates or excluded keys', () => {
    const local = [item('task:aaa', 'Local one')];
    const options = buildAddOptions(local, [{ id: 'AAA', title: 'dup' }, { id: 'bbb', title: 'Remote' }, { id: 'ccc', title: 'Step' }], ['task:ccc']);
    expect(options.map((o) => [o.key, o.origin])).toEqual([
      ['task:aaa', 'in_view'],
      ['task:bbb', 'search'],
    ]);
  });

  it('creates only when there is text and no option', () => {
    expect(shouldCreate('  ', [])).toBe(false);
    expect(shouldCreate('Call Gene', [])).toBe(true);
    expect(shouldCreate('Call Gene', [{ key: 'k', title: 't', meta: '', origin: 'search' }])).toBe(false);
  });

  it('moves entries and keys safely', () => {
    expect(moveIndex(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveIndex(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveKey(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('orders steps by keys and keeps unknown steps at the end', () => {
    const steps = [item('a', 'A'), item('b', 'B'), item('c', 'C')];
    expect(orderSteps(steps, ['c', 'x', 'a']).map((s) => s.key)).toEqual(['c', 'a', 'b']);
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});
