import { describe, it, expect } from 'vitest';
import { selectHome } from '../../select';
import { taskKey } from '../../item-key';
import { projectDrawerItems } from '../drawer';
import { IDS, makeProject, makeState, makeTask, makeInputs, tonight, d, NOW } from '../../__tests__/fixtures/tonight';

const TZ = 'America/New_York';

describe('projectDrawerItems', () => {
  it('keeps only items of the one project, in section order, each with a where line', () => {
    const { raw, states, now } = tonight();
    const sel = selectHome({ raw, states, now });
    const grok = projectDrawerItems(sel.candidates, IDS.grokProject, TZ);
    expect(grok.length).toBeGreaterThan(0);
    for (const x of grok) expect(x.item.project?.id).toBe(IDS.grokProject);
    const vcdp = projectDrawerItems(sel.candidates, IDS.vcdpProject, TZ);
    const grokKeys = new Set(grok.map((x) => x.item.key));
    for (const x of vcdp) expect(grokKeys.has(x.item.key)).toBe(false);
    // Needs you now comes before Ready for you.
    const wheres = grok.map((x) => x.where);
    const order = ['Needs you now', 'In progress', 'A lead waiting', 'A client email waiting', 'Ready for you'];
    const idx = wheres.map((w) => (order.includes(w) ? order.indexOf(w) : 99));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('a project with nothing of his gives an empty list', () => {
    const { raw, states, now } = tonight();
    const sel = selectHome({ raw, states, now });
    expect(projectDrawerItems(sel.candidates, 'no-such-project', TZ)).toEqual([]);
  });

  it('a task parked with Not now sits last with its day written out', () => {
    const proj = makeProject('Alpha');
    const a = makeTask({ title: 'Parked one', project: proj, estimated_minutes: 10 });
    const b = makeTask({ title: 'Open one', project: proj, estimated_minutes: 10 });
    const raw = makeInputs({ tasks: [a, b], now: NOW });
    const states = [makeState(taskKey(a.id), { view_at: d('2026-11-12T10:00:00Z'), view_set_by: 'user' })];
    const sel = selectHome({ raw, states, now: NOW });
    const items = projectDrawerItems(sel.candidates, proj.id, TZ);
    expect(items.map((x) => x.item.title)).toEqual(expect.arrayContaining(['Parked one', 'Open one']));
    expect(items[items.length - 1].item.title).toBe('Parked one');
    expect(items[items.length - 1].where).toBe('Back Thursday, November 12');
  });

  it('where lines carry no dash and none of the banned words', () => {
    const { raw, states, now } = tonight();
    const sel = selectHome({ raw, states, now });
    for (const pid of [IDS.grokProject, IDS.vcdpProject]) {
      for (const x of projectDrawerItems(sel.candidates, pid, TZ)) expect(x.where).not.toMatch(/[–—]|priorit|overdue/i);
    }
  });

  it('carries no scoring field on the item', () => {
    const { raw, states, now } = tonight();
    const sel = selectHome({ raw, states, now });
    const text = JSON.stringify(projectDrawerItems(sel.candidates, IDS.grokProject, TZ));
    expect(text).not.toMatch(/"(score|class|klass|urgency|importance|weight)"/);
  });
});
