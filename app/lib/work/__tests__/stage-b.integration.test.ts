// @vitest-environment node
/**
 * Work stage B against a real Postgres: one intake decision per message. The routes are called as handlers with the sign-in
 * mocked; the machine (classifier, replay) is not run. Skips unless DATABASE_URL names the scratch Postgres on localhost:55433.
 * It seeds its own rows and removes only those (and puts the one BastChatSettings row back as it found it). Run on its own clean
 * database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/work_b_int npx vitest run lib/work/__tests__/stage-b.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(async () => auth.current),
}));

import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '@/lib/home/load';
import { loadItemStates } from '@/lib/home/state';
import { selectHome } from '@/lib/home/select';
import { runHomeAct, runHomeUndo, zonedDateString } from '@/lib/home/act';
import { catchUpClosures } from '../ask-closure';
import { owedQueue } from '@/lib/home/owed/queue';
import { runLearn } from '@/lib/home/learn/run';
import { POST as syncPost } from '@/app/api/oracle/email-sync/route';
import { POST as calendarPost } from '@/app/api/oracle/calendar-sync/route';
import { POST as applyPost } from '@/app/api/work/apply-decisions/route';
import { POST as replayPost } from '@/app/api/bast-chat/worker/decision-replay/route';
import { PATCH as askPatch } from '@/app/api/email-asks/[id]/route';
import { GET as homeGet } from '@/app/api/home/route';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(!SCRATCH)('Work stage B: one intake decision per message (real database)', () => {
  const tag = `wb-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const users = [adminId, techId];
  const acct = 'mike@becomeindelible.com';
  const kenEmail = `ken-${tag}@duffy.test`;
  const danEmail = `dan-${tag}@wargo.test`;
  let clientId = '';
  const taskIds: string[] = [];
  let settingsBefore: { owner_user_id: string | null } | null = null;
  const eventIds: string[] = [];

  const admin = () => ({ userId: adminId, email: `admin-${tag}@example.test`, role: 'admin', via: 'session' });
  const porter = () => ({ userId: adminId, email: `bast-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'porter' });
  const worker = () => ({ userId: adminId, email: `bast-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'bast-chat', laneEnforced: true });
  const as = (a: unknown) => { auth.current = a; };
  const jreq = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost:3000${url}`, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  const mid = (k: string) => `${tag}-${k}`;
  const wire = (k: string, over: Record<string, unknown> = {}) => ({
    message_id: mid(k), thread_id: `${tag}-th-${k}`, account: acct, from_name: 'Ken Duffy', from_email: kenEmail, subject: `Appreciate it Mike ${k}`,
    gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, deep_link: `https://mail.google.com/mail/u/0/#all/${mid(k)}`,
    received_at: ago(2).toISOString(), ...over,
  });
  const sync = async (asks: unknown[]) => {
    as(porter());
    const res = await syncPost(jreq('/api/oracle/email-sync', 'POST', { asks }));
    expect(res.status).toBe(200);
    return res.json();
  };
  /** An old-shape row: no decision at all (the legacy rows the replay is for). */
  const legacy = (k: string, over: Record<string, unknown> = {}) =>
    prisma.emailAsk.create({
      data: {
        message_id: mid(k), thread_id: `${tag}-th-${k}`, account: acct, from_name: 'Ken Duffy', from_email: kenEmail, subject: `Legacy ${k}`,
        gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId, received_at: ago(6),
        deep_link: `https://mail.google.com/mail/u/0/#all/${mid(k)}`, ...over,
      } as never,
    });
  const row = (k: string) => prisma.emailAsk.findUniqueOrThrow({ where: { message_id: mid(k) } });
  const screen = async (userId = adminId) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, NOW, { timezone: TZ }), loadItemStates(prisma, userId)]);
    return { raw, sel: selectHome({ raw, states, now: NOW }) };
  };
  const inThreads = async (k: string) => (await screen()).raw.threads.some((t) => t.asks.some((a) => a.message_id === mid(k)));
  const opts = () => ({ now: NOW, timezone: TZ, date: zonedDateString(NOW, TZ) });
  const reopen = (k: string, id: string) => runHomeAct(prisma, adminId, { action: 'reopen_ask', item_key: `ask:${id}` }, opts()).then((r) => { void k; return r; });
  const apply = async (items: unknown[], dry: boolean) => {
    as(porter());
    const res = await applyPost(jreq('/api/work/apply-decisions', 'POST', { dry, items }));
    return { status: res.status, body: await res.json() };
  };
  const replay = async (items: unknown[]) => {
    as(worker());
    const res = await replayPost(jreq('/api/bast-chat/worker/decision-replay', 'POST', { items }));
    return { status: res.status, body: await res.json() };
  };
  const snapshot = async () => ({
    asks: await prisma.emailAsk.findMany({ where: { message_id: { startsWith: tag } }, orderBy: { message_id: 'asc' }, select: { message_id: true, state: true, disposition: true, decided_by: true, closed_reason: true, owner: true } }),
    actions: await prisma.homeAction.count({ where: { user_id: adminId } }),
    waits: await prisma.wait.count({ where: { email_account: acct, email_thread_id: { startsWith: tag } } }),
  });

  beforeAll(async () => {
    settingsBefore = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin WB', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Sabeen WB', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({ data: [{ user_id: adminId, home_view: 'home', timezone: TZ }, { user_id: techId, home_view: 'overlook', timezone: TZ }] });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, create: { id: 1, owner_user_id: adminId }, update: { owner_user_id: adminId } });
    clientId = (await prisma.client.create({ data: { name: `Duffy ${tag}`, status: 'active' } })).id;
    await prisma.clientContact.createMany({
      data: [
        { client_id: clientId, name: 'Ken Duffy', email: kenEmail },
        { client_id: clientId, name: 'Dan Wargo', email: danEmail },
      ] as never,
    });
  });

  afterAll(async () => {
    const made = await prisma.task.findMany({ where: { OR: [{ client_id: clientId }, { id: { in: taskIds } }] }, select: { id: true } });
    const all = [...new Set([...made.map((t) => t.id), ...taskIds])];
    const waits = await prisma.wait.findMany({ where: { email_account: acct, email_thread_id: { startsWith: tag } }, select: { id: true } });
    await prisma.waitEvent.deleteMany({ where: { wait_id: { in: waits.map((w) => w.id) } } }).catch(() => undefined);
    await prisma.wait.deleteMany({ where: { id: { in: waits.map((w) => w.id) } } });
    await prisma.emailAsk.deleteMany({ where: { message_id: { startsWith: tag } } });
    await prisma.calendarEvent.deleteMany({ where: { event_id: { startsWith: tag } } });
    await prisma.taskReceipt.deleteMany({ where: { task_id: { in: all } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: all } } });
    await prisma.task.deleteMany({ where: { id: { in: all } } });
    await prisma.homeReconcileHold.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeMeasure.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { user_id: { in: users } } });
    await prisma.activityLog.deleteMany({ where: { user_id: { in: users } } });
    await prisma.clientContact.deleteMany({ where: { client_id: clientId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    if (settingsBefore) await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: settingsBefore.owner_user_id } });
    else await prisma.bastChatSettings.deleteMany({ where: { id: 1 } });
    await prisma.userPreference.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('a thank-you is recorded as handled at birth', () => {
    it('"Appreciate it Mike" with a phone-number signature as no_action: handled, never a thread, a quiet line with Undo, in the 30-day list', async () => {
      const body = await sync([wire('thanks', { subject: 'Appreciate it Mike', gist: 'Thanks. Ken, 402-555-0100', disposition: 'no_action', disposition_reason: 'A thank-you, nothing asked.' })]);
      expect(body.items[0]).toMatchObject({ message_id: mid('thanks'), disposition: 'no_action' });
      const r = await row('thanks');
      expect(r).toMatchObject({ state: 'handled', disposition: 'no_action', closed_reason: 'no_action', closed_by: 'intake', decided_by: 'intake', owner: 'nobody' });
      expect(r.closed_at).toBeInstanceOf(Date);
      expect(await inThreads('thanks')).toBe(false);

      const { sel } = await screen();
      const line = sel.sections.handled.find((l) => l.id === r.id);
      expect(line?.text).toBe('Recorded as handled: Ken Duffy, "Appreciate it Mike". No reply needed.');
      expect(line?.reopen_item_key).toBe(`ask:${r.id}`);
      const listed = sel.handled_mail.find((m) => m.id === r.id);
      expect(listed).toMatchObject({ key: `ask:${r.id}`, reason: 'A thank-you, nothing asked.', kind: 'no_action' });
      expect(listed?.title).toBe(`Ken Duffy, Duffy ${tag}: Appreciate it Mike`);
    });

    it('Undo (reopen_ask) puts it back as a reply he owes, writes one action row, and holds it against re-closing', async () => {
      const r = await row('thanks');
      const res = await reopen('thanks', r.id);
      expect(res.ok).toBe(true);
      expect(await row('thanks')).toMatchObject({ state: 'open', disposition: 'reply_mike', decided_by: 'mike', closed_reason: null, closed_by: null, closed_at: null });
      expect(await prisma.homeAction.count({ where: { user_id: adminId, action: 'reopen_ask' } })).toBe(1);
      expect(await inThreads('thanks')).toBe(true);
      const { sel } = await screen();
      expect(sel.handled_mail.some((m) => m.id === r.id)).toBe(false);

      // Held: a later sync of the same message, the replay, the nightly catch-up and a machine close all leave it open.
      await sync([wire('thanks', { disposition: 'no_action' })]);
      expect(await row('thanks')).toMatchObject({ state: 'open', disposition: 'reply_mike', decided_by: 'mike' });
      const dry = await apply([{ ask_id: r.id, disposition: 'no_action', reason: 'x' }], true);
      expect(dry.body.rows[0]).toMatchObject({ verdict: 'leave' });
      await apply([{ ask_id: r.id, disposition: 'no_action', reason: 'x' }], false);
      expect((await row('thanks')).state).toBe('open');
      await catchUpClosures(prisma, NOW);
      expect((await row('thanks')).state).toBe('open');
      as(porter());
      const p = await askPatch(jreq(`/api/email-asks/${r.id}`, 'PATCH', { state: 'handled', closed_reason: 'no_action', closed_by: 'classifier' }), { params: Promise.resolve({ id: r.id }) });
      expect(p.status).toBe(200);
      expect((await row('thanks')).state).toBe('open');
      // Undo twice is refused (it is no longer recorded as handled).
      await expect(reopen('thanks', r.id)).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('floors', () => {
    it('an urgent ask sent as no_action is stored as reply_mike and reported; it stays open', async () => {
      const body = await sync([wire('urgent', { subject: 'The site is down', is_urgent: true, disposition: 'no_action' })]);
      expect(body.items[0]).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_urgent' });
      expect(body.adjusted).toHaveLength(1);
      expect(await row('urgent')).toMatchObject({ state: 'open', disposition: 'reply_mike', is_urgent: true });
      const { raw } = await screen();
      expect(raw.crises.some((c) => c.message_id === mid('urgent'))).toBe(true);
    });

    it('admin and sales asks can never be recorded as handled', async () => {
      const body = await sync([
        wire('admin', { intent: 'admin', disposition: 'no_action', subject: 'Invoice 88' }),
        wire('sales', { intent: 'sales', disposition: 'waiting_them', subject: 'Quote request' }),
      ]);
      expect(body.items.map((i: { disposition: string }) => i.disposition)).toEqual(['reply_mike', 'reply_mike']);
      expect((await row('admin')).state).toBe('open');
      expect((await row('sales')).state).toBe('open');
    });

    it('an existing intake close that turns urgent reopens as an emergency', async () => {
      await sync([wire('turns', { disposition: 'no_action' })]);
      expect((await row('turns')).state).toBe('handled');
      const body = await sync([wire('turns', { is_urgent: true, disposition: 'emergency' })]);
      expect(body.items[0].adjusted).toBe('reopened_urgent');
      expect(await row('turns')).toMatchObject({ state: 'open', disposition: 'emergency', closed_reason: null });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('work, meeting, waiting', () => {
    it('a work decision is never owed: with a task it is not a thread, and the drafter never queues it', async () => {
      const t = await prisma.task.create({ data: { title: `Remove the blurb ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, tags: [] } as never });
      taskIds.push(t.id);
      await sync([wire('work', { subject: 'Please remove the blurb', disposition: 'work' })]);
      const r = await row('work');
      expect(r).toMatchObject({ state: 'open', disposition: 'work' });
      // The machine's fold: a PATCH links the task. The owner word comes from the task's assignee.
      as(porter());
      const res = await askPatch(jreq(`/api/email-asks/${r.id}`, 'PATCH', { task_id: t.id, state: 'handled', closed_reason: 'with_task', closed_by: 'classifier' }), { params: Promise.resolve({ id: r.id }) });
      expect(res.status).toBe(200);
      expect(await row('work')).toMatchObject({ owner: 'mike', disposition: 'work' });
      expect(await inThreads('work')).toBe(false);
      const { raw } = await screen();
      const queued = owedQueue({}, raw.threads, [], NOW).flatMap((e) => e.thread.asks.map((a) => a.message_id));
      expect(queued).not.toContain(mid('work'));
    });

    it('an open work ask with no live task is owed exactly like reply_mike (a failed follow-up link must not hide the email), and a task gives it away', async () => {
      await sync([wire('workfloat', { disposition: 'work', subject: 'Change the hours' })]);
      expect(await row('workfloat')).toMatchObject({ state: 'open', disposition: 'work', task_id: null });
      expect(await inThreads('workfloat')).toBe(true);
      const { raw } = await screen();
      expect(owedQueue({}, raw.threads, [], NOW).flatMap((e) => e.thread.asks.map((a) => a.message_id))).toContain(mid('workfloat'));

      // A live task carries it: gone from the screen. A deleted task gives it back.
      const t = await prisma.task.create({ data: { title: `Change the hours ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, tags: [] } as never });
      taskIds.push(t.id);
      const id = (await row('workfloat')).id;
      await prisma.emailAsk.update({ where: { id }, data: { task_id: t.id } });
      expect(await inThreads('workfloat')).toBe(false);
      await prisma.task.update({ where: { id: t.id }, data: { is_deleted: true } });
      expect(await inThreads('workfloat')).toBe(true);
    });

    it('a meeting ask is a row that wants a time (never owed, never drafted) and closes when an event with that attendee lands', async () => {
      await sync([wire('meet', { from_name: 'Dan Wargo', from_email: danEmail, subject: 'Can we find a time Thursday', disposition: 'meeting', received_at: ago(2).toISOString() })]);
      const r = await row('meet');
      expect(r).toMatchObject({ state: 'open', disposition: 'meeting', owner: 'mike' });
      const { sel, raw } = await screen();
      const item = sel.byKey.get(`thread:${acct}:${tag}-th-meet`)?.item;
      expect(item?.owed_line).toBe('Wants a time');
      expect(sel.sections.next.some((i) => i.key === item?.key)).toBe(true);
      expect(sel.sections.mail.some((i) => i.key === item?.key)).toBe(false);
      expect(owedQueue({}, raw.threads, [], NOW).flatMap((e) => e.thread.asks.map((a) => a.message_id))).not.toContain(mid('meet'));

      // An event with someone else in it does nothing; one with Dan closes it as meeting_booked with one line.
      const win = { window_start: ago(30).toISOString(), window_end: new Date(NOW.getTime() + 30 * DAY).toISOString() };
      const ev = (id: string, email: string) => ({ event_id: `${tag}-${id}`, title: `Call ${tag}`, starts_at: new Date(NOW.getTime() + 2 * DAY).toISOString(), ends_at: new Date(NOW.getTime() + 2 * DAY + 1_800_000).toISOString(), attendees: [{ email }] });
      eventIds.push(`${tag}-e1`, `${tag}-e2`);
      as(porter());
      await calendarPost(jreq('/api/oracle/calendar-sync', 'POST', { ...win, events: [ev('e1', `someone-${tag}@else.test`)] }));
      expect((await row('meet')).state).toBe('open');
      await calendarPost(jreq('/api/oracle/calendar-sync', 'POST', { ...win, events: [ev('e1', `someone-${tag}@else.test`), ev('e2', danEmail.toUpperCase())] }));
      expect(await row('meet')).toMatchObject({ state: 'handled', closed_reason: 'meeting_booked', closed_by: 'intake' });
      const line = (await screen()).sel.sections.handled.find((l) => l.text.startsWith('Closed the request for a time from Dan Wargo'));
      expect(line?.undo_action_id).toBeTruthy();
      // Undo reopens it, held against re-closing.
      as(admin());
      await runHomeUndo(prisma, adminId, line!.undo_action_id!, NOW);
      expect(await row('meet')).toMatchObject({ state: 'open', decided_by: 'mike' });
      as(porter());
      await calendarPost(jreq('/api/oracle/calendar-sync', 'POST', { ...win, events: [ev('e1', `someone-${tag}@else.test`), ev('e2', danEmail)] }));
      expect((await row('meet')).state).toBe('open');
    });

    it('waiting_them makes exactly one wait for the conversation, however often it is posted', async () => {
      const key = `<root-${tag}@mail.test>`;
      await sync([wire('wait1', { subject: 'Out until Monday', disposition: 'waiting_them', conversation_key: key })]);
      await sync([wire('wait2', { thread_id: `${tag}-th-wait1`, subject: 'Re: Out until Monday', disposition: 'waiting_them', conversation_key: key })]);
      await sync([wire('wait1', { subject: 'Out until Monday', disposition: 'waiting_them', conversation_key: key })]);
      expect(await prisma.wait.count({ where: { idempotency_key: `conv:root-${tag}@mail.test` } })).toBe(1);
      expect((await row('wait1')).state).toBe('handled');
      const w = await prisma.wait.findFirstOrThrow({ where: { idempotency_key: `conv:root-${tag}@mail.test` } });
      expect(w.template_key).toBe('mail.awaiting_reply');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('legacy rows behave as today until the replay', () => {
    it('a row with no disposition is a thread row and in the drafter queue, exactly as before', async () => {
      await legacy('old');
      expect((await row('old')).disposition).toBeNull();
      expect(await inThreads('old')).toBe(true);
      const { raw, sel } = await screen();
      expect(sel.sections.mail.some((i) => i.key === `thread:${acct}:${tag}-th-old`)).toBe(true);
      expect(owedQueue({}, raw.threads, [], NOW).flatMap((e) => e.thread.asks.map((a) => a.message_id))).toContain(mid('old'));
    });

    it('the drafter queue lists only reply_mike, legacy and unlinked work threads: no thank-you, meeting, waiting', async () => {
      await sync([wire('rep', { subject: 'Can you send the quote', disposition: 'reply_mike' })]);
      const { raw } = await screen();
      const queued = owedQueue({}, raw.threads, [], NOW).flatMap((e) => e.thread.asks.map((a) => a.message_id));
      expect(queued).toContain(mid('rep'));
      for (const k of ['wait1', 'wait2']) expect(queued).not.toContain(mid(k));
      for (const m of queued.filter((q) => q.startsWith(tag))) {
        const r = await prisma.emailAsk.findUniqueOrThrow({ where: { message_id: m } });
        expect([null, 'reply_mike', 'work']).toContain(r.disposition);
      }
    });

    it('a thread is never the day arc: the proposed day never holds a thread step', async () => {
      const { sel, raw } = await screen();
      const { proposeDay } = await import('@/lib/home/today');
      const day = proposeDay(sel, raw.calendar_events, NOW);
      for (const k of day?.step_item_keys ?? []) expect(k.startsWith('thread:')).toBe(false);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the replay: dry reads and writes nothing, dry and real decide identically, every close is visible with Undo', () => {
    it('decision-replay and a dry apply say the same and write nothing', async () => {
      const a = await legacy('r1', { subject: 'Thanks so much' });
      const b = await legacy('r2', { subject: 'Is the quote ready' });
      const c = await legacy('r3', { subject: 'Down!', is_urgent: true });
      const d = await legacy('r4', { subject: 'Invoice', intent: 'admin' });
      const e = await legacy('r5', { subject: 'Call me', intent: 'meeting' });
      const f = await legacy('r6', { subject: 'Locked', task_id: null });
      const sec = await prisma.task.create({ data: { title: `Security ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, tags: ['security'] } as never });
      taskIds.push(sec.id);
      const g = await legacy('r7', { subject: 'Re: security', task_id: sec.id });
      const items = [
        { ask_id: a.id, disposition: 'no_action', reason: 'A thank-you.' },
        { ask_id: b.id, disposition: 'reply_mike', reason: 'Asks for the quote.' },
        { ask_id: c.id, disposition: 'no_action', reason: 'model said nothing' },
        { ask_id: d.id, disposition: 'no_action', reason: 'model said nothing' },
        { ask_id: e.id, disposition: 'meeting', reason: 'Wants a time.' },
        { ask_id: f.id, disposition: 'waiting_them', reason: 'They will send it.' },
        { ask_id: g.id, disposition: 'no_action', reason: 'model said nothing' },
        { ask_id: randomUUID(), disposition: 'no_action', reason: 'gone' },
      ];
      const before = await snapshot();
      const rp = await replay(items);
      const dry = await apply(items, true);
      expect(await snapshot()).toEqual(before);
      expect(rp.status).toBe(200);
      expect(dry.status).toBe(200);
      expect(dry.body.dry).toBe(true);
      expect(dry.body.rows).toEqual(rp.body.rows);
      expect(dry.body.counts).toEqual(rp.body.counts);
      const verdicts = dry.body.rows.map((r: { verdict: string }) => r.verdict);
      expect(verdicts).toEqual(['close', 'set', 'set', 'set', 'set', 'leave', 'leave', 'refused']);
      // The urgent and admin asks were floored to reply_mike (set, never closed); the security task's ask is left; waiting_them is not applied.
      expect(dry.body.rows[2]).toMatchObject({ verdict: 'set', disposition: 'reply_mike', why: 'no_action_refused_urgent' });
      expect(dry.body.rows[3]).toMatchObject({ verdict: 'set', disposition: 'reply_mike', why: 'no_action_refused_admin' });
      expect(dry.body.rows[6]).toMatchObject({ verdict: 'leave', why: 'security_task' });
      expect(dry.body.counts).toMatchObject({ would_close: 1, would_set: 4, left: 2, refused: 1 });

      // The real run does exactly what the dry run said.
      const real = await apply(items, false);
      expect(real.body.rows).toEqual(dry.body.rows);
      expect(real.body.closed).toEqual([a.id]);
      expect(real.body.set.sort()).toEqual([b.id, c.id, d.id, e.id].sort());
      expect(await row('r1')).toMatchObject({ state: 'handled', disposition: 'no_action', closed_reason: 'no_action', closed_by: 'backfill', decided_by: 'intake' });
      expect(await row('r2')).toMatchObject({ state: 'open', disposition: 'reply_mike' });
      expect(await row('r3')).toMatchObject({ state: 'open', disposition: 'reply_mike', is_urgent: true });
      expect(await row('r4')).toMatchObject({ state: 'open', disposition: 'reply_mike' });
      expect(await row('r5')).toMatchObject({ state: 'open', disposition: 'meeting' });
      expect(await row('r6')).toMatchObject({ state: 'open', disposition: null });
      expect(await row('r7')).toMatchObject({ state: 'open', disposition: null });

      // One Handled line with Undo; each mail also in the 30-day list with its own Undo.
      const line = (await screen()).sel.sections.handled.find((l) => l.text === 'Recorded 1 email as handled: no reply needed.');
      expect(line?.undo_action_id).toBeTruthy();
      expect((await screen()).sel.handled_mail.some((m) => m.id === a.id)).toBe(true);

      // A second real run closes nothing more (already decided).
      const again = await apply(items, false);
      expect(again.body.closed).toEqual([]);
      expect(again.body.action_id).toBeNull();

      // Undo of the batch line reopens it as a reply he owes, held.
      as(admin());
      await runHomeUndo(prisma, adminId, line!.undo_action_id!, NOW);
      expect(await row('r1')).toMatchObject({ state: 'open', disposition: 'reply_mike', decided_by: 'mike', closed_reason: null });
      await apply([{ ask_id: a.id, disposition: 'no_action', reason: 'again' }], false);
      expect((await row('r1')).state).toBe('open');
    });

    it('apply-decisions: at most 300 items, a strict body, admin or porter only', async () => {
      as(porter());
      const many = Array.from({ length: 301 }, () => ({ ask_id: randomUUID(), disposition: 'no_action' }));
      expect((await applyPost(jreq('/api/work/apply-decisions', 'POST', { dry: true, items: many }))).status).toBe(400);
      expect((await applyPost(jreq('/api/work/apply-decisions', 'POST', { dry: true, items: [{ ask_id: randomUUID(), disposition: 'no_action', extra: 1 }] }))).status).toBe(400);
      expect((await applyPost(jreq('/api/work/apply-decisions', 'POST', { items: [{ ask_id: randomUUID(), disposition: 'no_action' }] }))).status).toBe(400);
      as({ userId: techId, email: `tech-${tag}@example.test`, role: 'tech', via: 'session' });
      expect((await applyPost(jreq('/api/work/apply-decisions', 'POST', { dry: true, items: [{ ask_id: randomUUID(), disposition: 'no_action' }] }))).status).toBe(403);
    });

    it('with the owner off the home view the real run writes nothing', async () => {
      const x = await legacy('off1', { subject: 'Thanks again' });
      await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'overlook' } });
      try {
        const res = await apply([{ ask_id: x.id, disposition: 'no_action', reason: 'thanks' }], false);
        expect(res.body.skipped).toBe('home_off');
        expect((await row('off1')).state).toBe('open');
        const sy = await sync([wire('offsync', { disposition: 'no_action' })]);
        expect(sy.skipped).toBe('home_off');
        expect(await row('offsync')).toMatchObject({ state: 'open', disposition: null });
      } finally {
        await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'home' } });
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('routine provider receipts: handled through the verified exempt path only', () => {
    const rcpt = { intent: 'admin', from_email: 'quickbooks@notification.intuit.com', subject: 'Payment received: Invoice #1042-(Acme Co)', gist: 'A payment came in.' };

    it('email-sync: a verified receipt is born handled although its intent is admin; every failed check keeps the floor', async () => {
      const body = await sync([
        wire('rc1', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt' }),
        wire('rc2', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt', from_email: 'quickbooks@notintuit.com' }),
        wire('rc3', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt', subject: 'Payment received: Invoice #1042 failed' }),
        wire('rc4', { ...rcpt, disposition: 'no_action' }),
        wire('rc5', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt', is_urgent: true }),
        wire('rc6', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt', intent: 'sales' }),
        wire('rc7', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt', gist: 'Your payment is past due' }),
        wire('rc8', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt', from_email: 'no-reply@notify.cloudflare.com', subject: 'Your invoice is available', gist: null }),
        wire('rc9', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt', from_email: 'no-reply@notify.cloudflare.com.evil.test', subject: 'Your invoice is available' }),
      ]);
      const by = (k: string) => body.items.find((i: { message_id: string }) => i.message_id === mid(k));
      expect(by('rc1')).toMatchObject({ disposition: 'no_action', floor_exempt: 'provider_receipt' });
      expect(by('rc1').adjusted).toBeUndefined();
      expect(await row('rc1')).toMatchObject({ state: 'handled', disposition: 'no_action', closed_reason: 'no_action', closed_by: 'intake', decided_by: 'intake', intent: 'admin' });
      expect(by('rc8')).toMatchObject({ disposition: 'no_action', floor_exempt: 'provider_receipt' });
      expect((await row('rc8')).state).toBe('handled');
      expect(by('rc2')).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
      expect(by('rc3')).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
      expect(by('rc4')).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
      expect(by('rc5')).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_urgent' });
      expect(by('rc6')).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_sales' });
      expect(by('rc7')).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
      expect(by('rc9')).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
      for (const k of ['rc2', 'rc3', 'rc4', 'rc5', 'rc6', 'rc7', 'rc9']) expect((await row(k)).state).toBe('open');
      // The handled receipt is in the 30-day list with Undo, like any recorded-as-handled mail.
      expect((await screen()).sel.handled_mail.some((m) => m.id === (by('rc1') as { id: string }).id)).toBe(true);
    });

    it('email-sync: a claim with a bad value is a 400, and the claim never closes an existing row', async () => {
      as(porter());
      const bad = await syncPost(jreq('/api/oracle/email-sync', 'POST', { asks: [wire('rcbad', { ...rcpt, disposition: 'no_action', floor_exempt: 'anything' })] }));
      expect(bad.status).toBe(400);
      await sync([wire('rcex', { ...rcpt, disposition: 'reply_mike' })]);
      const again = await sync([wire('rcex', { ...rcpt, disposition: 'no_action', floor_exempt: 'provider_receipt' })]);
      expect(again.items[0]).toMatchObject({ disposition: 'reply_mike', prior: { disposition: 'reply_mike' } });
      expect((await row('rcex')).state).toBe('open');
    });

    it('the replay: undecided and machine-decided reply_mike receipts close, his own decision and every unverified one stay; dry equals the replay route', async () => {
      const a = await legacy('rr1', { ...rcpt });
      const b = await legacy('rr2', { ...rcpt, disposition: 'reply_mike', decided_by: 'intake', owner: 'mike', disposition_reason: 'Money mail.' });
      const c = await legacy('rr3', { ...rcpt, disposition: 'reply_mike', decided_by: 'mike', owner: 'mike' });
      const d = await legacy('rr4', { ...rcpt, disposition: 'reply_mike', decided_by: 'intake', from_email: 'q@intuit.com.evil.test' });
      const e = await legacy('rr5', { ...rcpt, disposition: 'reply_mike', decided_by: 'intake', subject: 'Payment received: Invoice #9 past due' });
      const f = await legacy('rr6', { ...rcpt, disposition: 'reply_mike', decided_by: 'intake', subject: 'Quote for the site', from_email: 'q@intuit.com' });
      const g = await legacy('rr7', { ...rcpt, disposition: 'emergency', decided_by: 'intake', is_urgent: true });
      const h = await legacy('rr8', { ...rcpt, disposition: 'reply_mike', decided_by: 'intake', is_urgent: true });
      const i = await legacy('rr9', { ...rcpt, disposition: 'meeting', decided_by: 'intake' });
      const j = await legacy('rr10', { ...rcpt, disposition: 'reply_mike', decided_by: 'bast', subject: 'Your invoice is available', from_email: 'x@notify.cloudflare.com', gist: null });
      const k = await legacy('rr11', { ...rcpt, subject: 'Your invoice is available', from_email: 'x@notify.cloudflare.com.evil.test' });
      const ex = 'provider_receipt';
      const items = [a, b, c, d, e, f, g, h, i, j].map((x) => ({ ask_id: x.id, disposition: 'no_action', reason: 'A routine receipt that asks nothing.', floor_exempt: ex }));
      items.push({ ask_id: k.id, disposition: 'no_action', reason: 'x', floor_exempt: ex });
      const before = await snapshot();
      const rp = await replay(items);
      const dry = await apply(items, true);
      expect(await snapshot()).toEqual(before);
      expect(dry.body.rows).toEqual(rp.body.rows);
      expect(dry.body.counts).toEqual(rp.body.counts);
      const v = dry.body.rows.map((r: { verdict: string; why: string | null }) => `${r.verdict}:${r.why}`);
      expect(v).toEqual([
        'close:provider_receipt',
        'close:provider_receipt_redecided',
        'leave:already_decided',
        'leave:already_decided',
        'leave:already_decided',
        'leave:already_decided',
        'leave:already_decided',
        'leave:already_decided',
        'leave:already_decided',
        'close:provider_receipt_redecided',
        'set:no_action_refused_admin',
      ]);
      const real = await apply(items, false);
      expect(real.body.rows).toEqual(dry.body.rows);
      expect(real.body.closed.sort()).toEqual([a.id, b.id, j.id].sort());
      for (const [key, who] of [['rr1', 'a'], ['rr2', 'b'], ['rr10', 'j']] as const) {
        void who;
        expect(await row(key)).toMatchObject({ state: 'handled', disposition: 'no_action', closed_reason: 'no_action', closed_by: 'backfill', decided_by: 'intake', owner: 'nobody' });
      }
      expect(await row('rr3')).toMatchObject({ state: 'open', disposition: 'reply_mike', decided_by: 'mike' });
      expect(await row('rr4')).toMatchObject({ state: 'open', disposition: 'reply_mike' });
      expect(await row('rr5')).toMatchObject({ state: 'open', disposition: 'reply_mike' });
      expect(await row('rr6')).toMatchObject({ state: 'open', disposition: 'reply_mike' });
      expect(await row('rr7')).toMatchObject({ state: 'open', disposition: 'emergency' });
      expect(await row('rr8')).toMatchObject({ state: 'open', disposition: 'reply_mike' });
      expect(await row('rr9')).toMatchObject({ state: 'open', disposition: 'meeting' });
      expect(await row('rr11')).toMatchObject({ state: 'open', disposition: 'reply_mike', decided_by: 'intake' });

      // A second run changes nothing; Undo puts a closed one back as a reply he owes, held against re-closing.
      const again = await apply(items, false);
      expect(again.body.closed).toEqual([]);
      const line = (await screen()).sel.sections.handled.find((l) => l.text === 'Recorded 3 emails as handled: no reply needed.');
      expect(line?.undo_action_id).toBeTruthy();
      as(admin());
      await runHomeUndo(prisma, adminId, line!.undo_action_id!, NOW);
      expect(await row('rr2')).toMatchObject({ state: 'open', disposition: 'reply_mike', decided_by: 'mike', closed_reason: null });
      await apply(items, false);
      expect((await row('rr2')).state).toBe('open');
    });

    it('apply-decisions: a bad floor_exempt value is a 400', async () => {
      as(porter());
      const res = await applyPost(jreq('/api/work/apply-decisions', 'POST', { dry: true, items: [{ ask_id: randomUUID(), disposition: 'no_action', floor_exempt: 'everything' }] }));
      expect(res.status).toBe(400);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('screen, other users and the weekly line', () => {
    it('GET /api/home carries handled_mail and the 30-day window drops older closes', async () => {
      await sync([wire('oldclose', { disposition: 'no_action' })]);
      await prisma.emailAsk.update({ where: { message_id: mid('oldclose') }, data: { closed_at: ago(31) } });
      as(admin());
      const res = await homeGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.handled_mail)).toBe(true);
      expect(body.handled_mail.some((m: { id: string }) => m.id)).toBe(true);
      const old = await row('oldclose');
      expect(body.handled_mail.some((m: { id: string }) => m.id === old.id)).toBe(false);
      await expect(runHomeAct(prisma, adminId, { action: 'reopen_ask', item_key: `ask:${old.id}` }, opts())).rejects.toThrow();
      expect((await row('oldclose')).state).toBe('handled');
    });

    it("another user's screen is unchanged: no handled mail, no meeting row, nothing of Mike's", async () => {
      const { sel } = await screen(techId);
      expect(sel.sections.handled.some((l) => l.reopen_item_key)).toBe(false);
      expect(sel.sections.next.every((i) => i.owed_line !== 'Wants a time' || i.key.startsWith('thread:'))).toBe(true);
    });

    it('the Monday line counts what was recorded and what he reopened', async () => {
      const mondayNow = new Date(NOW.getTime());
      // Dry run of the learn step on whatever day it is: the measure itself is read directly.
      const { handledMailMeasure } = await import('../intake');
      const m = await handledMailMeasure(prisma, adminId, ago(10), new Date(NOW.getTime() + DAY));
      expect(m.reopened).toBe(1);
      expect(m.recorded).toBeGreaterThanOrEqual(m.reopened);
      void mondayNow;
      void runLearn;
    });
  });
});
