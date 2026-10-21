import { describe, it, expect } from 'vitest';
import { groupByMonth, summarize, monthKeyOf, shortDate, EMPTY_MONTH_LINE, type GroupableItem } from '@/lib/portal/history-group';

const item = (id: string, at: string, type: GroupableItem['type'], kind: GroupableItem['kind'], site?: string): GroupableItem => ({
  id, at, type, kind, site: site ?? null,
});
const NOW = new Date('2026-10-21T12:00:00Z');

describe('history-group', () => {
  it('cuts months in America/New_York', () => {
    // 2026-11-01T03:30Z is still 11:30pm on Oct 31 in New York.
    expect(monthKeyOf('2026-11-01T03:30:00Z')).toBe('2026-10');
    expect(monthKeyOf('2026-11-01T05:30:00Z')).toBe('2026-11');
    expect(shortDate('2026-11-01T03:30:00Z')).toBe('Oct 31');
  });

  it('groups newest first, skips empty months, opens the two newest', () => {
    const groups = groupByMonth(
      [item('a', '2026-10-20T15:00:00Z', 'task_completed', 'request'), item('b', '2026-07-02T15:00:00Z', 'article_published', null), item('c', '2026-09-02T15:00:00Z', 'task_approved', 'project')],
      NOW
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-10', '2026-09', '2026-07']);
    expect(groups.map((g) => g.defaultOpen)).toEqual([true, true, false]);
    expect(groups[0].isCurrent).toBe(true);
    expect(groups[0].label).toBe('October 2026');
  });

  it('counts by type and kind and writes the summary', () => {
    const items = [
      item('1', '2026-10-20T15:00:00Z', 'task_completed', 'request'),
      item('2', '2026-10-19T15:00:00Z', 'task_completed', 'request'),
      item('3', '2026-10-18T15:00:00Z', 'task_completed', 'project'),
      item('4', '2026-10-17T15:00:00Z', 'article_published', null),
      item('5', '2026-10-16T15:00:00Z', 'task_approved', 'retainer'),
    ];
    const [g] = groupByMonth(items, NOW);
    expect(g.byType).toEqual({ task_completed: 3, task_approved: 1, article_published: 1 });
    expect(g.byKind).toEqual({ project: 1, retainer: 2, request: 2 });
    expect(g.summary).toBe('5 finished: 3 site changes, 1 article, 1 approval.');
  });

  it('recounts under a filter and shows the empty line when nothing is left', () => {
    const items = [item('1', '2026-10-20T15:00:00Z', 'task_completed', 'request'), item('2', '2026-09-20T15:00:00Z', 'article_published', null)];
    const groups = groupByMonth(items, NOW, { filter: 'article' });
    expect(groups).toHaveLength(2);
    expect(groups[0].total).toBe(0);
    expect(groups[0].summary).toBe(EMPTY_MONTH_LINE);
    expect(groups[1].summary).toBe('1 finished: 1 article.');
  });

  it('filters by site and keeps items with no known site', () => {
    const items = [
      item('1', '2026-10-20T15:00:00Z', 'task_completed', 'request', 'a.com'),
      item('2', '2026-10-19T15:00:00Z', 'task_completed', 'request', 'b.com'),
      item('3', '2026-10-18T15:00:00Z', 'task_approved', 'project'),
    ];
    const [g] = groupByMonth(items, NOW, { site: 'a.com' });
    expect(g.items.map((i) => i.id)).toEqual(['1', '3']);
  });

  it('summarizes singular and zero', () => {
    expect(summarize({ task_completed: 1, task_approved: 0, article_published: 0 }, 1)).toBe('1 finished: 1 site change.');
    expect(summarize({ task_completed: 0, task_approved: 0, article_published: 0 }, 0)).toBe(EMPTY_MONTH_LINE);
  });

  it('ignores items with an invalid date', () => {
    expect(groupByMonth([item('x', 'nope', 'task_completed', null)], NOW)).toEqual([]);
  });
});
