import { describe, expect, it } from 'vitest';
import { selectHome } from '../../select';
import { taskKey } from '../../item-key';
import { planStagger } from '../stagger';
import { planKeeper } from '../plan';
import { d, makeInputs, makeState, makeTask } from '../../__tests__/fixtures/tonight';
import type { RawItemState, RawTask } from '../../types';

const TZ = 'America/New_York';
/** Wednesday 2026-11-11, 02:35 Eastern. */
const NOW = d('2026-11-11T07:35:00Z');

function chores(n: number): RawTask[] {
  return Array.from({ length: n }, (_, i) => makeTask({ title: `Chore ${i + 1}`, created_at: d(`2026-10-${String(10 + i).padStart(2, '0')}T14:00:00Z`), clock_started_at: d('2026-10-01T14:00:00Z') }));
}

function plan(tasks: RawTask[], states: RawItemState[] = [], now = NOW) {
  const raw = makeInputs({ tasks });
  return planStagger(selectHome({ raw, states, now }), states, now, TZ);
}

describe('planStagger', () => {
  it('gives 3 a business day, no weekend slot, at 00:05 Eastern', () => {
    const p = plan(chores(12));
    expect(p).toHaveLength(12);
    const perDay = new Map<string, number>();
    for (const c of p) perDay.set(c.day, (perDay.get(c.day) ?? 0) + 1);
    expect([...perDay.entries()]).toEqual([
      ['2026-11-11', 3],
      ['2026-11-12', 3],
      ['2026-11-13', 3],
      ['2026-11-16', 3],
    ]);
    expect(p[0].view_at).toBe('2026-11-11T05:05:00.000Z');
    expect(p[11].view_at).toBe('2026-11-16T05:05:00.000Z');
    for (const c of p) expect([0, 6]).not.toContain(new Date(`${c.day}T12:00:00Z`).getUTCDay());
  });

  it('starts on the next business day when the run date is a weekend', () => {
    const p = plan(chores(2), [], d('2026-11-14T12:00:00Z'));
    expect(p.map((c) => c.day)).toEqual(['2026-11-16', '2026-11-16']);
  });

  it('counts his own Not now returns toward the 3 a day', () => {
    const tasks = chores(8);
    const parked = makeTask({ title: 'Parked by him', created_at: d('2026-10-01T14:00:00Z') });
    const states = [makeState(taskKey(parked.id), { view_at: d('2026-11-12T14:00:00Z'), view_set_by: null })];
    const p = plan([...tasks, parked], states);
    const perDay = new Map<string, number>();
    for (const c of p) perDay.set(c.day, (perDay.get(c.day) ?? 0) + 1);
    expect(perDay.get('2026-11-12')).toBe(2);
    expect(p.some((c) => c.item_key === taskKey(parked.id))).toBe(false);
    expect([...perDay.values()].every((n) => n <= 3)).toBe(true);
  });

  it('gives no day to boosted, pinned, held, already-dated or fresh tasks', () => {
    const [boosted, pinned, held, dated, fresh, plain] = chores(6);
    const fr = makeTask({ ...fresh, tags: ['from-chat'], created_at: d('2026-11-10T14:00:00Z') });
    const states = [
      makeState(taskKey(boosted.id), { boosted_at: d('2026-11-10T12:00:00Z') }),
      makeState(taskKey(pinned.id), { working_since: d('2026-11-10T12:00:00Z') }),
      makeState(taskKey(held.id), { keeper_hold_until: d('2026-12-01T00:00:00Z') }),
      makeState(taskKey(dated.id), { view_at: d('2026-11-20T14:00:00Z'), view_set_by: 'keeper' }),
    ];
    const p = plan([boosted, pinned, held, dated, fr, plain], states);
    expect(p.map((c) => c.item_key)).toEqual([taskKey(plain.id)]);
  });

  it('a hold that has run out no longer protects the item', () => {
    const [t] = chores(1);
    const p = plan([t], [makeState(taskKey(t.id), { keeper_hold_until: d('2026-11-01T00:00:00Z') })]);
    expect(p).toHaveLength(1);
  });

  it('is stable: after the days are written, the next night plans nothing and moves nothing', () => {
    const tasks = chores(12);
    const first = plan(tasks);
    const states = first.map((c) => makeState(c.item_key, { view_at: new Date(c.view_at), view_set_by: 'keeper' }));
    const nextNight = d('2026-11-12T07:35:00Z');
    expect(plan(tasks, states, nextNight)).toEqual([]);
    // Two weeks later, with the days all past, the arrived items meet the Next rule and are not given new days.
    expect(plan(tasks, states, d('2026-11-30T07:35:00Z'))).toEqual([]);
  });

  it('a new task after a run takes the first free slot and leaves the others where they were', () => {
    const tasks = chores(4); // Wed 3, Thu 1
    const first = plan(tasks);
    const states = first.map((c) => makeState(c.item_key, { view_at: new Date(c.view_at), view_set_by: 'keeper' }));
    const extra = makeTask({ title: 'Late chore', created_at: d('2026-10-30T14:00:00Z') });
    const p = plan([...tasks, extra], states, d('2026-11-11T20:00:00Z'));
    expect(p).toHaveLength(1);
    expect(p[0].day).toBe('2026-11-12');
  });

  it('after an Undo (hold set, day put back) the next run leaves the item alone', () => {
    const [t] = chores(1);
    const afterUndo = [makeState(taskKey(t.id), { view_at: null, view_set_by: null, keeper_hold_until: d('2026-12-10T00:00:00Z') })];
    expect(plan([t], afterUndo)).toEqual([]);
  });
});

describe('planKeeper', () => {
  it('reads dates first, so a task whose reading makes it urgent is not also given a day', () => {
    const urgent = makeTask({ title: 'Has a near date', created_at: d('2026-10-20T14:00:00Z'), due_date: d('2026-11-12T00:00:00Z') });
    const raw = makeInputs({ tasks: [urgent, ...chores(2)] });
    const p = planKeeper(raw, [], NOW, TZ);
    expect(p.dates.map((x) => x.outcome)).toEqual(['read']);
    expect(p.stagger.some((s) => s.item_key === taskKey(urgent.id))).toBe(false);
    expect(p.counts).toEqual({ stagger: 2, dates_read: 1, dates_set_aside: 0 });
    expect(p.lines.map((l) => l.action)).toEqual(['keeper_stagger', 'keeper_dates']);
  });
});

describe('Slice 3: a task Bast stopped on gets no day and no date reading', () => {
  it('is not in the keeper plan, whatever its date', () => {
    const bast = makeTask({ bot_task: true, tags: ['needs-mike'], due_date: d('2026-11-30T05:00:00Z'), created_at: d('2026-10-01T14:00:00Z'), clock_started_at: d('2026-10-01T14:00:00Z') });
    const raw = makeInputs({ tasks: [bast, ...chores(2)] });
    const p = planKeeper(raw, [], NOW, TZ);
    expect(p.stagger.map((s) => s.item_key)).not.toContain(taskKey(bast.id));
    expect(p.stagger).toHaveLength(2);
    expect(p.dates.map((x) => x.item_key)).not.toContain(taskKey(bast.id));
  });
});
