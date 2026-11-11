// @vitest-environment node
/**
 * Slice 10a against a real Postgres: GET /api/home/calendar (the strip) and GET /api/home/calendar/[id] (the meeting
 * drawer). Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s10a_int npx vitest run lib/home/__tests__/slice10a.integration.test.ts
 *
 * Auth is the only mock. The clock is fixed (Date only): Wednesday November 11 2026 at 11:40, then at 15:10, New York.
 * The wire-in on HomeScreen.tsx is not covered here (it is a separate task); everything else the slice reads is real.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const auth = vi.hoisted(() => ({ who: null as null | { userId: string; role: string; email: string; via: string } }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => auth.who),
}));

import { prisma } from '@/lib/db/prisma';
import { GET as getStrip } from '@/app/api/home/calendar/route';
import { GET as getDrawer } from '@/app/api/home/calendar/[id]/route';
import { taskKey } from '../item-key';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const MIKE = 'mike@becomeindelible.com';
const at = (hhmm: string, day = '2026-11-11') => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCHours(h + 5, m); // November: New York is UTC-5
  return d;
};
const mike = { email: MIKE, display_name: 'Mike', response_status: 'accepted', organizer: true, self: true };
const guest = (email: string, display_name: string | null, response_status = 'accepted') => ({ email, display_name, response_status, organizer: false, self: false });

describe.skipIf(!SCRATCH)('Slice 10a: the calendar routes (real database)', () => {
  const tag = `s10a${Date.now()}`;
  const mikeId = randomUUID();
  const sabeenId = randomUUID();
  const secondAdminId = randomUUID();
  const techId = randomUUID();
  const overlookId = randomUUID();
  const users = [mikeId, sabeenId, secondAdminId, techId, overlookId];
  const morganEmail = `morgan-${tag}@vtstandard.example`;
  const danEmail = `dan-${tag}@vtstandard.example`;
  const erickEmail = `erick-${tag}@bootleggers.example`;
  let clientId = '';
  let projectId = '';
  let accordId = '';
  const ev: Record<string, { id: string; event_id: string }> = {};
  const taskIds: Record<string, string> = {};

  const as = (userId: string, role: string, email: string, via = 'session') => {
    auth.who = { userId, role, email, via };
  };
  const strip = () => getStrip();
  const drawer = (id: string) => getDrawer(new Request(`http://localhost/api/home/calendar/${id}`), { params: Promise.resolve({ id }) });
  const clockAt = (d: Date) => vi.setSystemTime(d);

  async function snapshot() {
    const [task, ask, wait, project, event, state, action, day] = await Promise.all([
      prisma.task.findMany({ orderBy: { id: 'asc' }, select: { id: true, updated_at: true } }),
      prisma.emailAsk.findMany({ orderBy: { id: 'asc' }, select: { id: true, updated_at: true } }),
      prisma.wait.findMany({ orderBy: { id: 'asc' }, select: { id: true, updated_at: true } }),
      prisma.project.findMany({ orderBy: { id: 'asc' }, select: { id: true, updated_at: true } }),
      prisma.calendarEvent.findMany({ orderBy: { id: 'asc' }, select: { id: true, updated_at: true } }),
      prisma.homeItemState.findMany({ orderBy: { id: 'asc' }, select: { id: true, updated_at: true } }),
      prisma.homeAction.count(),
      prisma.homeDay.count(),
    ]);
    return JSON.stringify({ task, ask, wait, project, event, state, action, day });
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    clockAt(at('11:40'));
    await prisma.user.createMany({
      data: [
        { id: mikeId, email: MIKE, password_hash: 'x', name: 'Mike Dion', role: 'admin' },
        { id: sabeenId, email: `sabeen-${tag}@becomeindelible.com`, password_hash: 'x', name: 'Sabeen Ali', role: 'admin' },
        { id: secondAdminId, email: `second-${tag}@example.test`, password_hash: 'x', name: 'Second Admin', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 10A', role: 'tech' },
        { id: overlookId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 10A', role: 'admin' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: mikeId, home_view: 'home', timezone: TZ },
        { user_id: secondAdminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookId, home_view: 'overlook', timezone: TZ },
      ],
    });

    clientId = (await prisma.client.create({ data: { name: 'VT Standard', status: 'active' } })).id;
    await prisma.clientContact.createMany({
      data: [
        { client_id: clientId, name: 'Morgan Ellis', email: morganEmail },
        { client_id: clientId, name: 'Dan Price', email: danEmail },
      ],
    });
    projectId = (await prisma.project.create({ data: { name: 'Phil Camp memorial page', client_id: clientId, status: 'in_progress' } })).id;
    await prisma.resourceLink.createMany({
      data: [
        { project_id: projectId, name: 'Intelligence report', url: 'https://reports.example.com/intel' },
        { project_id: projectId, name: 'Figma', url: 'https://www.figma.com/file/abc' },
      ],
    });
    accordId = (
      await prisma.accord.create({
        data: { name: 'Bootleggers site', status: 'lead', owner_id: mikeId, lead_email: erickEmail, lead_name: 'Erick Brown', lead_business_name: 'Bootleggers' },
      })
    ).id;

    const mkEvent = async (key: string, data: { title: string; starts_at: Date; ends_at: Date; all_day?: boolean; description?: string; meet_url?: string; attendees?: unknown }) => {
      const row = await prisma.calendarEvent.create({
        data: { event_id: `${tag}-${key}`, title: data.title, starts_at: data.starts_at, ends_at: data.ends_at, all_day: data.all_day ?? false, description: data.description, meet_url: data.meet_url, attendees: data.attendees as never },
      });
      ev[key] = { id: row.id, event_id: row.event_id };
    };
    await mkEvent('vt', { title: 'VT Standard weekly', starts_at: at('11:30'), ends_at: at('12:00'), meet_url: 'https://meet.google.com/abc-defg-hij', attendees: [mike, guest(morganEmail, 'Morgan Ellis'), guest(danEmail, 'Dan Price', 'needsAction')] });
    await mkEvent('erick', {
      title: 'Erick Bootleggers and Mike Dion',
      starts_at: at('14:00'),
      ends_at: at('14:30'),
      description: '<b>Agenda</b> read https://evil.example/x first',
      attendees: [mike, guest(erickEmail, 'Erick Brown')],
    });
    await mkEvent('answer', { title: 'Answer Jessica', starts_at: at('15:00'), ends_at: at('15:30') });
    await mkEvent('robotics', { title: 'Boys to Robotics', starts_at: at('15:30'), ends_at: at('18:00') });
    await mkEvent('home', { title: 'Home', starts_at: new Date('2026-11-11T00:00:00Z'), ends_at: new Date('2026-11-12T00:00:00Z'), all_day: true });
    await mkEvent('tomorrowAllDay', { title: 'Veterans Observance', starts_at: new Date('2026-11-12T00:00:00Z'), ends_at: new Date('2026-11-13T00:00:00Z'), all_day: true });
    await mkEvent('declined', { title: 'Declined thing', starts_at: at('16:00'), ends_at: at('16:30'), attendees: [{ ...mike, response_status: 'declined' }, guest(morganEmail, 'Morgan Ellis')] });
    await mkEvent('tomorrow', { title: 'Morgan tomorrow', starts_at: at('13:00', '2026-11-12'), ends_at: at('13:30', '2026-11-12'), attendees: [mike, guest(morganEmail, 'Morgan Ellis')] });
    await mkEvent('far', { title: 'Three days out', starts_at: at('13:00', '2026-11-14'), ends_at: at('13:30', '2026-11-14'), attendees: [mike, guest(morganEmail, 'Morgan Ellis')] });

    await prisma.homeOwedThread.create({ data: { user_id: mikeId, thread_key: `thread:${MIKE}:jessica-${tag}`, state: 'queued', booked_event_id: ev.answer.event_id } });

    // An open thread from Morgan, more than a business day old, and his task and another user's task for the same client.
    await prisma.emailAsk.create({
      data: {
        message_id: `msg-${tag}`,
        thread_id: `thr-${tag}`,
        account: MIKE,
        from_name: 'Morgan Ellis',
        from_email: morganEmail,
        subject: 'Re: memorial page timing',
        gist: 'Asks when the page can go live.',
        queue: 'answer',
        severity: 'internal',
        is_urgent: false,
        state: 'open',
        client_id: clientId,
        project_id: projectId,
        deep_link: 'https://mail.google.com/mail/u/0/#all/abc',
        received_at: new Date('2026-11-06T15:00:00Z'),
      },
    });
    const mkTask = async (key: string, assignee: string, title: string) => {
      taskIds[key] = (
        await prisma.task.create({
          data: { title, assignee_id: assignee, created_by_id: assignee, status: 'not_started', needs_review: false, tags: [tag], client_id: clientId, project_id: projectId, created_at: new Date('2026-11-04T15:00:00Z') },
        })
      ).id;
    };
    await mkTask('mine', mikeId, 'My VT Standard task');
    await mkTask('other', secondAdminId, 'Second admin VT Standard task');
    // "This matters more" puts his task in Next, so it is in view.
    await prisma.homeItemState.create({ data: { user_id: mikeId, item_key: taskKey(taskIds.mine), boosted_at: new Date('2026-11-10T12:00:00Z') } });
  });

  afterEach(() => clockAt(at('11:40')));

  afterAll(async () => {
    vi.useRealTimers();
    await prisma.homeOwedThread.deleteMany({ where: { user_id: mikeId } });
    await prisma.emailAsk.deleteMany({ where: { message_id: `msg-${tag}` } });
    await prisma.task.deleteMany({ where: { id: { in: Object.values(taskIds) } } });
    await prisma.calendarEvent.deleteMany({ where: { event_id: { startsWith: tag } } });
    await prisma.accord.deleteMany({ where: { id: accordId } });
    await prisma.resourceLink.deleteMany({ where: { project_id: projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.clientContact.deleteMany({ where: { client_id: clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('a tech user, an overlook admin, a second home admin and an API key get 403 on both routes', async () => {
    const cases: [string, string, string, string][] = [
      [techId, 'tech', `tech-${tag}@example.test`, 'session'],
      [overlookId, 'admin', `ovl-${tag}@example.test`, 'session'],
      [secondAdminId, 'admin', `second-${tag}@example.test`, 'session'],
      [mikeId, 'admin', MIKE, 'api_key'],
    ];
    for (const [id, role, email, via] of cases) {
      as(id, role, email, via);
      expect((await strip()).status).toBe(403);
      expect((await drawer(ev.vt.id)).status).toBe(403);
    }
  });

  it('at 11:40 the strip is the time and who, nothing else', async () => {
    as(mikeId, 'admin', MIKE);
    const res = await strip();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    const rows = (r: { time: string; who: string; muted: boolean; openable: boolean }[]) => r.map((x) => [x.time, x.who, x.muted, x.openable]);
    expect(rows(body.upcoming)).toEqual([
      ['Now', 'Morgan and Dan, VT Standard', false, true],
      ['2:00', 'Erick, Bootleggers (lead)', false, true],
      ['3:00', 'Your time to answer Jessica', true, true],
      ['3:30', 'Boys to Robotics, until 6:00', true, false],
    ]);
    expect(Object.keys(body.upcoming[0]).sort()).toEqual(['id', 'muted', 'openable', 'time', 'who']);
    expect(body.later).toEqual([]);
    expect(body.earlier).toEqual([]);
    expect(body.all_day).toBe('All day: Home');
    expect(body.tomorrow).toBeNull();
    expect(body.soon).toMatchObject({ id: ev.vt.id, time: 'Now' });
    const text = JSON.stringify(body);
    expect(text).not.toContain('@');
    expect(text).not.toContain('Declined thing');
    expect(text).not.toContain('Veterans Observance');
    expect(text).not.toContain('Three days out');
  });

  it('at 15:10 the earlier ones fold away and the tomorrow line shows', async () => {
    as(mikeId, 'admin', MIKE);
    clockAt(at('15:10'));
    const body = await (await strip()).json();
    expect(body.earlier.map((x: { who: string }) => x.who)).toEqual(['Morgan and Dan, VT Standard', 'Erick, Bootleggers (lead)']);
    expect(body.upcoming.map((x: { time: string; who: string }) => [x.time, x.who])).toEqual([
      ['Now', 'Your time to answer Jessica'],
      ['3:30', 'Boys to Robotics, until 6:00'],
    ]);
    expect(body.tomorrow).toMatchObject({ time: 'Tomorrow 1:00', who: 'Morgan, VT Standard', muted: true, openable: true });
    expect(body.soon).toBeNull();
  });

  it('the VT call drawer: Join, the project, the intelligence report and not Figma, the owed reply, his task and not another user\'s', async () => {
    as(mikeId, 'admin', MIKE);
    const res = await drawer(ev.vt.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.event.title).toBe('VT Standard weekly');
    expect(body.event.when).toBe('Wednesday 11:30 to 12:00');
    expect(body.event.join).toEqual({ href: 'https://meet.google.com/abc-defg-hij', label: 'Join on Google Meet' });
    expect(body.client).toEqual({ id: clientId, name: 'VT Standard' });
    expect(body.matched_by).toBe('Matched by the email address of Morgan and Dan.');
    expect(body.people).toEqual([
      { name: 'Morgan Ellis', detail: 'VT Standard', reply: null },
      { name: 'Dan Price', detail: 'VT Standard', reply: 'has not replied' },
    ]);
    expect(body.hints.map((h: { text: string }) => h.text)).toContain('You owe Morgan a reply: Re: memorial page timing.');
    const titles = body.items.map((x: { item: { title: string } }) => x.item.title);
    expect(titles).toContain('My VT Standard task');
    expect(JSON.stringify(body)).not.toContain('Second admin VT Standard task');
    expect(body.links).toContainEqual({ label: 'Phil Camp memorial page', href: null, project_id: projectId });
    expect(body.links).toContainEqual({ label: 'Intelligence report', href: 'https://reports.example.com/intel', project_id: null });
    expect(body.links.map((l: { label: string }) => l.label)).not.toContain('Figma');
    expect(body.links.at(-1)).toEqual({ label: 'Open VT Standard', href: `/clients/${clientId}`, project_id: null });
    expect(body.links.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(body)).not.toMatch(/"(score|class|urgency|importance|weight)"/);
  });

  it('the Erick drawer: the deal link, and the outside link stays plain text', async () => {
    as(mikeId, 'admin', MIKE);
    const body = await (await drawer(ev.erick.id)).json();
    expect(body.client).toBeNull();
    expect(body.links).toContainEqual({ label: 'The deal: Bootleggers site', href: `/deals/${accordId}`, project_id: null });
    expect(body.event.invite_text).toBe('Agenda read https://evil.example/x first');
    expect(body.event.invite_links).toEqual([]);
    expect(body.event.join).toBeNull();
    expect(body.matched_by).toBe('Matched by the email address of Erick, a lead.');
  });

  it('404 for a bad id, an event three days out, a declined event and an unknown event', async () => {
    as(mikeId, 'admin', MIKE);
    expect((await drawer('not-a-uuid')).status).toBe(404);
    expect((await drawer(ev.far.id)).status).toBe(404);
    expect((await drawer(ev.declined.id)).status).toBe(404);
    expect((await drawer(randomUUID())).status).toBe(404);
  });

  it('writes nothing: row counts and updated_at are the same after every call', async () => {
    as(mikeId, 'admin', MIKE);
    const before = await snapshot();
    await strip();
    clockAt(at('15:10'));
    await strip();
    for (const key of ['vt', 'erick', 'answer', 'tomorrow']) await drawer(ev[key].id);
    expect(await snapshot()).toBe(before);
  });
});
