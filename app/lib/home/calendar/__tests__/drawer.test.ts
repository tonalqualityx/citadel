import { describe, it, expect } from 'vitest';
import { selectHome } from '../../select';
import { taskKey, threadKey } from '../../item-key';
import { makeAsk, makeClient, makeInputs, makeProject, makeSession, makeState, makeTask, makeThread, d } from '../../__tests__/fixtures/tonight';
import { buildDrawer, drawerHints, drawerItems, drawerLinks, reportLinks, EMPTY_CONTEXT, type DrawerContext, type DrawerInput } from '../drawer';
import { matchEvent, EMPTY_TABLES } from '../match';
import { ev, guest, me, ZONE } from './helpers';

const NOW = d('2026-11-11T16:40:00Z');
const vt = makeClient('VT Standard');
const other = makeClient('Another Client');
const phil = makeProject('Phil Camp memorial page');

const event = ev({
  title: 'VT call',
  start: '11:30',
  end: '12:00',
  meet_url: 'https://meet.google.com/abc-defg-hij',
  description: '<b>Agenda</b> see https://evil.example/x and https://acme.zoom.us/j/7',
  attendees: [me(), guest('m@vt.org', 'Morgan Ellis'), guest('d@vt.org', 'Dan Price', 'needsAction')],
});
const tables = { ...EMPTY_TABLES, contacts: [{ email: 'm@vt.org', name: 'Morgan Ellis', client_id: vt.id, client_name: vt.name }, { email: 'd@vt.org', name: 'Dan Price', client_id: vt.id, client_name: vt.name }] };
const match = matchEvent(event, tables);

function input(raw: ReturnType<typeof makeInputs>, states = [] as ReturnType<typeof makeState>[], ctx: Partial<DrawerContext> = {}): DrawerInput {
  const sel = selectHome({ raw, states, now: NOW });
  return { now: NOW, timeZone: ZONE, event, kind: 'meeting', match, raw, candidates: sel.candidates, ctx: { ...EMPTY_CONTEXT, ...ctx } };
}
const task = (title: string, client = vt, project: ReturnType<typeof makeProject> | null = phil) =>
  makeTask({ title, client, project: project ?? null, estimated_minutes: 10 });
/** "This matters more" puts a task in Next, so it is in view. */
const boost = (...ts: ReturnType<typeof makeTask>[]) => ts.map((t) => makeState(taskKey(t.id), { boosted_at: d('2026-11-10T00:00:00Z') }));

describe('hints', () => {
  it('an owed thread from an attendee gives the owe line with the thread subject', () => {
    const th = makeThread({ from_email: 'm@vt.org', from_name: 'Morgan Ellis', subject: 'Re: memorial page timing', client: vt });
    const inp = input(makeInputs({ now: NOW, threads: [th] }));
    expect(drawerHints(inp)).toEqual([{ text: 'You owe Morgan a reply: Re: memorial page timing.', muted: false }]);
  });

  it('a parked thread gives only the muted set aside line and its state is untouched', () => {
    const th = makeThread({ from_email: 'm@vt.org', from_name: 'Morgan Ellis', subject: 'Re: x', client: vt });
    const key = threadKey(th.account, th.thread_id);
    const states = [makeState(key, { view_at: d('2026-11-13T15:00:00Z'), view_set_by: 'user' })];
    const before = JSON.stringify(states);
    const inp = input(makeInputs({ now: NOW, threads: [th] }), states);
    expect(drawerHints(inp)).toEqual([{ text: 'You set aside a reply to Morgan until Friday.', muted: true }]);
    expect(JSON.stringify(states)).toBe(before);
    expect(drawerItems(inp).items).toEqual([]);
  });

  it('two session asks under one title give the questions line', () => {
    const s1 = makeSession({ title: 'Phil Camp', client: vt });
    const s2 = makeSession({ title: 'Phil Camp', client: vt });
    const hints = drawerHints(input(makeInputs({ now: NOW, session_asks: [s1, s2] })));
    expect(hints).toEqual([{ text: 'Decide before the call: 2 questions from the Phil Camp session.', muted: false }]);
  });

  it('another client session gives no hint, and no source gives no hint', () => {
    const s = makeSession({ title: 'Other', client: other });
    expect(drawerHints(input(makeInputs({ now: NOW, session_asks: [s] })))).toEqual([]);
    expect(drawerHints(input(makeInputs({ now: NOW })))).toEqual([]);
  });

  it('is capped at 3', () => {
    const asks = ['a', 'b', 'c', 'd'].map((x) => makeThread({ from_email: 'm@vt.org', subject: `S${x}`, client: vt }));
    expect(drawerHints(input(makeInputs({ now: NOW, threads: asks }))).length).toBe(3);
  });
});

describe('items', () => {
  it('never another client, never a parked item; 5 items give 3 plus 2 more and the project when they share one', () => {
    const mine = ['t1', 't2', 't3', 't4', 't5'].map((t) => task(t));
    const stranger = task('stranger', other, makeProject('Elsewhere'));
    const parked = task('parked');
    const states = [...boost(...mine, stranger), makeState(taskKey(parked.id), { view_at: d('2026-11-13T15:00:00Z'), view_set_by: 'user' })];
    const inp = input(makeInputs({ now: NOW, tasks: [...mine, stranger, parked] }), states, {
      projects: [{ id: phil.id, name: phil.name, live: true, updated_at: NOW, drive_folder_id: null }],
    });
    const r = drawerItems(inp);
    expect(r.items).toHaveLength(3);
    expect(r.more_items).toBe(2);
    expect(r.more_project_id).toBe(phil.id);
    const titles = [...r.items.map((x) => x.item.title)];
    expect(titles).not.toContain('stranger');
    expect(titles).not.toContain('parked');
  });

  it('more_project_id is empty when the items sit in different projects', () => {
    const p2 = makeProject('Second');
    const list = [task('a'), task('b'), task('c'), task('d', vt, p2)];
    const inp = input(makeInputs({ now: NOW, tasks: list }), boost(...list), {
      projects: [phil, p2].map((p) => ({ id: p.id, name: p.name, live: true, updated_at: NOW, drive_folder_id: null })),
    });
    const r = drawerItems(inp);
    expect(r.more_items).toBe(1);
    expect(r.more_project_id).toBeNull();
  });

  it('a thread from an attendee counts even when it is filed under another client', () => {
    const th = makeThread({ from_email: 'd@vt.org', subject: 'Hello', client: other });
    const inp = input(makeInputs({ now: NOW, threads: [th] }));
    expect(drawerItems(inp).items).toHaveLength(1);
  });

  it('carries no scoring field', () => {
    const inp = input(makeInputs({ now: NOW, tasks: [task('a')] }));
    expect(JSON.stringify(buildDrawer(inp))).not.toMatch(/"(score|class|urgency|importance|weight)"/);
  });
});

describe('links', () => {
  const now = NOW;
  const ctx: DrawerContext = {
    ...EMPTY_CONTEXT,
    projects: [
      { id: 'p1', name: 'Phil Camp memorial page', live: true, updated_at: d('2026-11-10T00:00:00Z'), drive_folder_id: 'FOLDER12345' },
      { id: 'p2', name: 'Old done', live: false, updated_at: d('2026-10-01T00:00:00Z'), drive_folder_id: null },
      { id: 'p3', name: 'Ancient done', live: false, updated_at: d('2025-01-01T00:00:00Z'), drive_folder_id: null },
    ],
    resourceLinks: [
      { project_id: 'p1', name: 'Intelligence report', url: 'https://reports.example.com/i', created_at: d('2026-11-01T00:00:00Z') },
      { project_id: 'p2', name: 'Website audit', url: 'https://reports.example.com/a', created_at: d('2026-10-01T00:00:00Z') },
      { project_id: 'p1', name: 'Figma', url: 'https://figma.com/x', created_at: d('2026-11-02T00:00:00Z') },
      { project_id: 'p1', name: 'Strategy roadmap', url: 'http://plain.example.com/s', created_at: d('2026-11-03T00:00:00Z') },
      { project_id: 'p3', name: 'Old SWOT', url: 'https://reports.example.com/old', created_at: d('2025-01-01T00:00:00Z') },
    ],
    latestReport: { period: '2026-10', url: 'https://portal.example.com/r', published_at: d('2026-11-02T00:00:00Z') },
    lastAsk: { from_name: 'Morgan Ellis', from_email: 'm@vt.org', subject: 'Tomorrow works', deep_link: 'https://mail.google.com/x', received_at: d('2026-11-11T14:00:00Z') },
    meeting: { id: 'm1', meeting_date: d('2026-10-28T15:00:00Z') },
    clientDriveId: 'CLIENTFOLDER1',
  };

  it('report links: Intelligence report and Website audit qualify, Figma, an http link and an old done project do not', () => {
    const labels = reportLinks({ now, ctx }).map((l) => l.label);
    expect(labels).toEqual(['Intelligence report', 'Website audit', 'Monthly report, October', 'Drive folder']);
    expect(reportLinks({ now, ctx }).every((l) => l.href?.startsWith('https://'))).toBe(true);
    expect(reportLinks({ now, ctx }).at(-1)?.href).toBe('https://drive.google.com/drive/folders/FOLDER12345');
  });

  it('falls back to the client Drive folder and drops a bad folder id', () => {
    const c2 = { ...ctx, projects: [], resourceLinks: [], latestReport: null };
    expect(reportLinks({ now, ctx: c2 }).map((l) => l.href)).toEqual(['https://drive.google.com/drive/folders/CLIENTFOLDER1']);
    expect(reportLinks({ now, ctx: { ...c2, clientDriveId: 'a/../b' } })).toEqual([]);
  });

  it('orders projects, last email, reports, notes, then the client, within 6, keeping the client link', () => {
    const inp = input(makeInputs({ now: NOW }), [], ctx);
    const links = drawerLinks(inp);
    expect(links.length).toBeLessThanOrEqual(6);
    expect(links[0]).toEqual({ label: 'Phil Camp memorial page', href: null, project_id: 'p1' });
    expect(links[1].label).toBe('Last email: Wednesday, November 11, Morgan: Tomorrow works');
    expect(links.at(-1)).toEqual({ label: 'Open VT Standard', href: `/clients/${vt.id}`, project_id: null });
    expect(links.filter((l) => l.project_id).length).toBeLessThanOrEqual(2);
  });

  it('a lead gets the deal link and no client link', () => {
    const e = ev({ attendees: [me(), guest('e@boot.com', 'Erick')] });
    const m = matchEvent(e, { ...EMPTY_TABLES, accords: [{ id: 'acc1', lead_email: 'e@boot.com', lead_name: 'Erick', lead_business_name: 'Bootleggers', updated_at: NOW }] });
    const inp = { ...input(makeInputs({ now: NOW })), event: e, match: m, ctx: { ...EMPTY_CONTEXT, accord: { id: 'acc1', name: 'Bootleggers site' } } };
    expect(drawerLinks(inp)).toEqual([{ label: 'The deal: Bootleggers site', href: '/deals/acc1', project_id: null }]);
  });
});

describe('buildDrawer', () => {
  it('writes the event block from untrusted text', () => {
    const r = buildDrawer(input(makeInputs({ now: NOW })));
    expect(r.event.title).toBe('VT call');
    expect(r.event.when).toBe('Wednesday 11:30 to 12:00');
    expect(r.event.join).toEqual({ href: 'https://meet.google.com/abc-defg-hij', label: 'Join on Google Meet' });
    expect(r.event.invite_text).toBe('Agenda see https://evil.example/x and https://acme.zoom.us/j/7');
    expect(r.event.invite_links).toEqual([{ href: 'https://acme.zoom.us/j/7', label: 'Join on Zoom' }]);
    expect(r.client).toEqual({ id: vt.id, name: 'VT Standard' });
    expect(r.people).toEqual([
      { name: 'Morgan Ellis', detail: 'VT Standard', reply: null },
      { name: 'Dan Price', detail: 'VT Standard', reply: 'has not replied' },
    ]);
    expect(r.matched_by).toBe('Matched by the email address of Morgan and Dan.');
  });

  it('drops a URL location and a hostile location', () => {
    const e = { ...event, location: 'https://zoom.us/j/1' };
    expect(buildDrawer({ ...input(makeInputs({ now: NOW })), event: e }).event.location).toBeNull();
    const e2 = { ...event, location: 'Room 4 — Main' };
    expect(buildDrawer({ ...input(makeInputs({ now: NOW })), event: e2 }).event.location).toBe('Room 4, Main');
  });

  it('answer block: the thread card and the open the thread link', () => {
    const th = makeThread({ from_email: 'j@hart.org', from_name: 'Jessica', subject: 'Question', client: undefined });
    const key = threadKey(th.account, th.thread_id);
    const e = ev({ title: 'Answer Jessica' });
    const m = matchEvent(e, EMPTY_TABLES);
    const raw = makeInputs({ now: NOW, threads: [th] });
    const sel = selectHome({ raw, states: [], now: NOW });
    const inp: DrawerInput = { now: NOW, timeZone: ZONE, event: e, kind: 'answer', match: m, raw, candidates: sel.candidates, ctx: { ...EMPTY_CONTEXT, answerThreadKey: key } };
    const r = buildDrawer(inp);
    expect(r.items).toHaveLength(1);
    expect(r.links[0].label).toBe('Open the thread');
    expect(r.links[0].href).toMatch(/^https:/);
    void makeAsk;
  });
});
