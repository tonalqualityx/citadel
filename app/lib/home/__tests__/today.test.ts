import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import {
  applyArcMembership,
  applyEmergencyInsert,
  assembleHomeResponse,
  buildToday,
  dayForGroup,
  freeMinutes,
  proposeDay,
} from '../today';
import { arcGroupKey, clientGroupKey, projectGroupKey, taskKey } from '../item-key';
import type { RawCalendarEvent, RawHomeInputs, RawItemState } from '../types';
import { OWN_GROUP_KEY } from '../item-key';
import { NOW, d, makeArc, makeAsk, makeClient, makeInputs, makeProject, makeSession, makeState, makeTask } from './fixtures/tonight';

function build(raw: Partial<RawHomeInputs>, states: RawItemState[] = []) {
  const full = makeInputs({ now: NOW, ...raw });
  const sel = selectHome({ raw: full, states, now: NOW });
  const day = proposeDay(sel, full.calendar_events, NOW);
  return { sel, day, raw: full };
}

const ev = (startZ: string, endZ: string, all_day = false): RawCalendarEvent => ({
  id: startZ,
  title: 'Meeting',
  starts_at: d(startZ),
  ends_at: d(endZ),
  all_day,
});

/** A task a client has waited on: in view, class 1, urgency set by `since`. */
const waiting = (client: ReturnType<typeof makeClient>, since: string, over = {}) =>
  makeTask({ client, requested_by_contact_id: 'c', clock_started_at: d(since), created_at: d(since), ...over });

describe('freeMinutes (New York, 10:00 to 17:00, 30 minutes after each meeting)', () => {
  // Monday 2026-11-09 is Eastern Standard Time: 10:00 = 15:00Z, 17:00 = 22:00Z.
  it('no events: 420', () => expect(freeMinutes([], NOW)).toBe(420));
  it('a meeting costs its time plus 30 minutes', () => {
    expect(freeMinutes([ev('2026-11-09T16:00:00Z', '2026-11-09T17:00:00Z')], NOW)).toBe(420 - 90);
  });
  it('overlapping meetings and recoveries are merged, not added twice', () => {
    const events = [ev('2026-11-09T16:00:00Z', '2026-11-09T17:00:00Z'), ev('2026-11-09T17:15:00Z', '2026-11-09T18:00:00Z')];
    // busy 11:00 to 13:30 (recovery of the second runs to 13:30; the first recovery overlaps its start)
    expect(freeMinutes(events, NOW)).toBe(420 - 150);
  });
  it('all-day events are ignored', () => {
    expect(freeMinutes([ev('2026-11-09T05:00:00Z', '2026-11-10T05:00:00Z', true)], NOW)).toBe(420);
  });
  it('a meeting before the window costs only the recovery that reaches into it', () => {
    expect(freeMinutes([ev('2026-11-09T14:00:00Z', '2026-11-09T14:50:00Z')], NOW)).toBe(420 - 20);
    expect(freeMinutes([ev('2026-11-09T13:00:00Z', '2026-11-09T14:00:00Z')], NOW)).toBe(420);
  });
  it('a meeting running past 17:00 is clipped', () => {
    expect(freeMinutes([ev('2026-11-09T21:30:00Z', '2026-11-09T23:00:00Z')], NOW)).toBe(420 - 30);
  });
  it('never goes below 0', () => {
    expect(freeMinutes([ev('2026-11-09T14:00:00Z', '2026-11-09T23:00:00Z')], NOW)).toBe(0);
  });
});

describe('the arc: which group, how many steps', () => {
  it('the highest-ranked item decides the group: its client', () => {
    const a = makeClient('Client A');
    const b = makeClient('Client B');
    const ta = waiting(a, '2026-10-12T14:00:00Z');
    const tb = waiting(b, '2026-11-04T14:00:00Z');
    const { day } = build({ tasks: [tb, ta] });
    expect(day?.group_key).toBe(clientGroupKey(a.id));
    expect(day?.group_label).toBe('Client A');
    expect(day?.arc_id).toBeNull();
    expect(day?.step_item_keys).toEqual([taskKey(ta.id)]);
  });

  it('a task in an open arc makes the arc the group, with all its open tasks and in-view items for the same client', () => {
    const c = makeClient('Gene Co');
    const arc = makeArc('Gene asks', { client_id: c.id });
    const inArc1 = waiting(c, '2026-10-12T14:00:00Z', { arc });
    const inArcQuiet = makeTask({ client: c, arc, created_at: d('2026-11-09T14:00:00Z') }); // not in view, still an arc task
    const sameClient = waiting(c, '2026-11-02T14:00:00Z');
    const otherClient = waiting(makeClient('Other'), '2026-11-02T14:00:00Z');
    const { day } = build({ tasks: [inArc1, inArcQuiet, sameClient, otherClient] });
    expect(day?.group_key).toBe(arcGroupKey(arc.id));
    expect(day?.arc_id).toBe(arc.id);
    expect(new Set(day?.step_item_keys)).toEqual(new Set([taskKey(inArc1.id), taskKey(inArcQuiet.id), taskKey(sameClient.id)]));
  });

  it('a closed or snoozed arc is ignored and the client is the group', () => {
    const c = makeClient('Gene Co');
    const closed = makeArc('Old', { client_id: c.id, closed_at: d('2026-11-01T00:00:00Z') });
    const snoozed = makeArc('Later', { client_id: c.id, snoozed_until: d('2026-11-20T00:00:00Z') });
    expect(build({ tasks: [waiting(c, '2026-10-12T14:00:00Z', { arc: closed })] }).day?.group_key).toBe(clientGroupKey(c.id));
    expect(build({ tasks: [waiting(c, '2026-10-12T14:00:00Z', { arc: snoozed })] }).day?.group_key).toBe(clientGroupKey(c.id));
  });

  it('no client: the project; no project: "Indelible" own work', () => {
    const p = makeProject('Site');
    const onProject = makeTask({ project: p, promised_to: 'X', due_date: d('2026-11-13T00:00:00.000Z') });
    expect(build({ tasks: [onProject] }).day?.group_key).toBe(projectGroupKey(p.id));
    const own = makeTask({ promised_to: 'X', due_date: d('2026-11-13T00:00:00.000Z') });
    const r = build({ tasks: [own] }).day;
    expect(r?.group_key).toBe(OWN_GROUP_KEY);
    expect(r?.group_label).toBe('Indelible');
  });

  it('proposes at most 4 steps', () => {
    const c = makeClient('Busy Co');
    const tasks = [0, 1, 2, 3, 4, 5].map((n) => waiting(c, `2026-10-1${n}T14:00:00Z`, { estimated_minutes: 20 }));
    expect(build({ tasks }).day?.step_item_keys).toHaveLength(4);
  });

  it('nothing in view: no day', () => {
    expect(build({}).day).toBeNull();
    expect(build({ tasks: [makeTask()] }).day).toBeNull();
  });
});

describe('his hand on the arc', () => {
  const c = makeClient('Hand Co');
  const base = () => [0, 1, 2, 3, 4].map((n) => waiting(c, `2026-10-1${n}T14:00:00Z`, { estimated_minutes: 20 }));
  const gk = clientGroupKey(c.id);

  it('a step he added stays, is not counted against the 4, and need not be in view', () => {
    const tasks = base();
    const mine = makeTask({ title: 'Mine', estimated_minutes: 20 }); // nobody waits: not in view
    const { day } = build({ tasks: [...tasks, mine] }, [
      makeState(taskKey(mine.id), { arc_added_at: d('2026-11-08T10:00:00Z'), arc_added_group: gk }),
    ]);
    expect(day?.step_item_keys).toHaveLength(5);
    expect(day?.step_item_keys.at(-1)).toBe(taskKey(mine.id));
  });

  it('an added step is only counted for the group it was added to', () => {
    const tasks = base();
    const mine = makeTask({ estimated_minutes: 20 });
    const { day } = build({ tasks: [...tasks, mine] }, [
      makeState(taskKey(mine.id), { arc_added_at: d('2026-11-08T10:00:00Z'), arc_added_group: 'client:00000000-0000-4000-8000-0000000000ff' }),
    ]);
    expect(day?.step_item_keys).not.toContain(taskKey(mine.id));
  });

  it('a step he removed stays out for 7 days, then comes back', () => {
    const tasks = base();
    const removed = tasks[0];
    const within = build({ tasks }, [
      makeState(taskKey(removed.id), { arc_removed_at: d('2026-11-03T14:00:00Z'), arc_removed_group: gk }),
    ]);
    expect(within.day?.step_item_keys).not.toContain(taskKey(removed.id));
    const after = build({ tasks }, [
      makeState(taskKey(removed.id), { arc_removed_at: d('2026-11-02T14:00:00Z'), arc_removed_group: gk }),
    ]);
    expect(after.day?.step_item_keys).toContain(taskKey(removed.id));
  });

  it('a parked step leaves the day', () => {
    const tasks = base();
    const { day } = build({ tasks }, [makeState(taskKey(tasks[0].id), { view_at: d('2026-11-10T14:00:00Z'), park_count: 1 })]);
    expect(day?.step_item_keys).not.toContain(taskKey(tasks[0].id));
  });
});

describe('size of the day', () => {
  const c = makeClient('Size Co');
  const gk = clientGroupKey(c.id);
  it('steps are cut from the end until the day fits, never below one', () => {
    const tasks = [0, 1, 2, 3].map((n) => waiting(c, `2026-10-1${n}T14:00:00Z`, { estimated_minutes: 150 }));
    const { day } = build({ tasks });
    expect(day?.step_item_keys).toHaveLength(2); // 4 x 150 = 600 > 420; 3 x 150 = 450 > 420; 2 x 150 = 300
    expect(day?.sized_minutes).toBe(300);
    const huge = build({ tasks: [waiting(c, '2026-10-12T14:00:00Z', { estimated_minutes: 900 })] });
    expect(huge.day?.step_item_keys).toHaveLength(1);
  });

  it('a meeting-heavy day keeps fewer steps', () => {
    const tasks = [0, 1, 2, 3].map((n) => waiting(c, `2026-10-1${n}T14:00:00Z`, { estimated_minutes: 60 }));
    const none = build({ tasks });
    expect(none.day?.step_item_keys).toHaveLength(4);
    const busy = build({ tasks, calendar_events: [ev('2026-11-09T15:00:00Z', '2026-11-09T19:00:00Z')] }); // 4 h + 30 = 270 free-> 150
    expect(busy.day?.step_item_keys).toHaveLength(2);
  });

  it('steps he added are never cut; the line says so when they overflow', () => {
    const tasks = [0, 1].map((n) => waiting(c, `2026-10-1${n}T14:00:00Z`, { estimated_minutes: 60 }));
    const mine1 = makeTask({ estimated_minutes: 240 });
    const mine2 = makeTask({ estimated_minutes: 240 });
    const states = [mine1, mine2].map((t, i) =>
      makeState(taskKey(t.id), { arc_added_at: d(`2026-11-08T1${i}:00:00Z`), arc_added_group: gk }),
    );
    const { sel, day } = build({ tasks: [...tasks, mine1, mine2] }, states);
    expect(day?.step_item_keys).toEqual(expect.arrayContaining([taskKey(mine1.id), taskKey(mine2.id)]));
    const today = buildToday(sel, day!, [], NOW)!;
    expect(today.added_keys.sort()).toEqual([taskKey(mine1.id), taskKey(mine2.id)].sort());
    expect(today.size_line).toBe('About 8 hours, more than today has free');
  });

  it('the size line is plain words when it fits', () => {
    const { sel, day } = build({ tasks: [waiting(c, '2026-10-12T14:00:00Z', { estimated_minutes: 110 })] });
    expect(buildToday(sel, day!, [], NOW)?.size_line).toBe('About 1 hour 50 minutes');
  });
});

describe('Quick', () => {
  it('emergencies outside the arc come first, then short in-view items with a person waiting or a hard date', () => {
    const c = makeClient('Arc Co');
    const arcTask = makeTask({ tags: ['security'], client: c, site_id: 's', estimated_minutes: 30 });
    const emergency = makeTask({ tags: ['lifeline'], estimated_minutes: 10 });
    const shortWithPerson = waiting(makeClient('P1 Co'), '2026-11-04T14:00:00Z', { estimated_minutes: 8 });
    const shortWithDate = makeTask({ promised_to: 'Y', due_date: d('2026-11-13T00:00:00.000Z'), estimated_minutes: 5 });
    const longWithPerson = waiting(makeClient('P2 Co'), '2026-10-20T14:00:00Z', { estimated_minutes: 45 });
    const shortNoReason = makeTask({ estimated_minutes: 5, open_blocking_count: 3, promised_to: 'Z', clock_started_at: d('2026-10-20T14:00:00Z') });
    const { day } = build({ tasks: [arcTask, emergency, shortWithPerson, shortWithDate, longWithPerson, shortNoReason] });
    expect(day?.group_key).toBe(clientGroupKey(c.id));
    expect(day?.quick_item_keys[0]).toBe(taskKey(emergency.id));
    expect(day?.quick_item_keys).toContain(taskKey(shortWithPerson.id));
    expect(day?.quick_item_keys).toContain(taskKey(shortWithDate.id));
    expect(day?.quick_item_keys).not.toContain(taskKey(longWithPerson.id));
    expect(day?.quick_item_keys).not.toContain(taskKey(shortNoReason.id));
    expect(day!.quick_item_keys.length).toBeLessThanOrEqual(3);
  });

  it('is capped at 3', () => {
    const c = makeClient('Arc Co');
    const arcTask = makeTask({ tags: ['security'], client: c, site_id: 's', estimated_minutes: 30 });
    const shorts = [0, 1, 2, 3, 4].map((n) =>
      waiting(makeClient(`Short ${n}`), `2026-11-0${n + 1}T14:00:00Z`, { estimated_minutes: 5 }),
    );
    expect(build({ tasks: [arcTask, ...shorts] }).day?.quick_item_keys).toHaveLength(3);
  });

  it('an emergency inside the arc stays a step, not a quick row', () => {
    const c = makeClient('Grok');
    const sec = makeTask({ tags: ['security'], client: c, site_id: 's', estimated_minutes: 40 });
    const { day } = build({ tasks: [sec] });
    expect(day?.step_item_keys).toEqual([taskKey(sec.id)]);
    expect(day?.quick_item_keys).toEqual([]);
  });
});

describe('applyEmergencyInsert and stability', () => {
  it('a new emergency lands at the top of Quick; steps and the rest of Quick do not move', () => {
    const c = makeClient('Arc Co');
    const arcTasks = [0, 1].map((n) => waiting(c, `2026-10-0${n + 1}T14:00:00Z`, { estimated_minutes: 30 }));
    const short = makeTask({ promised_to: 'X', clock_started_at: d('2026-11-04T14:00:00Z'), estimated_minutes: 5 });
    const first = build({ tasks: [...arcTasks, short] });
    const stored = first.day!;
    // Later load: a new emergency appears.
    const fresh = makeTask({ tags: ['lifeline'], estimated_minutes: 10 });
    const later = selectHome({ raw: makeInputs({ now: NOW, tasks: [...arcTasks, short, fresh] }), states: [], now: NOW });
    const today = buildToday(later, stored, [], NOW)!;
    expect(today.quick.map((i) => i.key)).toEqual([taskKey(fresh.id), ...stored.quick_item_keys]);
    expect(today.steps.map((i) => i.key)).toEqual(stored.step_item_keys);
    expect(today.group_key).toBe(stored.group_key);
  });

  it('no duplicates, and Quick stays at 3', () => {
    const c = makeClient('Arc Co');
    const arcTask = waiting(c, '2026-10-01T14:00:00Z');
    const e1 = makeTask({ tags: ['lifeline'], estimated_minutes: 10 });
    const e2 = makeTask({ tags: ['lifeline'], estimated_minutes: 10 });
    const e3 = makeTask({ tags: ['lifeline'], estimated_minutes: 10 });
    const sel = selectHome({ raw: makeInputs({ now: NOW, tasks: [arcTask, e1, e2, e3] }), states: [], now: NOW });
    const out = applyEmergencyInsert([taskKey(e1.id), 'x'], [taskKey(arcTask.id)], sel.candidates);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    expect(out).toContain(taskKey(e1.id));
    expect(out).toContain(taskKey(e2.id));
  });

  it('items done, gone or parked since the day was written drop out; nothing left gives null', () => {
    const c = makeClient('Arc Co');
    const a = waiting(c, '2026-10-01T14:00:00Z');
    const b = waiting(c, '2026-10-02T14:00:00Z');
    const { day } = build({ tasks: [a, b] });
    const afterDone = selectHome({ raw: makeInputs({ now: NOW, tasks: [b] }), states: [], now: NOW });
    expect(buildToday(afterDone, day!, [], NOW)?.steps.map((s) => s.key)).toEqual([taskKey(b.id)]);
    const afterParked = selectHome({
      raw: makeInputs({ now: NOW, tasks: [a, b] }),
      states: [makeState(taskKey(a.id), { view_at: d('2026-11-10T14:00:00Z'), park_count: 1 })],
      now: NOW,
    });
    expect(buildToday(afterParked, day!, [], NOW)?.steps.map((s) => s.key)).toEqual([taskKey(b.id)]);
    const empty = selectHome({ raw: makeInputs({ now: NOW }), states: [], now: NOW });
    expect(buildToday(empty, day!, [], NOW)).toBeNull();
  });
});

describe('Swap and Lighter', () => {
  const a = makeClient('Alpha');
  const b = makeClient('Bravo');
  const c = makeClient('Charlie');
  const e = makeClient('Echo');
  const tasks = () => [
    waiting(a, '2026-10-12T14:00:00Z', { estimated_minutes: 90 }), // top, 90
    waiting(b, '2026-10-26T14:00:00Z', { estimated_minutes: 45 }), // 80
    waiting(c, '2026-11-02T14:00:00Z', { estimated_minutes: 20, title: 'Charlie work' }), // 65
    waiting(e, '2026-11-04T14:00:00Z', { estimated_minutes: 60 }), // 50
  ];

  it('swap offers the next two groups by their top item, each with a reason and minutes', () => {
    const { sel, day } = build({ tasks: tasks() });
    expect(day?.group_key).toBe(clientGroupKey(a.id));
    const today = buildToday(sel, day!, [], NOW)!;
    expect(today.swap.map((s) => s.name)).toEqual(['Bravo', 'Charlie']);
    expect(today.swap[0]).toMatchObject({ group_key: clientGroupKey(b.id), minutes: 45, effort: 'About 45 minutes' });
    expect(today.swap[0].why).toBe('Bravo has waited 14 days');
  });

  it('lighter is the group with the fewest minutes at the same or higher consequence', () => {
    const { sel, day } = build({ tasks: tasks() });
    const today = buildToday(sel, day!, [], NOW)!;
    expect(today.lighter).toMatchObject({ name: 'Charlie', minutes: 20 });
  });

  it('lighter never goes to a less consequential group, and is null when nothing is lighter', () => {
    const low = makeTask({ open_blocking_count: 1, promised_to: 'X', clock_started_at: d('2026-10-01T14:00:00Z'), estimated_minutes: 5 }); // class 3
    const top = waiting(a, '2026-10-12T14:00:00Z', { estimated_minutes: 90 });
    const r = build({ tasks: [top, low] });
    expect(buildToday(r.sel, r.day!, [], NOW)?.lighter).toBeNull();
    const heavy = build({ tasks: [waiting(a, '2026-10-12T14:00:00Z', { estimated_minutes: 20 }), waiting(b, '2026-10-26T14:00:00Z', { estimated_minutes: 90 })] });
    expect(buildToday(heavy.sel, heavy.day!, [], NOW)?.lighter).toBeNull();
  });

  it('does not offer a group for the same client as today, nor items already in Quick', () => {
    const arc = makeArc('Alpha arc', { client_id: a.id });
    const inArc = waiting(a, '2026-10-12T14:00:00Z', { arc, estimated_minutes: 30 });
    const alphaLoose = waiting(a, '2026-11-02T14:00:00Z', { estimated_minutes: 30 });
    const quickOne = makeTask({ client: b, promised_to: 'X', clock_started_at: d('2026-10-26T14:00:00Z'), estimated_minutes: 5 });
    const { sel, day } = build({ tasks: [inArc, alphaLoose, quickOne] });
    const today = buildToday(sel, day!, [], NOW)!;
    expect(today.quick.map((q) => q.key)).toContain(taskKey(quickOne.id));
    expect(today.swap).toEqual([]);
  });

  it('dayForGroup rewrites the day to the chosen group, keeps Quick, and refuses an unknown group', () => {
    const { sel, day } = build({ tasks: tasks() });
    const swapped = dayForGroup(sel, clientGroupKey(b.id), day!, [], NOW)!;
    expect(swapped.group_key).toBe(clientGroupKey(b.id));
    expect(swapped.group_label).toBe('Bravo');
    expect(swapped.quick_item_keys).toEqual(day!.quick_item_keys);
    expect(swapped.step_item_keys).toHaveLength(1);
    expect(swapped.sized_minutes).toBe(45);
    expect(dayForGroup(sel, clientGroupKey('00000000-0000-4000-8000-0000000000ee'), day!, [], NOW)).toBeNull();
  });
});

describe('assembleHomeResponse', () => {
  it('fills the date line, the empty sentences and the user id, and has no Today when nothing is in view', () => {
    const { sel } = build({});
    const r = assembleHomeResponse({ sel, day: null, calendar: [], now: NOW, timezone: 'America/New_York', user_id: 'u1' });
    expect(r.date).toBe('2026-11-09');
    expect(r.screen_date_line).toBe('Monday, November 9');
    expect(r.timezone).toBe('America/New_York');
    expect(r.user_id).toBe('u1');
    expect(r.today).toBeNull();
    expect(r.empty.needs_you_now).toBe('Nothing urgent.');
    expect(r.empty.projects).toBe('No active projects.');
    expect(r.generated_at).toBe(NOW.toISOString());
  });

  it('uses the date in his zone: just after midnight UTC is still the evening before in New York', () => {
    const { sel } = build({});
    const r = assembleHomeResponse({ sel, day: null, calendar: [], now: d('2026-11-10T02:30:00Z'), timezone: 'America/New_York', user_id: 'u' });
    expect(r.date).toBe('2026-11-09');
    expect(r.screen_date_line).toBe('Monday, November 9');
  });

  it('steps offer "Remove from arc"; the same item elsewhere does not offer "Add to today\'s arc" again', () => {
    const c = makeClient('Arc Co');
    const t = waiting(c, '2026-10-01T14:00:00Z');
    const { sel, day, raw } = build({ tasks: [t] });
    const r = assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now: NOW, timezone: 'America/New_York', user_id: 'u' });
    const step = r.today!.steps[0];
    expect(step.more_actions.map((a) => a.id)).toContain('remove_from_arc');
    expect(step.more_actions.map((a) => a.id)).not.toContain('add_to_arc');
    const inNext = r.sections.next.find((i) => i.key === step.key)!;
    expect(inNext.more_actions.map((a) => a.id)).not.toContain('add_to_arc');
    // Without Today, the Next row still offers it.
    expect(sel.sections.next[0].more_actions.map((a) => a.id)).toContain('add_to_arc');
    expect(applyArcMembership(sel.sections, null)).toBe(sel.sections);
  });

  it('a step that is in no list says whose step it is', () => {
    const c = makeClient('Arc Co');
    const top = waiting(c, '2026-10-01T14:00:00Z');
    const quiet = makeTask({ client: c, arc: undefined as never });
    const arc = makeArc('Arc Co arc', { client_id: c.id });
    top.arc = arc;
    quiet.arc = arc;
    const { sel, day } = build({ tasks: [top, quiet] });
    const today = buildToday(sel, day!, [], NOW)!;
    const q = today.steps.find((s) => s.key === taskKey(quiet.id))!;
    expect(q.reason).toBe('One of the open steps for Arc Co arc.');
  });

  it('a pinned item stays visible in Today', () => {
    const c = makeClient('Arc Co');
    const t = waiting(c, '2026-10-01T14:00:00Z');
    const { sel, day } = build({ tasks: [t] }, [makeState(taskKey(t.id), { working_since: NOW })]);
    expect(buildToday(sel, day!, [], NOW)?.steps[0].pinned).toBe(true);
  });

  it('a session ask in an open arc joins that arc', () => {
    const c = makeClient('Arc Co');
    const arc = makeArc('Arc Co arc', { client_id: c.id });
    const t = waiting(c, '2026-10-01T14:00:00Z', { arc });
    const s = makeSession({ arc, client: c });
    const { day } = build({ tasks: [t], session_asks: [s] });
    expect(day?.step_item_keys).toHaveLength(2);
  });

  it('keeps an unrelated email thread out of a client group unless it is that client', () => {
    const c = makeClient('Arc Co');
    const t = waiting(c, '2026-10-01T14:00:00Z');
    const mail = { account: 'a', thread_id: 't1', asks: [makeAsk({ client: makeClient('Someone else'), received_at: d('2026-10-01T14:00:00Z') })] };
    const { day } = build({ tasks: [t], threads: [mail] });
    expect(day?.step_item_keys).toEqual([taskKey(t.id)]);
  });
});
