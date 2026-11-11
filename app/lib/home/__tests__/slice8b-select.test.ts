import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { proposeDay } from '../today';
import { stepKey, taskKey } from '../item-key';
import { inKeeperPool, planStagger } from '../keeper/stagger';
import { projectDrawerItems } from '../projects/drawer';
import { REST_CHECK } from '../copy';
import type { RawHomeInputs, RawItemState, RawProjectStep } from '../types';
import { d, makeClient, makeInputs, makeProject, makeState, makeTask, nextId } from './fixtures/tonight';

// Tuesday 2026-11-10 10:00 Eastern.
const NOW = d('2026-11-10T15:00:00Z');
const TZ = 'America/New_York';

function sel(raw: Partial<RawHomeInputs>, states: RawItemState[] = [], now = NOW) {
  return selectHome({ raw: makeInputs({ now, ...raw }), states, now });
}

function step(over: Partial<RawProjectStep> = {}): RawProjectStep {
  return {
    project_id: nextId(),
    project_name: 'Jack Gaughan Artist Site',
    client: makeClient('Jack Gaughan'),
    text: 'Mike, email Jack to accept the seven pages on the review site.',
    source: 'bast',
    step_at: d('2026-11-10T08:00:00Z'),
    last_activity_at: d('2026-10-20T15:00:00Z'),
    ...over,
  };
}

/** A class 1 task (active client, a requesting contact) whose wait began `daysAgo` days ago: with 12 or more days it reads urgency 80. */
function clientTask(title: string, daysAgo: number) {
  return makeTask({
    title,
    client: makeClient('Some Client'),
    requested_by_contact_id: nextId(),
    clock_started_at: new Date(NOW.getTime() - daysAgo * 86_400_000),
    estimated_minutes: 20,
  });
}

const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe('Slice 8b: a project next step as a row', () => {
  it('shows one row with the words of the plan, no leading "Mike, ", the project and how quiet it is', () => {
    const s = step();
    const r = sel({ project_steps: [s] });
    expect(r.sections.next).toHaveLength(1);
    const item = r.sections.next[0];
    expect(item.key).toBe(stepKey(s.project_id));
    expect(item.type).toBe('step');
    expect(item.title).toBe('Email Jack to accept the seven pages on the review site.');
    expect(item.why_now).toBe('Jack Gaughan Artist Site · quiet 21 days');
    expect(item.actions.map((a) => a.label)).toEqual(['Open the project', 'I did this', 'Not now']);
    expect(item.more_actions.map((a) => a.label)).toEqual(['This matters more']);
    expect(item.reason).toBe('The next step on Jack Gaughan Artist Site is yours.');
    expect(item.default_if_ignored).toBe('Stays here. Bast reads the project again tonight and rewrites this step.');
    expect(item.project?.id).toBe(s.project_id);
    expect(item.source).toMatchObject({ kind: 'step', id: s.project_id });
  });

  it('is never an emergency and never a Today step', () => {
    const s = step();
    const r = sel({ project_steps: [s] });
    const c = r.byKey.get(stepKey(s.project_id))!;
    expect(c.rule).toBeNull();
    expect(r.sections.needs_you_now).toEqual([]);
    expect(r.candidates.filter((x) => x.kind === 'step')).toHaveLength(1);
  });

  it('is hidden while any other item of his for that project is in view (and a parked or waiting one does not count)', () => {
    const s = step();
    const project = makeProject(s.project_name, { id: s.project_id });
    const inView = clientTask('Real task', 14);
    inView.project = project;
    const r = sel({ tasks: [inView], project_steps: [s] });
    expect(r.byKey.has(stepKey(s.project_id))).toBe(false);
    expect(titles(r.sections.next)).toEqual(['Real task']);

    // The same task parked with Not now is not in view, so the step shows.
    const parked = [makeState(taskKey(inView.id), { view_at: d('2026-11-12T14:00:00Z'), view_set_by: 'user', park_count: 1 })];
    const r2 = sel({ tasks: [inView], project_steps: [s] }, parked);
    expect(r2.byKey.has(stepKey(s.project_id))).toBe(true);
    expect(r2.sections.next.map((i) => i.key)).toContain(stepKey(s.project_id));
  });

  it('a task of that project waiting its turn (below the Next bands) does not hide the step', () => {
    const s = step();
    const project = makeProject(s.project_name, { id: s.project_id });
    const quiet = makeTask({ title: 'Low task', project, estimated_minutes: 10 });
    const r = sel({ tasks: [quiet], project_steps: [s] });
    expect(r.byKey.get(quiet ? taskKey(quiet.id) : '')!.section).toBe('rest');
    expect(r.byKey.has(stepKey(s.project_id))).toBe(true);
  });

  it('one row per project even when the loader returns the same project twice', () => {
    const s = step();
    const r = sel({ project_steps: [s, { ...s }] });
    expect(r.candidates.filter((c) => c.kind === 'step')).toHaveLength(1);
  });

  it('I did this hides it for two business days, or until Bast rewrites the step', () => {
    const s = step();
    const doneAt = d('2026-11-10T14:00:00Z'); // Tuesday 9:00
    const st = makeState(stepKey(s.project_id), { step_done_at: doneAt, step_done_text: s.text });
    expect(sel({ project_steps: [s] }, [st]).byKey.has(stepKey(s.project_id))).toBe(false);
    // Wednesday: one business day. Still hidden.
    const wed = d('2026-11-11T20:00:00Z');
    expect(sel({ project_steps: [s] }, [st], wed).byKey.has(stepKey(s.project_id))).toBe(false);
    // Friday: back, same text, so the "still" line.
    const fri = d('2026-11-13T20:00:00Z');
    const back = sel({ project_steps: [s] }, [st], fri).byKey.get(stepKey(s.project_id))!;
    expect(back.item.why_now).toContain('Bast still reads this as the next step.');
    // Rewritten the same day with new text: back at once, no "still".
    const rewritten = { ...s, text: 'Mike, book the launch call with Jack.', step_at: d('2026-11-10T14:30:00Z') };
    const fresh = sel({ project_steps: [rewritten] }, [st]).byKey.get(stepKey(s.project_id))!;
    expect(fresh.item.title).toBe('Book the launch call with Jack.');
    expect(fresh.item.why_now).not.toContain('still');
    // Rewritten but the same text: back with the "still" line.
    const same = { ...s, step_at: d('2026-11-10T14:30:00Z') };
    expect(sel({ project_steps: [same] }, [st]).byKey.get(stepKey(s.project_id))!.item.why_now).toContain('Bast still reads this');
  });

  it('Not now parks it (the usual way) and This matters more brings it to the front', () => {
    const s = step();
    const parked = sel({ project_steps: [s] }, [makeState(stepKey(s.project_id), { view_at: d('2026-11-11T14:00:00Z'), view_set_by: 'user', park_count: 1 })]);
    expect(parked.sections.next).toEqual([]);
    expect(parked.byKey.get(stepKey(s.project_id))!.restGroup).toBe('parked');
    const t = clientTask('Real task', 20);
    const boosted = sel({ tasks: [t], project_steps: [s] }, [makeState(stepKey(s.project_id), { boosted_at: NOW })]);
    expect(boosted.sections.next[0].key).toBe(stepKey(s.project_id));
  });
});

describe('Slice 8b: how step rows rank against his tasks', () => {
  const quietSteps = (n: number, quietDays: number) =>
    Array.from({ length: n }, (_, i) =>
      step({ project_id: nextId(), project_name: `Project ${i + 1}`, last_activity_at: new Date(NOW.getTime() - (quietDays - i) * 86_400_000) }),
    );
  // Urgency 65, 65 and 50 (waiting 9, 6 and 3 business days).
  const threeTasks = () => [clientTask('Task A', 14), clientTask('Task B', 9), clientTask('Task C', 5)];
  const stepsInNext = (r: ReturnType<typeof sel>) => r.sections.next.filter((i) => i.type === 'step');
  const group = (r: ReturnType<typeof sel>) => r.everything_else.groups.find((g) => g.key === 'project_steps');

  it('5 qualifying steps and 3 class 1 tasks: exactly one step is a Next candidate and at least two tasks are visible in the top three', () => {
    const r = sel({ tasks: threeTasks(), project_steps: quietSteps(5, 45) });
    expect(r.candidates.filter((c) => c.kind === 'step' && c.section === 'next')).toHaveLength(1);
    expect(stepsInNext(r)).toHaveLength(1);
    expect(r.sections.next).toHaveLength(3);
    expect(r.sections.next.filter((i) => i.type === 'task').length).toBeGreaterThanOrEqual(2);
    const g = group(r)!;
    expect(g.label).toBe('Project next steps');
    expect(g.count).toBe(4);
    for (const row of g.items) {
      expect(row.check_text).toBe('Shows here one at a time. Bring it forward to see it now.');
      expect(row.can_bring_forward).toBe(true);
    }
  });

  it("a step's urgency is capped, so the one step in Next sorts among his class 1 tasks rather than above them", () => {
    const r = sel({ tasks: threeTasks(), project_steps: quietSteps(5, 60) });
    // Tasks at urgency 65 come ahead of a step capped at 60; the 50 task sits behind it.
    expect(r.sections.next.map((i) => i.type)).toEqual(['task', 'task', 'step']);
  });

  it('the holder is the best step by the normal rank: the one with the oldest clock among equals', () => {
    const steps = quietSteps(3, 60);
    const r = sel({ project_steps: steps });
    expect(stepsInNext(r).map((i) => i.key)).toEqual([stepKey(steps[0].project_id)]);
  });

  it('boosting a second step puts both in Next, in the boosted tier', () => {
    const steps = quietSteps(5, 45);
    const r = sel({ tasks: threeTasks(), project_steps: steps }, [makeState(stepKey(steps[3].project_id), { boosted_at: NOW })]);
    // Both the holder and the boosted step are Next candidates (in view); the boosted one leads, and the cap of 3 cuts the lowest.
    expect(r.candidates.filter((c) => c.kind === 'step' && c.inView)).toHaveLength(2);
    expect(r.sections.next[0].key).toBe(stepKey(steps[3].project_id));
    expect(stepsInNext(r).length).toBeGreaterThanOrEqual(1);
    expect(group(r)!.count + stepsInNext(r).length).toBe(5);
    const free = sel({ project_steps: steps }, [makeState(stepKey(steps[3].project_id), { boosted_at: NOW })]);
    expect(stepsInNext(free)).toHaveLength(2);
    expect(group(free)!.count).toBe(3);
  });

  it('marking the first done lets the next step in; parking it does too', () => {
    const steps = quietSteps(5, 45);
    const first = stepKey(steps[0].project_id);
    const second = stepKey(steps[1].project_id);
    expect(stepsInNext(sel({ project_steps: steps })).map((i) => i.key)).toEqual([first]);
    const done = makeState(first, { step_done_at: NOW, step_done_text: steps[0].text });
    expect(stepsInNext(sel({ project_steps: steps }, [done])).map((i) => i.key)).toEqual([second]);
    const parked = makeState(first, { view_at: d('2026-11-11T14:00:00Z'), view_set_by: 'user', park_count: 1 });
    expect(stepsInNext(sel({ project_steps: steps }, [parked])).map((i) => i.key)).toEqual([second]);
  });

  it('the drawer counts add up: shown steps plus the group are every qualifying step, and Everything else counts them once', () => {
    const steps = quietSteps(5, 45);
    const r = sel({ tasks: threeTasks(), project_steps: steps }, [makeState(stepKey(steps[2].project_id), { boosted_at: NOW })]);
    const shown = stepsInNext(r).length;
    const inGroup = group(r)?.count ?? 0;
    expect(shown + inGroup).toBe(5);
    expect(group(r)!.items).toHaveLength(inGroup);
    const total = r.everything_else.groups.reduce((n, g) => n + g.count, 0);
    expect(r.everything_else.count).toBe(total);
  });

  it('a step for a client that is not active never enters Next by itself and says so', () => {
    const s = step({ client: makeClient('Dormant Co', { status: 'inactive' }) });
    const r = sel({ project_steps: [s] });
    expect(r.sections.next).toEqual([]);
    const row = group(r)!.items[0];
    expect(row.check_text).toBe(REST_CHECK.stepHeld);
    expect(row.can_bring_forward).toBe(true);
  });

  it('does not change the order or the slots of tasks when the steps are all behind them', () => {
    const tasks = [clientTask('Task A', 20), clientTask('Task B', 18), clientTask('Task C', 16)];
    const without = sel({ tasks });
    const withSteps = sel({ tasks, project_steps: quietSteps(5, 45) });
    expect(withSteps.sections.next.map((i) => i.key)).toEqual(without.sections.next.map((i) => i.key));
  });
});

describe('Slice 8b: the keeper, Today and the drawer never see a step', () => {
  it('the keeper pool is tasks only: a step in any group is not in it and is never given a day', () => {
    const waiting = quietStepsForKeeper();
    const r = sel({ project_steps: waiting.steps, tasks: waiting.tasks });
    for (const c of r.candidates.filter((x) => x.kind === 'step')) expect(inKeeperPool(c, NOW)).toBe(false);
    const changes = planStagger(r, [], NOW, TZ);
    expect(changes.every((ch) => !ch.item_key.startsWith('step:'))).toBe(true);
  });

  it("the project drawer lists his items, not the project's own next step row", () => {
    const s = step();
    const r = sel({ project_steps: [s] });
    expect(projectDrawerItems(r.candidates, s.project_id, TZ)).toEqual([]);
  });

  it('Today never proposes a step as a step, a group or Quick', () => {
    const s = step();
    const r = sel({ project_steps: [s] });
    expect(proposeDay(r, [], NOW)).toBeNull();
    // With a real task around, the day is built from the task only.
    const t = makeTask({ title: 'Plain', estimated_minutes: 10 });
    const day = proposeDay(sel({ tasks: [t], project_steps: [s] }), [], NOW);
    const keys = [...(day?.quick_item_keys ?? []), ...(day?.step_item_keys ?? [])];
    expect(keys.some((k) => k.startsWith('step:'))).toBe(false);
  });
});

function quietStepsForKeeper() {
  const steps = [
    step({ project_name: 'In Next', last_activity_at: d('2026-10-01T15:00:00Z') }),
    step({ project_name: 'Held', client: makeClient('Dormant', { status: 'inactive' }) }),
    step({ project_name: 'Another', last_activity_at: d('2026-10-05T15:00:00Z') }),
    step({ project_name: 'Another2', last_activity_at: d('2026-10-06T15:00:00Z') }),
    step({ project_name: 'Another3', last_activity_at: d('2026-10-07T15:00:00Z') }),
  ];
  const tasks = Array.from({ length: 6 }, (_, i) => makeTask({ title: `Plain ${i}`, estimated_minutes: 10 }));
  return { steps, tasks };
}
