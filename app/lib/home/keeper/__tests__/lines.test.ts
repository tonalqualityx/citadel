import { describe, expect, it } from 'vitest';
import { arcClosedLine, arcMadeLine, DETAIL_CAP, keeperLines } from '../lines';
import type { KeeperDateChange, KeeperStaggerChange } from '../../types';

const stag = (n: number, day = '2026-11-11'): KeeperStaggerChange[] =>
  Array.from({ length: n }, (_, i) => ({ item_key: `task:${i}`, title: `Chore ${i}`, day, view_at: `${day}T05:05:00.000Z` }));

describe('keeperLines', () => {
  it('writes the stagger line with the weekday the days start on', () => {
    const [l] = keeperLines({ date: '2026-11-10', stagger: stag(41, '2026-11-11'), dates: [] });
    expect(l.action).toBe('keeper_stagger');
    expect(l.text).toBe('Gave 41 waiting tasks a day to come back, at most 3 a day, starting Wednesday.');
    expect(l.details[0]).toBe('Chore 0: back Wednesday, November 11');
  });

  it('says today when the first day is the run date, and handles one task', () => {
    const [l] = keeperLines({ date: '2026-11-11', stagger: stag(1), dates: [] });
    expect(l.text).toBe('Gave 1 waiting task a day to come back, at most 3 a day, starting today.');
  });

  it('writes the dates line and lists real dates and set-aside client work', () => {
    const dates: KeeperDateChange[] = [
      { item_key: 'task:a', title: 'A', outcome: 'read', due_date: '2026-11-15', client_facing: false },
      { item_key: 'task:b', title: 'B', outcome: 'set_aside', due_date: '2026-11-06', client_facing: true },
      { item_key: 'task:c', title: 'C', outcome: 'set_aside', due_date: '2026-11-06', client_facing: false },
    ];
    const [l] = keeperLines({ date: '2026-11-11', stagger: [], dates });
    expect(l.action).toBe('keeper_dates');
    expect(l.text).toBe('Read the dates on 3 tasks: 1 now show as real dates, 2 were set aside.');
    expect(l.details).toEqual(['A: now shows as a real date, Sunday, November 15', 'B: set aside, client work, date was Friday, November 6']);
  });

  it('writes no line for a kind with no changes, and caps the details', () => {
    expect(keeperLines({ date: '2026-11-11', stagger: [], dates: [] })).toEqual([]);
    const [l] = keeperLines({ date: '2026-11-11', stagger: stag(DETAIL_CAP + 5), dates: [] });
    expect(l.details).toHaveLength(DETAIL_CAP + 1);
    expect(l.details[DETAIL_CAP]).toBe('and 5 more');
  });

  it('uses no dash and none of the banned words', () => {
    const all = keeperLines({
      date: '2026-11-11',
      stagger: stag(3),
      dates: [{ item_key: 'task:a', title: 'A', outcome: 'read', due_date: '2026-11-15', client_facing: false }],
    });
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/priorit|overdue/i);
  });
});

describe('arc lines (Slice 2c)', () => {
  it('writes the three sentences Mike reads', () => {
    expect(arcMadeLine('Rowan Pottery', 4)).toBe('Made the arc Rowan Pottery with 4 of your tasks.');
    expect(arcClosedLine('Grok', 'all_done', 0)).toBe('Closed the arc Grok: every step is done.');
    expect(arcClosedLine('Grok', 'stale', 3)).toBe('Closed the arc Grok: the 3 tasks left are still tracked.');
    expect(arcClosedLine('Grok', 'stale', 1)).toBe('Closed the arc Grok: the 1 task left is still tracked.');
  });

  it('swaps a dash in a name for a comma and uses no banned word', () => {
    const text = [arcMadeLine('A — B', 2), arcClosedLine('A – B', 'stale', 0), arcClosedLine('x', 'stale', 2)].join(' ');
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/priorit|overdue/i);
  });
});
