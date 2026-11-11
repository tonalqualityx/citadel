import { describe, it, expect } from 'vitest';
import type { HomeItem, HomeResponse } from '@/lib/home/types';
import {
  addCandidates,
  buildTiles,
  collapsedLine,
  detailForHandled,
  restHeadingLines,
  initialKey,
  itemsForTile,
  plain,
  resolveKey,
  rowsFromItems,
  todayLabel,
} from '../home-screen-logic';

function mkItem(key: string, over: Partial<HomeItem> = {}): HomeItem {
  return {
    key,
    type: 'task',
    title: `Title ${key}`,
    who: 'Gene Roberts',
    age: '3 days',
    why_now: 'A reason.',
    hard_date: null,
    effort: 'About 10 minutes',
    minutes: 10,
    actions: [{ id: 'done', label: 'Done', filled: true, href: null }],
    more_actions: [],
    default_if_ignored: 'Stays here.',
    reason: 'It is here.',
    pinned: false,
    opened: { summary: 'Summary.', summary_by: null, done_when: [], how: null, links: [], task_id: null, left_off_note: null },
    source: { kind: 'task', id: key, ids: [key], task_status: 'not_started' },
    client: null,
    project: null,
    ...over,
  };
}

function mkRes(over: Partial<HomeResponse> = {}): HomeResponse {
  const steps = [mkItem('task:s1'), mkItem('task:s2')];
  return {
    generated_at: '2026-11-09T23:59:00Z',
    date: '2026-11-09',
    timezone: 'America/New_York',
    screen_date_line: 'Monday, November 9',
    user_id: 'u1',
    today: {
      group_key: 'arc:1',
      arc_id: '1',
      arc_name: 'Grok of the Rock',
      client: null,
      project: null,
      why: 'Why.',
      size_line: 'About 1 hour',
      minutes_total: 60,
      minutes_free: 300,
      quick: [mkItem('task:q1')],
      steps,
      added_keys: [],
      swap: [],
      lighter: null,
    },
    sections: {
      needs_you_now: [mkItem('task:n1', { type: 'emergency' })],
      working_on: [],
      leads: [],
      mail: [mkItem('thread:m1', { type: 'owed_reply' })],
      next: [mkItem('task:x1'), mkItem('task:s1')],
      handled: [{ id: 'h1', text: 'Replied', href: null, at: '2026-11-09T10:00:00Z', undo_action_id: null, details: [] }],
      handled_more: { count: 4, text: '4 more handled' },
    },
    everything_else: { count: 3, line: '3 other items.', groups: [{ key: 'parked', label: 'Parked by you', count: 3, owner: 'You', items: [] }], with_day: 0, past_day: 0, scope_line: null },
    empty: {
      today: 'Nothing proposed for today.',
      needs_you_now: 'Nothing urgent.',
      working_on: 'Nothing in progress.',
      leads: 'No sales leads.',
      mail: 'No client is waiting.',
      next: 'Nothing needs a decision.',
      projects: 'No active projects.',
      handled: 'Nothing new.',
      everything_else: '',
    },
    ...over,
  };
}

describe('buildTiles', () => {
  it('orders tiles like the preview and labels Today', () => {
    const tiles = buildTiles(mkRes(), 5);
    expect(tiles.map((t) => t.id)).toEqual(['today', 'needs_you_now', 'working_on', 'leads', 'mail', 'next', 'projects', 'handled', 'everything_else']);
    expect(tiles[0].value).toBe('Today: Grok of the Rock');
    expect(tiles[0].label).toBe('1 quick, then 2 steps');
  });
  it('singular and plural labels, hot only with a count', () => {
    const t = buildTiles(mkRes(), 0);
    const now = t.find((x) => x.id === 'needs_you_now')!;
    expect(now.label).toBe('needs you now');
    expect(now.hot).toBe(true);
    expect(t.find((x) => x.id === 'leads')!.hot).toBe(false);
    expect(t.find((x) => x.id === 'projects')!.value).toBe('0');
  });
  it('handled counts the more line; everything else uses its count', () => {
    const t = buildTiles(mkRes(), 2);
    expect(t.find((x) => x.id === 'handled')!.count).toBe(5);
    expect(t.find((x) => x.id === 'everything_else')!.count).toBe(3);
  });
  it('null today is a plain Today tile', () => {
    const t = buildTiles(mkRes({ today: null }), null)[0];
    expect(t.value).toBe('Today');
    expect(t.count).toBe(0);
  });
  it('todayLabel handles missing parts', () => {
    expect(todayLabel(0, 1)).toBe('1 step');
    expect(todayLabel(3, 0)).toBe('3 quick');
    expect(todayLabel(0, 0)).toBe('');
  });
});

describe('selection', () => {
  it('Today opens the first arc step', () => {
    expect(initialKey(mkRes(), 'today')).toBe('task:s1');
  });
  it('falls back to first quick when no steps, null when no today', () => {
    const r = mkRes();
    r.today!.steps = [];
    expect(initialKey(r, 'today')).toBe('task:q1');
    expect(initialKey(mkRes({ today: null }), 'today')).toBeNull();
  });
  it('other item tiles open their first row; non item tiles none', () => {
    expect(initialKey(mkRes(), 'next')).toBe('task:x1');
    expect(initialKey(mkRes(), 'handled')).toBeNull();
  });
  it('resolveKey keeps the choice, else the neighbour at the same place', () => {
    expect(resolveKey(['a', 'b', 'c'], 'b', 0)).toBe('b');
    expect(resolveKey(['a', 'c'], 'b', 1)).toBe('c');
    expect(resolveKey(['a', 'c'], 'b', 5)).toBe('c');
    expect(resolveKey([], 'b', 0)).toBeNull();
  });
  it('keeps server order', () => {
    expect(itemsForTile(mkRes(), 'next').map((i) => i.key)).toEqual(['task:x1', 'task:s1']);
  });
});

describe('derived lists', () => {
  it('add candidates leave out current steps and duplicates', () => {
    const keys = addCandidates(mkRes()).map((i) => i.key).sort();
    expect(keys).toEqual(['task:n1', 'task:q1', 'task:x1', 'thread:m1']);
  });
  it('collapsed line counts the others', () => {
    expect(collapsedLine(mkRes(), 'task:n1')).toBe('5 more are waiting. They\'ll keep.');
    expect(collapsedLine(mkRes({ today: null, sections: { ...mkRes().sections, needs_you_now: [], mail: [], next: [mkItem('task:z')] } }), null)).toBe("1 more is waiting. It'll keep.");
    expect(collapsedLine(mkRes({ today: null, sections: { ...mkRes().sections, needs_you_now: [], mail: [], next: [] } }), null)).toBeNull();
  });
  it('rows carry the gold rule only for emergencies and never a date but a hard one', () => {
    const rows = rowsFromItems([mkItem('a', { type: 'emergency', hard_date: 'Due Friday, November 14' }), mkItem('b')]);
    expect(rows[0].rule).toBe(true);
    expect(rows[1].rule).toBe(false);
    expect(rows[0].meta).toContain('Due Friday, November 14');
    expect(rows[1].meta).toBe('Gene Roberts  ·  3 days');
  });
  it('plain replaces em and en dashes', () => {
    expect(plain('a — b–c')).toBe('a, b, c');
    expect(plain(null)).toBe('');
  });
  it('rest heading lines count items, days and past days', () => {
    const base = mkRes();
    const res = mkRes({ everything_else: { ...base.everything_else, count: 52, with_day: 41, past_day: 0, scope_line: null } });
    expect(restHeadingLines(res)).toEqual(['52 other items are counted here. 41 have a day to come back.', 'None is past its day.']);
    const res2 = mkRes({ everything_else: { ...base.everything_else, count: 1, with_day: 1, past_day: 1, scope_line: '4 tasks on unsigned or paused projects are kept as scope, not work.' } });
    expect(restHeadingLines(res2)).toEqual(['1 other item is counted here. 1 has a day to come back.', '1 is past their day.', '4 tasks on unsigned or paused projects are kept as scope, not work.']);
  });
  it('handled detail: keeper line carries details and the undo id, classifier line does not', () => {
    const base = mkRes();
    const res = mkRes({
      sections: { ...base.sections, handled: [
        { id: 'c', text: 'Replied', href: null, at: '', undo_action_id: null, details: [] },
        { id: 'k', text: 'Gave 3 tasks a day', href: null, at: '', undo_action_id: 'a1', details: ['One', 'Two'] },
      ] },
    });
    expect(detailForHandled(res, 'c')!.undoActionId).toBeUndefined();
    const k = detailForHandled(res, 'k')!;
    expect(k.undoActionId).toBe('a1');
    expect(k.lines.slice(1)).toEqual(['One', 'Two']);
  });
});
