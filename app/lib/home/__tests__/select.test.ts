import { describe, it, expect } from 'vitest';
import { meetsNextRule, selectHome, threadStatus } from '../select';
import { crisisKey, reviewKey, sessionKey, taskKey, threadKey, waitKey } from '../item-key';
import type { RawHomeInputs, RawItemState } from '../types';
import {
  NOW,
  d,
  makeAsk,
  makeClient,
  makeFold,
  makeInputs,
  makeProject,
  makeSession,
  makeState,
  makeTask,
  makeThread,
  makeWait,
} from './fixtures/tonight';

function sel(raw: Partial<RawHomeInputs>, states: RawItemState[] = []) {
  return selectHome({ raw: makeInputs({ now: NOW, ...raw }), states, now: NOW });
}
const keys = (items: { key: string }[]) => items.map((i) => i.key);
const active = makeClient('Active Co');
/** A task a client is waiting on, old enough to enter Next. */
const clientTask = (over = {}) =>
  makeTask({ client: active, requested_by_contact_id: 'c', clock_started_at: d('2026-11-02T14:00:00Z'), ...over });

describe('threadStatus', () => {
  const draft = 'https://mail.google.com/draft/1';
  const old = d('2026-11-02T15:00:00Z');
  it('a known person (client, draft or sales) that is old enough shows', () => {
    expect(threadStatus(makeThread({ client: active, received_at: old }), NOW)).toBe('show');
    expect(threadStatus(makeThread({ draft_url: draft, received_at: old }), NOW)).toBe('show');
    expect(threadStatus(makeThread({ intent: 'sales', received_at: old }), NOW)).toBe('show');
  });
  it('an unknown person does not qualify', () => {
    expect(threadStatus(makeThread({ received_at: old }), NOW)).toBe('no');
  });
  it('own addresses, automated senders, noise and calendar replies never qualify', () => {
    const base = { client: active, received_at: old };
    expect(threadStatus(makeThread({ ...base, from_email: 'Mike <mike@becomeindelible.com>' }), NOW)).toBe('no');
    expect(threadStatus(makeThread({ ...base, from_email: 'noreply@vendor.example' }), NOW)).toBe('no');
    expect(threadStatus(makeThread({ ...base, from_email: 'pat@collectiveyouth.com' }), NOW)).toBe('no');
    expect(threadStatus(makeThread({ ...base, subject: 'Accepted: Weekly call' }), NOW)).toBe('no');
    expect(threadStatus(makeThread({ intent: 'sales', client: makeClient('Balloon Guild'), received_at: old }), NOW)).toBe('no');
  });
  it('under one business day old is young, except a sales thread, which shows from the first minute', () => {
    const fresh = d('2026-11-09T20:00:00Z');
    expect(threadStatus(makeThread({ client: active, received_at: fresh }), NOW)).toBe('young');
    expect(threadStatus(makeThread({ intent: 'sales', received_at: fresh }), NOW)).toBe('show');
  });
  it('21 calendar days is the edge: 21 shows, 22 is an older open thread', () => {
    expect(threadStatus(makeThread({ client: active, received_at: d('2026-10-19T15:00:00Z') }), NOW)).toBe('show');
    expect(threadStatus(makeThread({ client: active, received_at: d('2026-10-18T15:00:00Z') }), NOW)).toBe('older');
  });
});

describe('placement', () => {
  it('an emergency task goes to Needs you now, whatever its view_at says', () => {
    const t = makeTask({ tags: ['security'], site_id: 's', client: active });
    const r = sel({ tasks: [t] }, [makeState(taskKey(t.id), { view_at: d('2026-12-01T00:00:00Z') })]);
    expect(keys(r.sections.needs_you_now)).toEqual([taskKey(t.id)]);
    expect(r.sections.needs_you_now[0].type).toBe('emergency');
  });

  it('"Not an emergency" drops it out of Needs you now and ranks it like any other', () => {
    const t = makeTask({ tags: ['security'], site_id: 's', client: active, requested_by_contact_id: 'c', clock_started_at: d('2026-11-02T14:00:00Z') });
    const r = sel({ tasks: [t] }, [makeState(taskKey(t.id), { not_emergency_at: NOW })]);
    expect(r.sections.needs_you_now).toEqual([]);
    expect(keys(r.sections.next)).toEqual([taskKey(t.id)]);
    expect(r.sections.next[0].type).toBe('task');
  });

  it('Needs you now orders client-facing first, then the nearest hard date, then the oldest', () => {
    const noClientDate = makeTask({ tags: ['job-watch'], due_date: d('2026-11-12T00:00:00.000Z') });
    const noClientLaterDate = makeTask({ tags: ['job-watch'], due_date: d('2026-11-20T00:00:00.000Z') });
    const clientFacing = makeTask({ tags: ['client-blocking'], client: active });
    const noDate = makeTask({ tags: ['client-blocking'], created_at: d('2026-10-01T00:00:00Z'), clock_started_at: d('2026-10-01T00:00:00Z') });
    const r = sel({ tasks: [noDate, noClientLaterDate, clientFacing, noClientDate] });
    expect(keys(r.sections.needs_you_now)).toEqual([
      taskKey(clientFacing.id),
      taskKey(noClientDate.id),
      taskKey(noClientLaterDate.id),
      taskKey(noDate.id),
    ]);
  });

  it('a parked item leaves view and is counted as "Parked by you" until its view_at', () => {
    const t = clientTask();
    const parked = sel({ tasks: [t] }, [makeState(taskKey(t.id), { park_count: 1, view_at: d('2026-11-10T14:00:00Z') })]);
    expect(parked.sections.next).toEqual([]);
    expect(parked.everything_else.groups).toEqual([expect.objectContaining({ key: 'parked', count: 1 })]);
    const back = sel({ tasks: [t] }, [makeState(taskKey(t.id), { park_count: 1, view_at: d('2026-11-09T14:00:00Z') })]);
    expect(keys(back.sections.next)).toEqual([taskKey(t.id)]);
  });

  it('a task nobody is waiting on stays out of Next and is counted as waiting its turn', () => {
    const t = makeTask({ client: active });
    const r = sel({ tasks: [t] });
    expect(r.sections.next).toEqual([]);
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'waiting_turn', count: 1 })]);
  });

  it('Next qualifies class 1 at urgency 30, class 2 or 3 at urgency 50', () => {
    const c1low = makeTask({ client: active, requested_by_contact_id: 'c', clock_started_at: d('2026-11-09T14:00:00Z') });
    const c1ok = clientTask({ clock_started_at: d('2026-11-06T14:00:00Z') }); // 1 business day: 30
    const c3low = makeTask({ open_blocking_count: 1, promised_to: 'X', clock_started_at: d('2026-11-06T14:00:00Z') }); // class 3, urgency 30
    const c3ok = makeTask({ open_blocking_count: 1, promised_to: 'X', clock_started_at: d('2026-11-04T14:00:00Z') }); // 50
    const r = sel({ tasks: [c1low, c1ok, c3low, c3ok] });
    expect(new Set(keys(r.sections.next))).toEqual(new Set([taskKey(c1ok.id), taskKey(c3ok.id)]));
  });

  it('Next shows 3, ordered by class then urgency then oldest; the rest wait their turn', () => {
    const a = clientTask({ clock_started_at: d('2026-11-02T14:00:00Z') }); // class 1, 65
    const b = clientTask({ clock_started_at: d('2026-10-12T14:00:00Z') }); // class 1, 90
    const c = clientTask({ clock_started_at: d('2026-11-04T14:00:00Z') }); // class 1, 50
    const dd = clientTask({ clock_started_at: d('2026-11-06T14:00:00Z') }); // class 1, 30
    const e = makeTask({ open_blocking_count: 2, promised_to: 'X', clock_started_at: d('2026-10-12T14:00:00Z') }); // class 3, 90
    const r = sel({ tasks: [a, b, c, dd, e] });
    expect(keys(r.sections.next)).toEqual([taskKey(b.id), taskKey(a.id), taskKey(c.id)]);
    const turn = r.everything_else.groups.find((g) => g.key === 'waiting_turn');
    expect(turn?.count).toBe(2);
  });

  it('"This matters more" puts an item first in Next and lets a waiting item in', () => {
    const lowTask = makeTask({ client: active }); // would wait its turn
    const high = clientTask({ clock_started_at: d('2026-10-12T14:00:00Z') });
    const r = sel({ tasks: [high, lowTask] }, [makeState(taskKey(lowTask.id), { boosted_at: NOW })]);
    expect(keys(r.sections.next)).toEqual([taskKey(lowTask.id), taskKey(high.id)]);
    expect(r.sections.next[0].reason).toBe('You said this matters more.');
  });

  it('other ventures wait in Everything else unless boosted', () => {
    const saiph = makeClient('Saiph Grants');
    const t = makeTask({ client: saiph, requested_by_contact_id: 'c', clock_started_at: d('2026-10-12T14:00:00Z') });
    const plain = sel({ tasks: [t] });
    expect(plain.sections.next).toEqual([]);
    expect(plain.everything_else.groups).toEqual([expect.objectContaining({ key: 'ventures', count: 1 })]);
    const boosted = sel({ tasks: [t] }, [makeState(taskKey(t.id), { boosted_at: NOW })]);
    expect(keys(boosted.sections.next)).toEqual([taskKey(t.id)]);
  });

  it('only one item is pinned: the newest working_since; the other is placed normally', () => {
    const a = clientTask();
    const b = clientTask();
    const r = sel({ tasks: [a, b] }, [
      makeState(taskKey(a.id), { working_since: d('2026-11-09T10:00:00Z') }),
      makeState(taskKey(b.id), { working_since: d('2026-11-09T11:00:00Z') }),
    ]);
    expect(keys(r.sections.working_on)).toEqual([taskKey(b.id)]);
    expect(r.sections.working_on[0].pinned).toBe(true);
    expect(keys(r.sections.next)).toEqual([taskKey(a.id)]);
  });

  it('sign-offs and session asks always qualify for Next; a wait only once in view', () => {
    const fold = makeFold({ project: makeProject('P'), client: active }, 5);
    const session = makeSession();
    const due = makeWait({ due_at: d('2026-11-08T14:00:00Z') });
    const needsHuman = makeWait({ state: 'needs_human' });
    const notDue = makeWait({});
    const r = sel({ review_folds: [fold], session_asks: [session], waits: [due, notDue] });
    expect(new Set(keys(r.sections.next))).toEqual(
      new Set([reviewKey(fold.project!.id), sessionKey(session.external_id), waitKey(due.id)]),
    );
    expect(r.candidates.find((c) => c.key === waitKey(notDue.id))?.inView).toBe(false);
    expect(keys(sel({ waits: [needsHuman] }).sections.next)).toEqual([waitKey(needsHuman.id)]);
  });
});

describe('people tiles', () => {
  const longAgo = d('2026-11-02T15:00:00Z');
  it('leads are never capped; mail shows 3, oldest first, and the rest wait their turn', () => {
    const mail = [1, 2, 3, 4, 5].map((n) =>
      makeThread({ client: active, received_at: d(`2026-11-0${n}T15:00:00Z`), thread_id: `m${n}` }),
    );
    const leads = [1, 2, 3, 4, 5].map((n) =>
      makeThread({ intent: 'sales', received_at: d(`2026-11-0${n}T16:00:00Z`), thread_id: `l${n}` }),
    );
    const r = sel({ threads: [...mail, ...leads] });
    expect(r.sections.leads).toHaveLength(5);
    expect(keys(r.sections.mail)).toEqual([1, 2, 3].map((n) => threadKey(mail[0].account, `m${n}`)));
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'waiting_turn', count: 2 })]);
    expect(r.sections.leads[0].type).toBe('lead');
    expect(r.sections.mail[0].type).toBe('owed_reply');
  });

  it('older open threads are counted, not listed; unknown threads are neither', () => {
    const older = makeThread({ client: active, received_at: d('2026-10-01T15:00:00Z') });
    const unknown = makeThread({ received_at: longAgo });
    const r = sel({ threads: [older, unknown] });
    expect(r.sections.mail).toEqual([]);
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'older_threads', count: 1 })]);
  });

  it('threads too young to show are counted under New mail, shown after one business day', () => {
    const young = makeThread({ client: active, received_at: d('2026-11-09T20:00:00Z') });
    const unknown = makeThread({ received_at: d('2026-11-09T20:00:00Z') });
    const r = sel({ threads: [young, unknown] });
    expect(r.sections.mail).toEqual([]);
    expect(r.everything_else.groups).toEqual([
      expect.objectContaining({ key: 'new_mail', label: 'New mail, shown after one business day', count: 1 }),
    ]);
    expect(r.everything_else.count).toBe(1);
  });

  it('the who line shows a name once when the sender and the client share it', () => {
    const jill = makeClient("Jill's Cafe");
    const same = makeThread({ client: jill, from_name: " jill's cafe ", received_at: longAgo });
    const item = sel({ threads: [same] }).sections.mail[0];
    expect(item.who).toBe("jill's cafe");
    expect(item.title.startsWith("jill's cafe:")).toBe(true);
    const other = makeThread({ client: jill, from_name: 'Jill Owner', received_at: longAgo });
    const item2 = sel({ threads: [other] }).sections.mail[0];
    expect(item2.who).toBe("Jill Owner, Jill's Cafe");
    expect(item2.title.startsWith("Jill Owner (Jill's Cafe):")).toBe(true);
  });

  it('the who line on an urgent mail shows the name once too', () => {
    const jill = makeClient("Jill's Cafe");
    const crisis = makeAsk({ client: jill, from_name: "Jill's Cafe", is_urgent: true, received_at: longAgo });
    const r = sel({ crises: [crisis] });
    const item = r.sections.needs_you_now.find((i) => i.source.kind === 'crisis');
    expect(item?.who).toBe("Jill's Cafe");
  });

  it('a draft on the thread shows as "Draft ready, about 2 minutes" and "Open the draft"', () => {
    const t = makeThread({ client: active, received_at: longAgo, draft_url: 'https://mail.google.com/draft/9' });
    const item = sel({ threads: [t] }).sections.mail[0];
    expect(item.effort).toBe('Draft ready, about 2 minutes');
    expect(item.minutes).toBe(2);
    expect(item.actions[0]).toMatchObject({ id: 'open_draft', href: 'https://mail.google.com/draft/9' });
  });

  it('source ids list every open ask on the thread, the id is the newest', () => {
    const older = makeAsk({ client: active, received_at: d('2026-11-01T15:00:00Z') });
    const t = makeThread({ client: active, received_at: longAgo }, [older]);
    const item = sel({ threads: [t] }).sections.mail[0];
    expect(item.source.id).toBe(t.asks[0].id);
    expect(item.source.ids).toEqual([t.asks[0].id, older.id]);
  });
});

describe('crisis mail', () => {
  it('open urgent mail is an emergency; mail from a noise sender is dropped everywhere', () => {
    const real = makeAsk({ is_urgent: true, from_email: 'alerts@monitor.example', subject: 'site down' });
    const noise = makeAsk({ is_urgent: true, from_email: 'alerts@wol.org' });
    const r = sel({ crises: [real, noise] });
    expect(keys(r.sections.needs_you_now)).toEqual([crisisKey(real.id)]);
    expect(r.candidates.map((c) => c.key)).not.toContain(crisisKey(noise.id));
  });
  it('after "Not an emergency" it is counted under waiting their turn, not listed', () => {
    const real = makeAsk({ is_urgent: true, from_email: 'alerts@monitor.example' });
    const r = sel({ crises: [real] }, [makeState(crisisKey(real.id), { not_emergency_at: NOW })]);
    expect(r.sections.needs_you_now).toEqual([]);
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'waiting_turn', count: 1 })]);
  });
});

describe('Handled for you and Everything else', () => {
  const handled = (n: number) => ({
    id: `h${n}`,
    from_name: `Person ${n}`,
    from_email: `p${n}@example.com`,
    subject: `Subject ${n}`,
    gist: null,
    client_name: null,
    deep_link: `https://mail.google.com/${n}`,
    handled_at: d(`2026-11-09T1${n}:00:00Z`),
  });
  it('shows 5 newest first and a "{n} more handled" line', () => {
    const r = sel({ auto_handled: [0, 1, 2, 3, 4, 5, 6].map(handled) });
    expect(r.sections.handled).toHaveLength(5);
    expect(r.sections.handled[0].id).toBe('h6');
    expect(r.sections.handled[0].href).toBe('https://mail.google.com/6');
    expect(r.sections.handled_more).toEqual({ count: 2, text: '2 more handled' });
  });
  it('shows no roll-up line at 5 or fewer', () => {
    const r = sel({ auto_handled: [0, 1].map(handled) });
    expect(r.sections.handled_more).toBeNull();
  });
  it('Everything else counts held projects, review pieces and the groups behind one sentence', () => {
    const fold = makeFold({ project: makeProject('P'), client: active }, 7);
    const r = sel({ held_project_task_count: 4, review_folds: [fold] });
    const byKey = Object.fromEntries(r.everything_else.groups.map((g) => [g.key, g.count]));
    expect(byKey).toEqual({ held_projects: 4, review_pieces: 7 });
    expect(r.everything_else.count).toBe(11);
    expect(r.everything_else.line).toBe('11 other items are counted here. 0 have a day to come back. None is past its day.');
    expect(r.everything_else.scope_line).toBe('4 tasks on unsigned or paused projects are kept as scope, not work.');
  });
  it('empty groups are left out', () => {
    expect(sel({}).everything_else).toEqual({
      count: 0,
      line: 'Nothing else is on your plate.',
      groups: [],
      with_day: 0,
      past_day: 0,
      scope_line: null,
    });
  });
});

describe('buttons and card', () => {
  it('only the top Next row has a filled first button', () => {
    const a = clientTask({ clock_started_at: d('2026-10-12T14:00:00Z') });
    const b = clientTask();
    const r = sel({ tasks: [a, b] });
    expect(r.sections.next[0].actions.map((x) => x.filled)).toEqual([true, false, false]);
    expect(r.sections.next[1].actions.some((x) => x.filled)).toBe(false);
  });

  it('a task at its third Not now gets "Let it go" instead of "Not now"', () => {
    const t = clientTask();
    const r = sel({ tasks: [t] }, [makeState(taskKey(t.id), { park_count: 3, view_at: null })]);
    const labels = r.sections.next[0].actions.map((a) => a.label);
    expect(labels).toContain('Let it go');
    expect(labels).not.toContain('Not now');
  });

  it('a sign-off says "Approve all 39"; a session without a link has no Open button', () => {
    const fold = makeFold({ project: makeProject('VCDP'), client: active }, 39);
    const session = makeSession({ remote_url: null });
    const r = sel({ review_folds: [fold], session_asks: [session] });
    const f = r.sections.next.find((i) => i.source.kind === 'review')!;
    expect(f.actions[0].label).toBe('Approve all 39');
    expect(f.title).toBe('Sign off 39 finished pieces for VCDP');
    expect(f.effort).toBe('About 45 minutes');
    const s = r.sections.next.find((i) => i.source.kind === 'session')!;
    expect(s.actions.map((a) => a.id)).not.toContain('open_session');
  });

  it('a price-review wait gets Open only; an approval wait gets Approve, any other Done', () => {
    const price = makeWait({ template_key: 'charter.price_review', state: 'needs_human', charter_id: 'ch1' });
    const approval = makeWait({ state: 'needs_human', approval_request_id: 'ar' });
    const plain = makeWait({ state: 'needs_human' });
    const r = sel({ waits: [price, approval, plain] });
    const ids = (id: string) => r.byKey.get(waitKey(id))!.item.actions.map((a) => a.id);
    expect(ids(price.id)).toEqual(['open_wait', 'not_now']);
    expect(r.byKey.get(waitKey(price.id))!.item.actions[0].href).toBe('/charters/ch1');
    expect(ids(approval.id)[0]).toBe('approve_wait');
    expect(ids(plain.id)[0]).toBe('complete_wait');
  });

  it('a task card carries its summary, a checklist only for 2 or more deliverables, the SOP and links', () => {
    const t = makeTask({
      description: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Do the thing.', styles: {} }] }]),
      requirements: [
        { text: 'One', completed: true },
        { text: 'Two', completed: false },
      ],
      sop: { id: 'sop1', title: 'The runbook' },
      project: makeProject('Proj'),
      origin_url: 'https://mail.google.com/x',
    });
    const one = makeTask({ requirements: [{ text: 'Only', completed: false }] });
    const r = sel({ tasks: [t, one] });
    const card = r.byKey.get(taskKey(t.id))!.item.opened;
    expect(card.summary).toBe('Do the thing.');
    expect(card.done_when).toEqual([
      { text: 'One', done: true },
      { text: 'Two', done: false },
    ]);
    expect(card.how).toEqual({ label: 'The runbook', href: '/sops/sop1' });
    expect(card.links.map((l) => l.label)).toEqual(['The email it came from', 'Project: Proj']);
    expect(card.task_id).toBe(t.id);
    expect(r.byKey.get(taskKey(one.id))!.item.opened.done_when).toEqual([]);
  });

  it('carries Mike\'s "Where did you leave it?" note on the card', () => {
    const t = clientTask();
    const r = sel({ tasks: [t] }, [makeState(taskKey(t.id), { left_off_note: 'Waiting on a password — ask Sabeen' })]);
    expect(r.sections.next[0].opened.left_off_note).toBe('Waiting on a password, ask Sabeen');
  });

  it('hard-date chip: only a promise or a lifeline tag, with the real weekday and the promised name', () => {
    const promised = makeTask({ promised_to: 'Gene Roberts', due_date: d('2026-11-13T00:00:00.000Z') });
    const mine = makeTask({ due_date: d('2026-11-13T00:00:00.000Z') });
    const r = sel({ tasks: [promised, mine] });
    expect(r.byKey.get(taskKey(promised.id))!.item.hard_date).toBe('Due Friday, November 13 (Gene Roberts)');
    expect(r.byKey.get(taskKey(mine.id))!.item.hard_date).toBeNull();
  });

  it('items carry no score, class or rule fields', () => {
    const r = sel({ tasks: [clientTask()] });
    expect(Object.keys(r.sections.next[0]).sort()).toEqual(
      [
        'actions', 'age', 'client', 'default_if_ignored', 'effort', 'hard_date', 'key', 'minutes', 'more_actions',
        'opened', 'pinned', 'project', 'reason', 'source', 'title', 'type', 'who', 'why_now',
      ].sort(),
    );
  });
});

describe('Slice 2: fresh tasks, the nightly sort, drawer rows', () => {
  const ME = makeInputs().user_id;
  const rest = (r: ReturnType<typeof sel>, key: string) => r.everything_else.groups.find((g) => g.key === key);
  const fromChat = (over = {}) => makeTask({ tags: ['from-chat'], created_at: d('2026-11-09T14:00:00Z'), ...over });

  it('a from-chat task and a task he made are listed in Next, behind boosted and ahead of class 1', () => {
    const chat = fromChat();
    const mine = makeTask({ created_by_id: ME, created_at: d('2026-11-09T14:00:00Z') });
    const high = clientTask({ clock_started_at: d('2026-10-12T14:00:00Z') });
    const boosted = makeTask({ client: active });
    const r = sel({ tasks: [high, chat, mine, boosted] }, [makeState(taskKey(boosted.id), { boosted_at: NOW })]);
    const order = keys(r.sections.next);
    expect(order[0]).toBe(taskKey(boosted.id));
    expect(new Set(order.slice(1, 3))).toEqual(new Set([taskKey(chat.id), taskKey(mine.id)]));
    expect(order).toHaveLength(3);
    const chatItem = r.candidates.find((c) => c.key === taskKey(chat.id))!;
    expect(chatItem.fresh).toBe(true);
    expect(chatItem.item.why_now).toBe('New from the chat.');
    expect(chatItem.item.reason).toBe('You made it in the last two business days, so it shows here first.');
    expect(r.candidates.find((c) => c.key === taskKey(mine.id))!.item.why_now).toBe('New, made by you.');
  });

  it('a fresh task is gone from Next after two business days', () => {
    const old = fromChat({ created_at: d('2026-11-04T14:00:00Z') });
    const r = sel({ tasks: [old] });
    expect(r.sections.next).toEqual([]);
    expect(r.candidates[0].fresh).toBe(false);
    expect(rest(r, 'waiting_turn')?.count).toBe(1);
  });

  it('ventures do not catch a fresh task', () => {
    const t = fromChat({ client: makeClient('Saiph Grants') });
    expect(keys(sel({ tasks: [t] }).sections.next)).toEqual([taskKey(t.id)]);
  });

  it('a keeper-parked task is not shown and sits in "Given a day to come back"', () => {
    const t = clientTask();
    const st = makeState(taskKey(t.id), { view_at: d('2026-11-12T05:05:00Z'), view_set_by: 'keeper' });
    const r = sel({ tasks: [t] }, [st]);
    expect(r.sections.next).toEqual([]);
    const c = r.candidates[0];
    expect(c.parked).toBe(true);
    expect(c.parkedBy).toBe('keeper');
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'scheduled', count: 1 })]);
    expect(rest(r, 'scheduled')?.items[0]).toMatchObject({
      key: taskKey(t.id),
      owner: 'You',
      check_text: 'Back Thursday, November 12',
      check_at: '2026-11-12T05:05:00.000Z',
      past_check: false,
      can_bring_forward: true,
    });
    expect(r.everything_else.with_day).toBe(1);
    expect(r.everything_else.line).toBe('1 other item is counted here. 1 has a day to come back. None is past its day.');
  });

  it('a keeper task whose day has come arrives in Next', () => {
    const t = makeTask({ client: active }); // would wait its turn
    const st = makeState(taskKey(t.id), { view_at: d('2026-11-09T05:05:00Z'), view_set_by: 'keeper' });
    const r = sel({ tasks: [t] }, [st]);
    expect(keys(r.sections.next)).toEqual([taskKey(t.id)]);
    expect(r.sections.next[0].why_now).toBe('Back today, after waiting its turn.');
    expect(r.candidates[0].arrived).toBe(true);
  });

  it('his own Not now is still parked and still "Parked by you"', () => {
    const t = clientTask();
    const r = sel({ tasks: [t] }, [makeState(taskKey(t.id), { park_count: 1, view_at: d('2026-11-10T14:00:00Z') })]);
    expect(r.candidates[0].parkedBy).toBe('user');
    expect(r.everything_else.groups).toEqual([expect.objectContaining({ key: 'parked', count: 1 })]);
    const nullSetBy = sel({ tasks: [t] }, [makeState(taskKey(t.id), { view_at: d('2026-11-10T14:00:00Z'), view_set_by: 'user' })]);
    expect(nullSetBy.candidates[0].parkedBy).toBe('user');
  });

  it('meetsNextRule counts fresh and arrived', () => {
    const base = { boosted: false, fresh: false, arrived: false, kind: 'task' as const, score: { klass: 4, urgency: 10 } as never };
    expect(meetsNextRule(base)).toBe(false);
    expect(meetsNextRule({ ...base, fresh: true })).toBe(true);
    expect(meetsNextRule({ ...base, arrived: true })).toBe(true);
  });

  it('a boosted older thread goes to its People list; a boosted wait not in view goes to Next', () => {
    const thread = makeThread({ client: active, received_at: d('2026-10-01T15:00:00Z') });
    const wait = makeWait();
    const r = sel({ threads: [thread], waits: [wait] }, [
      makeState(threadKey(thread.account, thread.thread_id), { boosted_at: NOW }),
      makeState(waitKey(wait.id), { boosted_at: NOW }),
    ]);
    expect(keys(r.sections.mail)).toEqual([threadKey(thread.account, thread.thread_id)]);
    expect(keys(r.sections.next)).toEqual([waitKey(wait.id)]);
    expect(r.everything_else.count).toBe(0);
  });

  it('check texts for every group', () => {
    const waitingNoDay = makeTask({ client: active, title: 'Quiet one' });
    const overflow = [0, 1, 2, 3].map((i) => clientTask({ clock_started_at: d(`2026-10-1${i}T14:00:00Z`) }));
    const venture = makeTask({ client: makeClient('Saiph Grants') });
    const older = makeThread({ client: active, received_at: d('2026-10-01T15:00:00Z') });
    const young = makeThread({ client: active, received_at: d('2026-11-09T20:00:00Z') });
    const proj = makeProject('Grok');
    const r = sel(
      {
        tasks: [waitingNoDay, ...overflow, venture],
        threads: [older, young],
        review_folds: [makeFold({ project: proj, client: active }, 2)],
        held_project_task_count: 5,
        held_projects: [{ project: { id: proj.id, name: 'Wild Beauty' }, count: 5 }],
      },
    );
    const text = (k: string) => rest(r, k)?.items.map((i) => [i.title, i.owner, i.check_text, i.can_bring_forward]);
    const turn = rest(r, 'waiting_turn')!.items;
    expect(turn.find((i) => i.key === taskKey(waitingNoDay.id))).toMatchObject({
      check_text: "Gets a day in tonight's sort",
      owner: 'You',
      check_at: null,
      past_check: false,
    });
    expect(turn.filter((i) => i.title === 'A task' && i.check_text === 'Joins Next when a row frees up')).toHaveLength(1);
    expect(text('held_projects')).toEqual([['Wild Beauty', 'The Wild Beauty project', 'When Wild Beauty starts', false]]);
    expect(text('review_pieces')).toEqual([['2 finished pieces for Grok', 'The Grok sign-off', 'With the Grok sign-off', false]]);
    expect(text('new_mail')).toEqual([['1 new message', 'You', 'Shows after one business day', false]]);
    expect(text('older_threads')?.[0].slice(1)).toEqual(['You', 'No set day. Open the thread to answer or close it.', true]);
    expect(text('ventures')?.[0].slice(1)).toEqual(['You, other hat', 'No set day. Other hat.', true]);
    expect(r.everything_else.scope_line).toBe('5 tasks on unsigned or paused projects are kept as scope, not work.');
  });

  it('past_check is true for an item still in rest after its day', () => {
    const t = clientTask({ clock_started_at: d('2026-10-12T14:00:00Z') });
    const others = [1, 2, 3].map(() => clientTask({ clock_started_at: d('2026-10-12T14:00:00Z') }));
    const arrivedLate = makeTask({ client: active });
    const r = sel({ tasks: [t, ...others, arrivedLate] }, [
      makeState(taskKey(arrivedLate.id), { view_at: d('2026-11-09T05:05:00Z'), view_set_by: 'keeper' }),
    ]);
    const item = rest(r, 'waiting_turn')!.items.find((i) => i.key === taskKey(arrivedLate.id))!;
    expect(item.past_check).toBe(true);
    expect(r.everything_else.past_day).toBe(1);
    expect(r.everything_else.line).toContain('1 is past its day.');
  });

  it('crisis rows cannot be brought forward', () => {
    const crisis = makeAsk({ is_urgent: true, from_email: 'a@real.example', received_at: d('2026-11-09T20:00:00Z') });
    const r = sel({ crises: [crisis] }, [makeState(crisisKey(crisis.id), { not_emergency_at: NOW })]);
    expect(rest(r, 'waiting_turn')?.items[0].can_bring_forward).toBe(false);
  });

  it('hard date chips: filed date with source, and the keeper reading', () => {
    const filed = makeTask({ hard_due_at: d('2026-11-15T00:00:00.000Z'), hard_due_source: 'domain renews' });
    const read = makeTask({ due_date: d('2026-11-15T00:00:00.000Z') });
    const r = sel({ tasks: [filed, read] }, [
      makeState(taskKey(read.id), { read_hard_due_at: d('2026-11-15T00:00:00.000Z'), read_hard_due_source: 'date from the task, source unclear' }),
    ]);
    const chip = (id: string) => r.candidates.find((c) => c.key === taskKey(id))!.item.hard_date;
    expect(chip(filed.id)).toBe('Due Sunday, November 15 (domain renews)');
    expect(chip(read.id)).toBe('Due Sunday, November 15 (date from the task, source unclear)');
  });

  it('rule 7 sends a close hard_due_at to Needs you now, never a "source unclear" reading', () => {
    const filed = makeTask({ hard_due_at: d('2026-11-11T00:00:00.000Z'), hard_due_source: 'domain renews' });
    const read = makeTask({ due_date: d('2026-11-11T00:00:00.000Z') });
    const r = sel({ tasks: [filed, read] }, [
      makeState(taskKey(read.id), { read_hard_due_at: d('2026-11-11T00:00:00.000Z'), read_hard_due_source: null }),
    ]);
    expect(keys(r.sections.needs_you_now)).toEqual([taskKey(filed.id)]);
    expect(r.sections.needs_you_now[0].why_now).toBe('A real outside date is close.');
    expect(r.candidates.find((c) => c.key === taskKey(read.id))!.rule).toBeNull();
    expect(r.candidates.find((c) => c.key === taskKey(read.id))!.item.hard_date).toContain('date from the task, source unclear');
  });
});

describe('Slice 2: Handled for you merges keeper lines', () => {
  it('merges keeper lines with classifier closes, newest first, capped at 5', () => {
    const keeper = (n: number) => ({
      id: `k${n}`,
      action: 'keeper_stagger' as const,
      text: `Gave ${n} waiting tasks a day to come back, at most 3 a day, starting Wednesday.`,
      details: ['One task'],
      at: d(`2026-11-09T1${n}:30:00Z`),
      undo_until: d('2026-11-12T10:00:00Z'),
    });
    const handled = (n: number) => ({
      id: `h${n}`,
      from_name: 'Pat',
      from_email: 'pat@x.example',
      subject: `S${n}`,
      gist: null,
      client_name: null,
      deep_link: `https://mail.google.com/${n}`,
      handled_at: d(`2026-11-09T1${n}:00:00Z`),
    });
    const r = sel({ auto_handled: [0, 1, 2, 3].map(handled), keeper_lines: [1, 2, 3].map(keeper) });
    expect(r.sections.handled.map((h) => h.id)).toEqual(['k3', 'h3', 'k2', 'h2', 'k1']);
    expect(r.sections.handled[0]).toMatchObject({ undo_action_id: 'k3', details: ['One task'], href: null });
    expect(r.sections.handled[1]).toMatchObject({ undo_action_id: null, details: [] });
    expect(r.sections.handled_more).toEqual({ count: 2, text: '2 more handled' });
  });
});
