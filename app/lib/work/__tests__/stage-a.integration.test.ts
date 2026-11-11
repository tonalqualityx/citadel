// @vitest-environment node
/**
 * Work stage A against a real Postgres: link and close. The routes are called as handlers with the sign-in mocked; the machine
 * (classifier, create-task.py, backfill.py) is not run. Skips unless DATABASE_URL names the scratch Postgres on localhost:55433.
 * It seeds its own rows and removes only those (and puts the one BastChatSettings row back as it found it). Run on its own clean
 * database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/work_a_int npx vitest run lib/work/__tests__/stage-a.integration.test.ts
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
import { runHomeUndo } from '@/lib/home/act';
import { runKeeper } from '@/lib/home/keeper/run';
import { owedQueue } from '@/lib/home/owed/queue';
import { markLive } from '@/lib/portal/go-live';
import { PATCH as askPatch } from '@/app/api/email-asks/[id]/route';
import { PATCH as taskPatchRoute } from '@/app/api/tasks/[id]/route';
import { POST as tasksPost } from '@/app/api/tasks/route';
import { POST as syncPost } from '@/app/api/oracle/email-sync/route';
import { POST as backfillPost } from '@/app/api/work/backfill-links/route';
import { closeAsksForTask } from '../ask-closure';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(!SCRATCH)('Work stage A: link and close (real database)', () => {
  const tag = `wa-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const users = [adminId, techId];
  const acct = 'mike@becomeindelible.com';
  const bastAcct = 'bast@becomeindelible.com';
  const sender = `jeffrey-${tag}@knisely.test`;
  let clientId = '';
  const taskIds: string[] = [];
  const ids: Record<string, string> = {};
  let settingsBefore: { owner_user_id: string | null } | null = null;

  const admin = () => ({ userId: adminId, email: `admin-${tag}@example.test`, role: 'admin', via: 'session' });
  const porter = () => ({ userId: adminId, email: `bast-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'porter' });
  const as = (a: unknown) => { auth.current = a; };

  const task = async (k: string, over: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${k} ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, tags: [], ...over } as never });
    ids[k] = t.id;
    taskIds.push(t.id);
    return t;
  };
  const ask = (k: string, over: Record<string, unknown> = {}) =>
    prisma.emailAsk.create({
      data: {
        message_id: `${tag}-${k}`, thread_id: `${tag}-th-${k}`, account: acct, from_name: 'Jeffrey Knisely', from_email: sender, subject: `Website update ${k}`,
        gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId, received_at: ago(6),
        deep_link: `https://mail.google.com/mail/u/0/#all/${tag}-${k}`, ...over,
      } as never,
    });
  const row = (k: string) => prisma.emailAsk.findUniqueOrThrow({ where: { message_id: `${tag}-${k}` } });
  const jreq = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost:3000${url}`, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const patchAsk = async (k: string, body: unknown) => {
    const r = await row(k);
    return askPatch(jreq(`/api/email-asks/${r.id}`, 'PATCH', body), { params: Promise.resolve({ id: r.id }) });
  };
  const patchTaskStatus = (k: string, status: string) =>
    taskPatchRoute(jreq(`/api/tasks/${ids[k]}`, 'PATCH', { status }), { params: Promise.resolve({ id: ids[k] }) });
  const screen = async (userId = adminId) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, NOW, { timezone: TZ }), loadItemStates(prisma, userId)]);
    return { raw, sel: selectHome({ raw, states, now: NOW }) };
  };
  const inThreads = async (k: string) => (await screen()).raw.threads.some((t) => t.asks.some((a) => a.message_id === `${tag}-${k}`));
  const inMail = async (k: string) => (await screen()).sel.sections.mail.some((i) => i.key === `thread:${acct}:${tag}-th-${k}`);
  const lines = async () => (await screen()).sel.sections.handled;
  const actions = (userId = adminId) => prisma.homeAction.findMany({ where: { user_id: userId, action: 'work_close' }, orderBy: { created_at: 'asc' } });
  const snapshot = async () => ({
    asks: (await prisma.emailAsk.findMany({ where: { message_id: { startsWith: tag } }, orderBy: { message_id: 'asc' }, select: { message_id: true, state: true, task_id: true, rfc_message_id: true, conversation_key: true, closed_reason: true } })),
    actions: await prisma.homeAction.count({ where: { user_id: adminId } }),
    holds: await prisma.homeReconcileHold.count({ where: { user_id: adminId } }),
    tasks: (await prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' }, select: { id: true, status: true, updated_at: true } })).map((t) => `${t.id}:${t.status}:${t.updated_at.toISOString()}`),
  });

  beforeAll(async () => {
    settingsBefore = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin WA', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Sabeen WA', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({ data: [{ user_id: adminId, home_view: 'home', timezone: TZ }, { user_id: techId, home_view: 'overlook', timezone: TZ }] });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, create: { id: 1, owner_user_id: adminId }, update: { owner_user_id: adminId } });
    clientId = (await prisma.client.create({ data: { name: `Knisely ${tag}`, status: 'active' } })).id;
    await prisma.clientContact.create({ data: { client_id: clientId, name: 'Jeffrey Knisely', email: sender } as never });
    await task('techs', { assignee_id: techId, title: `Sabeen own task ${tag}` });
  });

  afterAll(async () => {
    const made = await prisma.task.findMany({ where: { OR: [{ client_id: clientId }, { id: { in: taskIds } }] }, select: { id: true } });
    const all = [...new Set([...made.map((t) => t.id), ...taskIds])];
    await prisma.emailAsk.deleteMany({ where: { message_id: { startsWith: tag } } });
    await prisma.taskReceipt.deleteMany({ where: { task_id: { in: all } } });
    await prisma.emailOutbox.deleteMany({ where: { task_id: { in: all } } }).catch(() => undefined);
    await prisma.comment.deleteMany({ where: { task_id: { in: all } } });
    await prisma.wait.deleteMany({ where: { task_id: { in: all } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: users } } });
    await prisma.task.deleteMany({ where: { id: { in: all } } });
    await prisma.homeReconcileHold.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } }).catch(() => undefined);
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
  describe('the Knisely replay: link while the task is open, close when it finishes', () => {
    it('an ask linked to an open task is never owed, never drafted, never a thread row; an unlinked twin still is', async () => {
      await task('T', { title: `Add the blurb ${tag}` });
      await ask('k1');
      await ask('k1twin'); // the same kind of ask with nothing linked: still his
      expect(await inThreads('k1')).toBe(true);
      expect(await inMail('k1')).toBe(true);

      as(porter());
      const res = await patchAsk('k1', { task_id: ids.T });
      expect(res.status).toBe(200);
      expect((await row('k1')).state).toBe('open'); // linked only
      expect(await inThreads('k1')).toBe(false);
      expect(await inMail('k1')).toBe(false);
      expect(await inThreads('k1twin')).toBe(true);
      expect(await inMail('k1twin')).toBe(true);

      // The drafter's queue reads the same threads, so the linked ask is not drafted.
      const { raw } = await screen();
      const queued = owedQueue({}, raw.threads, [], NOW).map((e) => e.thread.asks.map((a) => a.message_id)).flat();
      expect(queued).not.toContain(`${tag}-k1`);
      expect(queued).toContain(`${tag}-k1twin`);

      // The task card carries it under Email.
      const sel = (await screen()).sel;
      const card = sel.byKey.get(`task:${ids.T}`)?.item;
      expect(card?.opened.links.some((l) => l.label === `Email: Jeffrey Knisely, ${new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(ago(6))}: Website update k1`)).toBe(true);
      const raw2 = (await screen()).raw.tasks.find((t) => t.id === ids.T);
      expect(raw2?.emails?.map((e) => e.ask_id)).toEqual([(await row('k1')).id]);
    });

    it('when the task finishes (the PATCH route) its emails close with one Handled line and Undo', async () => {
      as(admin());
      expect((await patchTaskStatus('T', 'done')).status).toBe(200);
      const r = await row('k1');
      expect(r).toMatchObject({ state: 'handled', closed_reason: 'task_done', closed_by: 'task' });
      expect(r.closed_at).toBeInstanceOf(Date);
      expect((await row('k1twin')).state).toBe('open'); // not linked, not touched
      expect(await inThreads('k1')).toBe(false);
      const acts = await actions();
      expect(acts).toHaveLength(1);
      const line = (await lines()).find((l) => l.id === acts[0].id)!;
      expect(line.text).toBe(`Closed 1 email from Jeffrey Knisely: done in "Add the blurb ${tag}" (${new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(ago(6))}).`);
      expect(line.undo_action_id).toBe(acts[0].id);
      expect(line.href).toContain(`${tag}-k1`);
      expect(line.text).not.toMatch(/[–—]|priorit|overdue/i);
    });

    it('closing again (a re-PATCH, or the closure called directly) closes nothing and writes no second line', async () => {
      as(admin());
      await patchTaskStatus('T', 'done');
      const again = await closeAsksForTask(prisma, ids.T, 'done');
      expect(again.closed).toEqual([]);
      expect(await actions()).toHaveLength(1);
    });

    it('Undo reopens exactly those asks, holds the task for 30 days, and a second Undo is refused', async () => {
      const [a] = await actions();
      await prisma.emailAsk.update({ where: { message_id: `${tag}-k1twin` }, data: { state: 'open' } });
      const out = await runHomeUndo(prisma, adminId, a.id, new Date());
      expect(out.ok).toBe(true);
      expect(await row('k1')).toMatchObject({ state: 'open', closed_at: null, closed_reason: null, closed_by: null });
      const hold = await prisma.homeReconcileHold.findUnique({ where: { user_id_target_key: { user_id: adminId, target_key: `work_close:${ids.T}` } } });
      expect(hold).not.toBeNull();
      expect(hold!.until.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
      await expect(runHomeUndo(prisma, adminId, a.id, new Date())).rejects.toMatchObject({ code: 'undo_used' });
      // Held: neither a second PATCH to done nor the closure closes them again.
      as(admin());
      await patchTaskStatus('T', 'in_progress');
      await patchTaskStatus('T', 'done');
      expect((await row('k1')).state).toBe('open');
      expect((await closeAsksForTask(prisma, ids.T, 'done')).held.undone).toEqual([ids.T]);
      // And it is still carried by the task, so still not owed.
      expect(await inThreads('k1')).toBe(false);
    });

    it('Undo leaves an ask Mike changed since as he left it', async () => {
      await task('T2', { title: `Second job ${tag}` });
      await ask('u1', { task_id: ids.T2 });
      await ask('u2', { task_id: ids.T2 });
      as(admin());
      await patchTaskStatus('T2', 'done');
      const acts = await actions();
      const mine = acts[acts.length - 1];
      await prisma.emailAsk.update({ where: { message_id: `${tag}-u2` }, data: { state: 'dismissed' } });
      await runHomeUndo(prisma, adminId, mine.id, new Date());
      expect((await row('u1')).state).toBe('open');
      expect((await row('u2')).state).toBe('dismissed');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the fold, as the classifier does it', () => {
    it('a fold to an open task with state handled and closed_reason with_task is linked, closed, and never a thread row', async () => {
      await task('F');
      await ask('f1');
      as(porter());
      const res = await patchAsk('f1', { task_id: ids.F, state: 'handled', closed_reason: 'with_task', closed_by: 'classifier' });
      expect(res.status).toBe(200);
      expect(await row('f1')).toMatchObject({ state: 'handled', task_id: ids.F, closed_reason: 'with_task', closed_by: 'classifier' });
      expect(await inThreads('f1')).toBe(false);
    });

    it('a fold into a security-tagged task is linked and kept open, never closed by inference', async () => {
      await task('S', { tags: ['security'] });
      await ask('s1');
      as(porter());
      const res = await patchAsk('s1', { task_id: ids.S, state: 'handled', closed_reason: 'with_task', closed_by: 'classifier' });
      expect((await res.json()).ignored_fields).toContain('state');
      expect(await row('s1')).toMatchObject({ state: 'open', task_id: ids.S, closed_reason: null });
      // The security task finishes: still not closed, and it stays carried by the task.
      as(admin());
      await patchTaskStatus('S', 'done');
      expect((await row('s1')).state).toBe('open');
      expect(await inThreads('s1')).toBe(false);
    });

    it('a message after the work finished stays open and unlinked, and is owed as before', async () => {
      await task('D', { status: 'done', completed_at: ago(3) });
      await ask('d1', { received_at: ago(1) });
      expect(await inThreads('d1')).toBe(true);
      // Even if it were linked by hand, the closure never closes an ask that arrived after the task finished.
      await prisma.emailAsk.update({ where: { message_id: `${tag}-d1` }, data: { task_id: ids.D } });
      const r = await closeAsksForTask(prisma, ids.D, 'done', { finishedAt: ago(3) });
      expect(r.closed).toEqual([]);
      expect((await row('d1')).state).toBe('open');
    });

    it('an urgent ask keeps its emergency path: linked, never closed', async () => {
      await task('U');
      await ask('ur1', { is_urgent: true, task_id: ids.U });
      as(admin());
      await patchTaskStatus('U', 'done');
      expect((await row('ur1')).state).toBe('open');
      expect((await screen()).raw.crises.some((c) => c.message_id === `${tag}-ur1`)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('a lane files a task from mail (POST /api/tasks)', () => {
    it('an email-check task with a bast@ source_ref plus source_rfc links the mike@ copy and the earlier asks of the conversation', async () => {
      const rfc = `<Msg-${tag}@mail.gmail.com>`;
      const root = `root-${tag}@mail.gmail.com`;
      // The mike@ copy comes in through email-sync, with the keys.
      as(porter());
      const sync = await syncPost(jreq('/api/oracle/email-sync', 'POST', { asks: [
        { message_id: `${tag}-mk-early`, thread_id: `${tag}-th-conv`, account: acct, from_email: sender, from_name: 'Jeffrey Knisely', subject: 'Website update', deep_link: 'https://mail.google.com/x1', received_at: ago(8).toISOString(), rfc_message_id: `early-${tag}@mail.gmail.com`, conversation_key: root },
        { message_id: `${tag}-mk-copy`, thread_id: `${tag}-th-conv`, account: acct, from_email: sender, from_name: 'Jeffrey Knisely', subject: 'Re: Website update', deep_link: 'https://mail.google.com/x2', received_at: ago(6).toISOString(), rfc_message_id: rfc, conversation_key: root },
      ] }));
      expect(sync.status).toBe(200);
      expect(await row('mk-copy')).toMatchObject({ rfc_message_id: rfc.slice(1, -1).toLowerCase(), conversation_key: root });
      // email-check filed from the bast@ copy, which has a different message id.
      await ask('bast-copy', { account: bastAcct, thread_id: `${tag}-th-bast`, rfc_message_id: rfc.slice(1, -1).toLowerCase(), conversation_key: root, received_at: ago(6), state: 'dismissed' });
      as(admin());
      const res = await tasksPost(jreq('/api/tasks', 'POST', { title: `Update the blurb ${tag}`, source: 'email', source_ref: `${tag}-bast-copy`, source_rfc: rfc, assignee_id: adminId }));
      expect(res.status).toBe(201);
      const created = await res.json();
      taskIds.push(created.id);
      expect(await row('mk-copy')).toMatchObject({ task_id: created.id, state: 'handled', closed_reason: 'with_task', closed_by: 'intake' });
      expect(await row('mk-early')).toMatchObject({ task_id: created.id, state: 'handled', closed_reason: 'with_task' });
      expect((await row('bast-copy')).task_id).toBe(created.id);
      expect(await inThreads('mk-copy')).toBe(false);
    });

    it('a task from internal or with no source_ref links nothing', async () => {
      await ask('plain1');
      as(admin());
      const res = await tasksPost(jreq('/api/tasks', 'POST', { title: `Plain ${tag}`, source: 'internal', source_ref: `${tag}-plain1`, assignee_id: adminId }));
      taskIds.push((await res.json()).id);
      expect(await row('plain1')).toMatchObject({ task_id: null, state: 'open' });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('going live (markLive) closes the emails', () => {
    it('markLive finishes the task and its emails close, with the same line and Undo', async () => {
      await task('L', { status: 'review', title: `Staged change ${tag}` });
      await ask('l1', { task_id: ids.L });
      const before = (await actions()).length;
      await markLive({ taskId: ids.L, authorId: adminId, liveUrl: 'https://example.test/live', force: true, callerRole: 'admin', callerVia: 'session', summary: 'The blurb is live' });
      expect(await row('l1')).toMatchObject({ state: 'handled', closed_reason: 'task_done', closed_by: 'task' });
      expect((await actions()).length).toBe(before + 1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the nightly catch-up (the keeper run)', () => {
    it('closes an ask whose task finished by a path that missed it, never a security task, never one that arrived after', async () => {
      await task('C', { title: `Missed path ${tag}` });
      await task('CS', { tags: ['security-report'] });
      await ask('c1', { task_id: ids.C, received_at: ago(5) });
      await ask('c2', { task_id: ids.C, received_at: ago(0.0001) }); // arrived after it finished
      await ask('cs1', { task_id: ids.CS, received_at: ago(5) });
      const finished = ago(1);
      await prisma.task.updateMany({ where: { id: { in: [ids.C, ids.CS] } }, data: { status: 'done', completed_at: finished } });
      const dry = await runKeeper(prisma, adminId, new Date(NOW.getTime() + 2 * DAY), { dryRun: true });
      expect(dry.work_catchup?.would_close).toBe(1);
      expect((await row('c1')).state).toBe('open');
      const real = await runKeeper(prisma, adminId, new Date(NOW.getTime() + 2 * DAY), { dryRun: false });
      expect(real.work_catchup).toEqual({ would_close: 1, closed: 1 });
      expect(await row('c1')).toMatchObject({ state: 'handled', closed_reason: 'task_done', closed_by: 'catchup' });
      expect((await row('c2')).state).toBe('open');
      expect((await row('cs1')).state).toBe('open');
      const acts = await actions();
      expect(acts[acts.length - 1].undo_until).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the one-time tidy (POST /api/work/backfill-links)', () => {
    const bf: Record<string, string> = {};
    let body: Record<string, unknown>;

    it('seeds: finished and open tasks, asks before and after completion, a security task, an urgent ask', async () => {
      const done3 = ago(3);
      await task('B1', { status: 'done', completed_at: done3, source: 'email', source_ref: `${tag}-bm1`, origin_url: null });
      await task('B2', { status: 'in_progress', source: 'email', source_ref: null, origin_url: `https://mail.google.com/mail/u/0/#all/${tag}-bo1` });
      await task('B3', { status: 'done', completed_at: done3, tags: ['security'], source: 'email', source_ref: `${tag}-bs1` });
      await task('B4', { status: 'done', completed_at: done3, source: 'email', source_ref: `${tag}-bu1` });
      await ask('bm1', { thread_id: `${tag}-th-b1`, received_at: ago(5) });
      await ask('bm1b', { account: bastAcct, thread_id: `${tag}-th-b1bast`, received_at: ago(5) });
      await ask('bm-late', { thread_id: `${tag}-th-b1`, received_at: ago(1) });
      await ask('bo1', { received_at: ago(4) });
      await ask('bs1', { received_at: ago(5) });
      await ask('bu1', { received_at: ago(5), is_urgent: true });
      await ask('bx', { thread_id: `${tag}-th-unrelated`, received_at: ago(5) });
      await ask('bkeyed', { received_at: ago(5), rfc_message_id: 'already@set.test', conversation_key: 'already-root@set.test' });
      for (const k of ['bm1', 'bm1b', 'bm-late', 'bo1', 'bs1', 'bu1', 'bx', 'bkeyed']) bf[k] = (await row(k)).id;
      const pair = (k: string, t: string, basis: string) => ({ ask_id: bf[k], task_id: ids[t], basis });
      body = {
        pairs: [
          pair('bm1', 'B1', 'source_ref'),
          pair('bm1b', 'B1', 'cross_mailbox'),
          pair('bm-late', 'B1', 'registry'),
          pair('bo1', 'B2', 'mint_ledger'),
          pair('bs1', 'B3', 'source_ref'),
          pair('bu1', 'B4', 'source_ref'),
          pair('bx', 'B1', 'registry'), // no shared conversation: not proven
          pair('bm1', 'B1', 'source_ref'), // named twice
          { message_id: `${tag}-nope`, task_id: ids.B1, basis: 'source_ref' }, // no such ask
          pair('bkeyed', 'B1', 'cross_mailbox'), // its keys differ from the source ask's: not proven
        ],
        keys: [
          { ask_id: bf.bm1, rfc_message_id: `<Same-${tag}@mail.test>`, conversation_key: `<Root-${tag}@mail.test>` },
          { ask_id: bf.bm1b, rfc_message_id: `same-${tag}@mail.test`, conversation_key: `root-${tag}@mail.test` },
          { ask_id: bf.bkeyed, rfc_message_id: 'changed@set.test', conversation_key: 'changed@set.test' }, // already has keys: left alone
        ],
      };
      expect(Object.keys(bf)).toHaveLength(8);
    });

    it('dry:true writes nothing and returns the plan\'s counts', async () => {
      as(porter());
      const openTotal = await prisma.emailAsk.count({ where: { state: 'open' } });
      const before = await snapshot();
      const res = await backfillPost(jreq('/api/work/backfill-links', 'POST', { ...body, dry: true }));
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(await snapshot()).toEqual(before);
      expect(j.dry).toBe(true);
      expect(j.counts).toMatchObject({
        open_total: openTotal,
        linkable_by_basis: { mint_ledger: 1, registry: 1, source_ref: 3, cross_mailbox: 1 },
        with_open_task: 1,
        would_close: 2,
        left_open_after_done: 1,
        keys_set: 2,
        unmatched: 4,
        held_security: 1,
        held_urgent: 1,
      });
      expect(j.lists.would_close.map((x: { ask_id: string }) => x.ask_id).sort()).toEqual([bf.bm1, bf.bm1b].sort());
      expect(j.lists.left_open_after_done.map((x: { ask_id: string }) => x.ask_id)).toEqual([bf['bm-late']]);
      expect(j.lists.unmatched.map((u: { reason: string }) => u.reason).sort()).toEqual(['ask_not_found', 'basis_not_proven', 'basis_not_proven', 'duplicate']);
    });

    it('the real run decides exactly as the dry run did, closes only what arrived before completion, and writes one line', async () => {
      as(porter());
      const dry = await (await backfillPost(jreq('/api/work/backfill-links', 'POST', { ...body, dry: true }))).json();
      const actionsBefore = (await actions()).length;
      const res = await backfillPost(jreq('/api/work/backfill-links', 'POST', { ...body, dry: false }));
      expect(res.status).toBe(200);
      const real = await res.json();
      expect(real.counts).toEqual(dry.counts);
      expect(real.lists).toEqual(dry.lists);
      expect(real.applied).toMatchObject({ keys_set: 2, linked: 6, closed: 2 });

      expect(await row('bm1')).toMatchObject({ state: 'handled', task_id: ids.B1, closed_reason: 'task_done', closed_by: 'backfill', rfc_message_id: `same-${tag}@mail.test`, conversation_key: `root-${tag}@mail.test` });
      expect(await row('bm1b')).toMatchObject({ state: 'handled', task_id: ids.B1, closed_by: 'backfill' });
      // Arrived after completion: linked, listed, not closed.
      expect(await row('bm-late')).toMatchObject({ state: 'open', task_id: ids.B1, closed_reason: null });
      // Open task: linked, left open.
      expect(await row('bo1')).toMatchObject({ state: 'open', task_id: ids.B2 });
      // Security task and urgent ask: linked, never closed.
      expect(await row('bs1')).toMatchObject({ state: 'open', task_id: ids.B3 });
      expect(await row('bu1')).toMatchObject({ state: 'open', task_id: ids.B4 });
      // Not proven: untouched. Existing keys are never overwritten.
      expect(await row('bx')).toMatchObject({ state: 'open', task_id: null });
      expect(await row('bkeyed')).toMatchObject({ task_id: null, rfc_message_id: 'already@set.test', conversation_key: 'already-root@set.test' });

      const acts = await actions();
      expect(acts).toHaveLength(actionsBefore + 1);
      const line = (await lines()).find((l) => l.id === acts[acts.length - 1].id)!;
      expect(line.text).toBe('Linked 6 emails to their tasks and closed 2 whose tasks are finished.');
      expect(line.undo_action_id).toBe(line.id);
      expect(line.details.length).toBeGreaterThan(2);
    });

    it('Undo reopens exactly the two it closed and holds those tasks', async () => {
      const acts = await actions();
      await runHomeUndo(prisma, adminId, acts[acts.length - 1].id, new Date());
      expect(await row('bm1')).toMatchObject({ state: 'open', closed_by: null });
      expect(await row('bm1b')).toMatchObject({ state: 'open' });
      expect((await closeAsksForTask(prisma, ids.B1, 'done')).closed).toEqual([]);
    });

    it('the porter lane is let in and a plain member is not; a bad body is 400', async () => {
      as({ userId: adminId, email: 'x@x.test', role: 'pm', via: 'session' });
      expect((await backfillPost(jreq('/api/work/backfill-links', 'POST', { dry: true }))).status).toBe(403);
      as(porter());
      expect((await backfillPost(jreq('/api/work/backfill-links', 'POST', { nope: true }))).status).toBe(400);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('nobody else sees a change', () => {
    it('Sabeen\'s own screen data and tasks are untouched; every line is on the owner only', async () => {
      const mine = await prisma.task.findUniqueOrThrow({ where: { id: ids.techs }, select: { status: true, title: true, updated_at: true } });
      expect(mine.status).toBe('in_progress');
      expect(await prisma.homeAction.count({ where: { user_id: techId } })).toBe(0);
      const { raw } = await screen(techId);
      expect(raw.keeper_lines).toEqual([]);
      expect(raw.tasks.map((t) => t.id)).toEqual([ids.techs]);
      expect(raw.tasks[0].emails).toEqual([]);
    });
  });
});
