import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { crisisKey, taskKey } from '../item-key';
import { planStagger } from '../keeper/stagger';
import { siteItemKey } from '../emergency/site';
import { HANDS_ITEM_KEY } from '../emergency/hands';
import type { RawHomeInputs, RawItemState, RawSiteIncident } from '../types';
import { d, makeAsk, makeClient, makeInputs, makeState, makeTask } from './fixtures/tonight';

// Tuesday 2026-11-10 10:00 Eastern: inside the hands window.
const TUE = d('2026-11-10T15:00:00Z');
// Saturday 2026-11-14 10:00 Eastern.
const SAT = d('2026-11-14T15:00:00Z');
const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jills = makeClient("Jill's Cafe");

function sel(raw: Partial<RawHomeInputs>, states: RawItemState[] = [], now = TUE) {
  return selectHome({ raw: makeInputs({ now, ...raw }), states, now });
}
const incident = (over: Partial<RawSiteIncident> = {}): RawSiteIncident => ({
  site_id: SITE,
  domain: 'jillscafe.com',
  client_id: jills.id,
  client_name: jills.name,
  source: 'kuma',
  ask_ids: [],
  started_at: new Date(TUE.getTime() - 35 * 60_000),
  last_checked_at: new Date(TUE.getTime() - 3 * 60_000),
  last_check_up: null,
  closed_at: null,
  close_reason: null,
  mail_links: [],
  ...over,
});
const urgent = (over = {}) => makeAsk({ is_urgent: true, from_email: 'alerts@wpmudev.com', from_name: 'WPMU DEV', subject: 'Uptime alert', ...over });
const needs = (r: ReturnType<typeof sel>) => r.sections.needs_you_now.map((i) => i.key);

describe('Slice 6a: "Not an emergency" rules on crisis mail', () => {
  it('a sender rule moves the next crisis from that sender out of Needs you now, and keeps it counted', () => {
    const a = urgent();
    const other = urgent({ from_email: 'boss@client.example', from_name: 'Boss' });
    const r = sel({ crises: [a, other], not_emergency_rules: [{ kind: 'sender', value: 'alerts@wpmudev.com' }] });
    expect(needs(r)).toEqual([crisisKey(other.id)]);
    expect(r.byKey.get(crisisKey(a.id))!.section).toBe('rest');
    expect(r.byKey.get(crisisKey(a.id))!.item.type).not.toBe('emergency');
  });

  it('without the rule it is in Needs you now, with the choices and no refusal note', () => {
    const a = urgent();
    const r = sel({ crises: [a] });
    expect(needs(r)).toEqual([crisisKey(a.id)]);
    const item = r.sections.needs_you_now[0];
    expect(item.not_emergency_scopes?.map((s) => s.scope)).toEqual(['sender', 'domain']);
    expect(item.not_emergency_scopes?.[0].label).toBe('Mail from alerts@wpmudev.com');
    expect(item.not_emergency_refusal).toBeUndefined();
  });

  it('a domain rule matches the exact domain only', () => {
    const a = urgent({ from_email: 'x@wpmudev.com' });
    const sub = urgent({ from_email: 'x@mail.wpmudev.com' });
    const r = sel({ crises: [a, sub], not_emergency_rules: [{ kind: 'domain', value: 'wpmudev.com' }] });
    expect(needs(r)).toEqual([crisisKey(sub.id)]);
  });

  it('a rule never hides a task: a security task stays in Needs you now and says why it has no rule', () => {
    const t = makeTask({ tags: ['security'], client: makeClient('Active Co'), title: 'Patch the site' });
    const r = sel({ tasks: [t], not_emergency_rules: [{ kind: 'sender', value: 'alerts@wpmudev.com' }, { kind: 'domain', value: 'wpmudev.com' }, { kind: 'site', value: 'jillscafe.com' }] });
    expect(needs(r)).toEqual([taskKey(t.id)]);
    const item = r.sections.needs_you_now[0];
    expect(item.not_emergency_refusal).toBe('A security flag is never turned into a rule.');
    expect(item.not_emergency_scopes).toBeUndefined();
    // today's one-time "Not an emergency" is still on the card
    expect([...item.actions, ...item.more_actions].map((a) => a.id)).toContain('not_emergency');
  });

  it('a task that is not an emergency carries neither field', () => {
    const r = sel({ tasks: [makeTask({ client: makeClient('Active Co'), requested_by_contact_id: 'c', clock_started_at: d('2026-11-02T14:00:00Z') })] });
    const item = r.sections.next[0];
    expect(item.not_emergency_refusal).toBeUndefined();
    expect(item.not_emergency_scopes).toBeUndefined();
  });
});

describe('Slice 6a: site down rows', () => {
  it('a watchdog incident 5 minutes old is not shown, at 12 minutes it is', () => {
    const young = sel({ site_incidents: [incident({ started_at: new Date(TUE.getTime() - 5 * 60_000) })] });
    expect(needs(young)).toEqual([]);
    const old = sel({ site_incidents: [incident({ started_at: new Date(TUE.getTime() - 12 * 60_000) })] });
    expect(needs(old)).toEqual([siteItemKey(SITE)]);
  });

  it('reads as the plan says, with the watchdog line and the open choices', () => {
    const r = sel({ site_incidents: [incident()] });
    const item = r.sections.needs_you_now[0];
    expect(item.title).toBe('jillscafe.com is down.');
    expect(item.why_now).toBe("Jill's Cafe · down 35 minutes · checked again 3 minutes ago");
    expect(item.default_if_ignored).toBe('The watchdog already told you on Slack and keeps checking every 2 minutes. This row clears when the site answers.');
    expect(item.type).toBe('emergency');
    expect(item.source.kind).toBe('site');
    expect(item.not_emergency_scopes).toEqual([{ scope: 'site', label: 'jillscafe.com going down' }]);
    expect(item.actions.map((a) => a.id)).toEqual(['open_site', 'not_emergency']);
    expect(item.actions[0].href).toBe('https://jillscafe.com/');
  });

  it('a closed watchdog incident shows nothing', () => {
    const r = sel({ site_incidents: [incident({ closed_at: new Date(TUE.getTime() - 60_000), close_reason: 'watchdog_closed' })] });
    expect(needs(r)).toEqual([]);
  });

  it('an uptime mail whose check found the site down shows one row, with the mail linked and not twice', () => {
    const a = urgent({ from_email: 'noreply@wpmudev.com', subject: 'jillscafe.com is down' });
    const r = sel({
      crises: [a],
      site_incidents: [incident({ source: 'uptime_mail', ask_ids: [a.id], last_check_up: false, mail_links: [{ label: 'The email thread', href: 'https://mail/x' }] })],
    });
    expect(needs(r)).toEqual([siteItemKey(SITE)]);
    const item = r.sections.needs_you_now[0];
    expect(item.actions.map((x) => x.id)).toEqual(['open_thread', 'open_site', 'not_emergency']);
    expect(item.opened.links.map((l) => l.href)).toContain('https://mail/x');
    expect(r.byKey.has(crisisKey(a.id))).toBe(false);
  });

  it('an uptime mail not yet checked stays as the mail, and one answered by a check leaves Needs you now', () => {
    const a = urgent({ from_email: 'noreply@wpmudev.com', subject: 'jillscafe.com is down' });
    const pending = sel({ crises: [a], site_incidents: [incident({ source: 'uptime_mail', ask_ids: [a.id], last_check_up: null })] });
    expect(needs(pending)).toEqual([crisisKey(a.id)]);
    const answered = sel({
      crises: [a],
      site_incidents: [incident({ source: 'uptime_mail', ask_ids: [a.id], last_check_up: true, closed_at: TUE, close_reason: 'answered' })],
    });
    expect(needs(answered)).toEqual([]);
    expect(answered.byKey.get(crisisKey(a.id))!.section).toBe('rest');
  });

  it('a site rule hides the row and the mail behind it, and a one-time Not an emergency hides the row', () => {
    const a = urgent({ from_email: 'noreply@wpmudev.com', subject: 'jillscafe.com is down' });
    const ruled = sel({
      crises: [a],
      site_incidents: [incident({ source: 'uptime_mail', ask_ids: [a.id], last_check_up: false })],
      not_emergency_rules: [{ kind: 'site', value: 'jillscafe.com' }],
    });
    expect(needs(ruled)).toEqual([]);
    expect(ruled.byKey.get(crisisKey(a.id))!.section).toBe('rest');
    const once = sel({ site_incidents: [incident()] }, [makeState(siteItemKey(SITE), { not_emergency_at: TUE })]);
    expect(needs(once)).toEqual([]);
  });
});

describe('Slice 6a: the Monday hands row', () => {
  const hands = (over = {}) => makeTask({ tags: ['hands'], title: 'Rotate the SFTP password', estimated_minutes: 10, ...over });
  const sop = { id: 'sop-1', title: 'Rotate credentials' };

  it('appears on a Tuesday in the first Next slot, with the jobs grouped by written steps', () => {
    const a = hands({ title: 'B job', sop });
    const b = hands({ title: 'A job', estimated_minutes: 20 });
    const c = makeTask({ tags: ['credential-rotation'], title: 'C job', sop, estimated_minutes: 10 });
    const r = sel({ tasks: [a, b, c] });
    const row = r.sections.next[0];
    expect(row.key).toBe(HANDS_ITEM_KEY);
    expect(row.type).toBe('hands');
    expect(row.title).toBe("This week's hands: 3 jobs, about 40 minutes in all.");
    expect(row.actions.map((x) => x.id)).toEqual(['not_this_week']);
    expect(row.hands?.groups.map((g) => [g.label, g.jobs.map((j) => j.title)])).toEqual([
      ['Rotate credentials', ['B job', 'C job']],
      ['No written steps', ['A job']],
    ]);
    const ids = row.hands?.groups[0].jobs[0].item.actions.map((x) => x.id) ?? [];
    expect(ids).toContain('done');
    expect(ids).toContain('do_now');
  });

  it('is not there on Saturday, and the jobs are still counted under one Everything else group', () => {
    const a = hands();
    const r = sel({ tasks: [a] }, [], SAT);
    expect(r.sections.next.map((i) => i.key)).not.toContain(HANDS_ITEM_KEY);
    const group = r.everything_else.groups.find((g) => g.key === 'hands');
    expect(group?.count).toBe(1);
    expect(r.byKey.get(taskKey(a.id))!.restGroup).toBe('hands');
  });

  it('the jobs never sit in Next one by one, and a task with a hard date keeps its own row', () => {
    const a = hands();
    const dated = hands({ title: 'Dated', promised_to: 'Jill', due_date: d('2026-11-11T00:00:00Z'), client: makeClient('Active Co') });
    const r = sel({ tasks: [a, dated] });
    expect(r.sections.next.map((i) => i.key)).not.toContain(taskKey(a.id));
    expect(r.byKey.get(taskKey(a.id))!.restGroup).toBe('hands');
    expect(r.sections.next[0].hands?.count).toBe(1);
    expect(r.byKey.get(taskKey(dated.id))!.restGroup).not.toBe('hands');
  });

  it('Not this week parks the row until next Monday, then it is back', () => {
    const a = hands();
    const parked = makeState(HANDS_ITEM_KEY, { view_at: d('2026-11-16T05:05:00Z'), view_set_by: 'user' });
    const r = sel({ tasks: [a] }, [parked]);
    expect(r.sections.next.map((i) => i.key)).not.toContain(HANDS_ITEM_KEY);
    const back = sel({ tasks: [a] }, [parked], d('2026-11-16T15:00:00Z'));
    expect(back.sections.next[0].key).toBe(HANDS_ITEM_KEY);
  });

  it('a pinned job leaves the row, and the row holds a Next slot rather than adding a fourth', () => {
    const a = hands();
    const pinned = hands({ title: 'Pinned job' });
    const r = sel({ tasks: [a, pinned] }, [makeState(taskKey(pinned.id), { working_since: TUE })]);
    expect(r.sections.working_on.map((i) => i.key)).toEqual([taskKey(pinned.id)]);
    expect(r.sections.next[0].hands?.count).toBe(1);
    const many = Array.from({ length: 6 }, (_, i) => makeTask({ title: `Own ${i}`, client: makeClient('Active Co'), requested_by_contact_id: 'c', clock_started_at: d('2026-11-02T14:00:00Z') }));
    const full = sel({ tasks: [a, ...many] });
    expect(full.sections.next).toHaveLength(3);
    expect(full.sections.next[0].key).toBe(HANDS_ITEM_KEY);
  });

  it('is a candidate of its own kind', () => {
    const r = sel({ tasks: [hands()] });
    expect(r.candidates.find((c) => c.key === HANDS_ITEM_KEY)!.kind).toBe('hands');
  });
});

describe('Slice 6a: the nightly keeper never gives a hands task a day', () => {
  it('planStagger leaves hands tasks alone and still staggers ordinary waiting tasks', () => {
    const now = d('2026-11-11T07:35:00Z'); // Wednesday 02:35 Eastern
    const old = { created_at: d('2026-10-01T14:00:00Z'), clock_started_at: d('2026-10-01T14:00:00Z') };
    const handsTasks = [1, 2, 3].map((n) => makeTask({ title: `Hands ${n}`, tags: ['hands'], ...old }));
    const credential = makeTask({ title: 'Cred', tags: ['credential-rotation'], ...old });
    const chores = [1, 2].map((n) => makeTask({ title: `Chore ${n}`, created_at: d(`2026-10-1${n}T14:00:00Z`), clock_started_at: d('2026-10-01T14:00:00Z') }));
    const raw = makeInputs({ now, tasks: [...handsTasks, credential, ...chores] });
    const s = selectHome({ raw, states: [], now });
    const plan = planStagger(s, [], now, 'America/New_York');
    const given = plan.map((c) => c.item_key);
    for (const t of [...handsTasks, credential]) {
      expect(s.byKey.get(taskKey(t.id))!.restGroup).toBe('hands');
      expect(given).not.toContain(taskKey(t.id));
    }
    expect(given.sort()).toEqual(chores.map((t) => taskKey(t.id)).sort());
  });
});
