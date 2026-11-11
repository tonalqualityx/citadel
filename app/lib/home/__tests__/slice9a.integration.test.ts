// @vitest-environment node
/**
 * Slice 9a against a real Postgres: the sent-mail reconciler's Citadel side. The machine job is not run: its requests are made as
 * function calls (candidates, the dry POST, the real POST) and his taps as function calls on a fake clock. The retainer route is
 * called as a handler with the sign-in mocked. Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It seeds
 * its own rows and removes only those. Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s9a_int npx vitest run lib/home/__tests__/slice9a.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID, createHash } from 'crypto';

vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(async () => ({ userId: 'x', email: 'x@x.test', role: 'admin', via: 'session' })),
}));

import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/bast-chat/gate-mirror';
import { loadHomeInputs } from '../load';
import { loadItemStates } from '../state';
import { selectHome } from '../select';
import { homeActSchema, runHomeAct, runHomeUndo, zonedDateString } from '../act';
import { proposalKey } from '../item-key';
import { candidatesFor, loadContext } from '../reconcile/load';
import { reconcileBodySchema, candidatesBodySchema, type ReconcileBody } from '../reconcile/schema';
import { saveReconcile } from '../reconcile/store';
import { logTime, proposalYes } from '../reconcile/apply';
import { trackIt } from '../reconcile/track';
import { NextRequest } from 'next/server';
import { GET as retainerGET } from '@/app/api/clients/[id]/retainer/route';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const at = (day: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, day, h + 5, mi));
const NOW = at(11, 12, 0);
const SENT = at(9, 10, 0); // Monday, November 9, 10:00 his time
const CREATED = at(1, 9, 0);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe.skipIf(!SCRATCH)('Slice 9a: the sent-mail reconciler (real database)', () => {
  const tag = `s9a-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const overlookAdminId = randomUUID();
  const otherId = randomUUID(); // Sabeen's stand-in: another user whose task gets a card only
  const users = [adminId, techId, overlookAdminId, otherId];
  const acct = 'mike@becomeindelible.com';
  const ids: Record<string, string> = {};
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  let clientId = '';
  let vtClientId = '';
  let machineId = '';
  const sessionIds: string[] = [];
  let bastExisted = true;
  let otherSnapshot: Awaited<ReturnType<typeof others>>;

  const th = (k: string) => `${tag}-th-${k}`;
  const mkey = (k: string) => `${tag}-${k}@mail.test`;
  const kue = `kue-${tag}@griswold.test`;
  const editor = `editor-${tag}@vtstandard.test`;

  const task = async (k: string, over: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({
      data: { title: `${k} ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, created_at: CREATED, tags: [], ...over } as never,
    });
    ids[k] = t.id;
    taskIds.push(t.id);
    return t;
  };
  const ask = (k: string, taskId: string | null, threadK = k) =>
    prisma.emailAsk.create({
      data: {
        message_id: `${tag}-ask-${k}`, thread_id: th(threadK), account: acct, from_name: 'Kue Chen', from_email: kue, subject: `Re ${k}`,
        gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'dismissed', client_id: clientId, task_id: taskId,
        deep_link: 'https://mail.google.com/x', received_at: CREATED,
      } as never,
    });
  const message = (k: string, actions: unknown[], over: Record<string, unknown> = {}) => ({
    message_key: mkey(k),
    account: acct,
    gmail_id: `g-${tag}-${k}`,
    thread_id: th(k),
    thread_root: th(k),
    sent_at: SENT.toISOString(),
    to_label: kue,
    subject: `Re: ${k}`,
    lookback: false,
    bast_words: false,
    new_part: 'Hi Kue.\nI removed the File Manager plugin.\nThanks, Mike',
    quoted_part_hash: '0'.repeat(64),
    filter: { model: 'haiku', cost_usd: 0.01 },
    match: { model: 'sonnet', cost_usd: 0.05 },
    outcome: actions.length ? 'actions' : 'nothing',
    actions,
    ...over,
  });
  const body = (messages: unknown[], dry = false): ReconcileBody => reconcileBodySchema.parse({ dry, messages });
  const note = (k: string, quote = 'I removed the File Manager plugin.', confidence = 'high') => ({ type: 'note', task_id: ids[k], quote, confidence });
  const done = (k: string, quote = 'I removed the File Manager plugin.') => ({ type: 'done', task_id: ids[k], quote, confidence: 'high', past_tense: true, remaining_open: [], did_phrase: 'removed File Manager' });
  const save = (messages: unknown[], now = NOW) => saveReconcile(prisma, adminId, body(messages), now);
  const decisions = (r: Awaited<ReturnType<typeof saveReconcile>>, key: string) => r.messages.find((m) => m.message_key === mkey(key))?.decisions ?? [];
  const screen = async (userId = adminId, now = NOW) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, now, { timezone: TZ }), loadItemStates(prisma, userId)]);
    return selectHome({ raw, states, now });
  };
  const cardFor = (k: string, kind?: string) =>
    prisma.homeReconcileChange.findFirst({ where: { user_id: adminId, message: { message_key: mkey(k) }, mode: 'card', ...(kind ? { kind } : {}) }, orderBy: { created_at: 'asc' } });
  const tapAct = (req: unknown, now = NOW) => runHomeAct(prisma, adminId, homeActSchema.parse(req), { now, timezone: TZ, date: zonedDateString(now, TZ) });
  const commentsOn = (k: string) => prisma.comment.findMany({ where: { task_id: ids[k] }, orderBy: { created_at: 'asc' } });
  const others = async () => {
    const tasks = await prisma.task.findMany({ where: { assignee_id: { in: [techId, overlookAdminId] } }, select: { id: true, updated_at: true }, orderBy: { id: 'asc' } });
    return {
      tasks: tasks.map((t) => `${t.id}:${t.updated_at.toISOString()}`),
      comments: await prisma.comment.count({ where: { task: { assignee_id: { in: [techId, overlookAdminId] } } } }),
      waits: await prisma.wait.count({ where: { task: { assignee_id: { in: [techId, overlookAdminId] } } } }),
      entries: await prisma.timeEntry.count({ where: { user_id: { in: [techId, overlookAdminId] } } }),
      asks: await prisma.emailAsk.count({ where: { account: 'other-9a@example.test' } }),
      rows: await prisma.homeReconcileMessage.count({ where: { user_id: { in: [techId, overlookAdminId] } } }),
      changes: await prisma.homeReconcileChange.count({ where: { user_id: { in: [techId, overlookAdminId] } } }),
    };
  };

  beforeAll(async () => {
    bastExisted = !!(await prisma.user.findUnique({ where: { id: BAST_USER_ID } }));
    if (!bastExisted) await prisma.user.create({ data: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'admin' } });
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin 9a', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech 9a', role: 'tech' },
        { id: overlookAdminId, email: `ovl-${tag}@example.test`, password_hash: 'x', name: 'Overlook 9a', role: 'admin' },
        { id: otherId, email: `other-${tag}@example.test`, password_hash: 'x', name: 'Sabeen Stand-in', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({
      data: [
        { user_id: adminId, home_view: 'home', timezone: TZ },
        { user_id: techId, home_view: 'overlook', timezone: TZ },
        { user_id: overlookAdminId, home_view: 'overlook', timezone: TZ },
        { user_id: otherId, home_view: 'overlook', timezone: TZ },
      ],
    });
    await prisma.homeKeeperSettings.create({ data: { user_id: adminId, reconcile_on: true } });
    clientId = (await prisma.client.create({ data: { name: `Griswold ${tag}`, status: 'active' } })).id;
    vtClientId = (await prisma.client.create({ data: { name: `Vermont Standard ${tag}`, status: 'active', retainer_hours: 10 } })).id;
    await prisma.clientContact.create({ data: { client_id: clientId, name: 'Kue Chen', email: kue } as never });
    await prisma.clientContact.create({ data: { client_id: vtClientId, name: 'The Editor', email: editor } as never });
    await prisma.site.create({ data: { name: `Griswold site ${tag}`, url: `https://griswold-${tag}.test`, client_id: clientId } as never });

    await task('kue', {
      title: `Griswold clean up the hacked site ${tag}`,
      tags: ['security'],
      requirements: [
        { id: 'a', text: 'Remove the File Manager plugin', completed: false, sort_order: 1 },
        { id: 'b', text: 'Rotate the admin passwords', completed: false, sort_order: 2 },
        { id: 'c', text: 'Scan the uploads folder', completed: true, sort_order: 3 },
      ],
    });
    await task('own', { title: `Update the footer links ${tag}` });
    await task('own2', { title: `Fix the contact form ${tag}` });
    await task('own3', { title: `Tidy the newsletter template ${tag}` });
    await task('wrong', { title: `Refresh the sitemap ${tag}` });
    await task('sab', { title: `Rebuild the newsletter ${tag}`, assignee_id: otherId });
    await task('techs', { title: 'Tech own task', assignee_id: techId });
    await task('ovl', { title: 'Overlook own task', assignee_id: overlookAdminId });
    await task('late', { title: `Created after the email ${tag}`, created_at: at(10, 9, 0) });
    await task('hasTime', { title: `Task with time ${tag}` });
    await task('cap', { title: `Cap task ${tag}` });
    await task('neverMine', { title: `Not tied to anything ${tag}`, client_id: null });
    for (const k of ['kue', 'own', 'own2', 'own3', 'wrong', 'sab', 'late', 'cap']) await ask(k, ids[k]);
    await ask('wrongAgain', ids.wrong, 'wrong');
    await prisma.timeEntry.create({ data: { user_id: adminId, task_id: ids.hasTime, started_at: at(5, 9), ended_at: at(5, 10), duration: 60, description: 'x' } });
    await prisma.comment.create({ data: { task_id: ids.techs, user_id: techId, content: 'tech note' } as never });
    await prisma.emailAsk.create({
      data: { message_id: `${tag}-other-ask`, thread_id: `${tag}-other`, account: 'other-9a@example.test', from_email: 'z@z.test', subject: 'x', gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', received_at: CREATED, deep_link: 'x' } as never,
    });
    machineId = (await prisma.oracleMachine.create({ data: { name: `m-${tag}`, hostname: `h-${tag}` } as never })).id;
    const s = await prisma.oracleSession.create({
      data: { machine_id: machineId, external_id: `ext-${tag}`, source: 'claude_code', title: 'Griswold chatbot tone', status: 'running', waiting_on: 'Pick the tone for the welcome message.', ask_queue: 'decide', last_event_at: at(8, 8) },
    });
    sessionIds.push(s.id);
    otherSnapshot = await others();
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { OR: [{ task_id: { in: taskIds } }, { user_id: { in: users } }] } });
    await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
    const made = await prisma.task.findMany({ where: { OR: [{ client_id: { in: [clientId, vtClientId] } }, { id: { in: taskIds } }] }, select: { id: true } });
    const allTasks = [...new Set([...made.map((t) => t.id), ...taskIds])];
    await prisma.wait.deleteMany({ where: { OR: [{ task_id: { in: allTasks } }, { email_thread_id: { startsWith: tag } }] } });
    await prisma.emailAsk.deleteMany({ where: { account: { in: [acct, 'other-9a@example.test'] }, message_id: { contains: tag } } });
    await prisma.timeEntry.deleteMany({ where: { task_id: { in: allTasks } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: allTasks } } });
    await prisma.task.deleteMany({ where: { id: { in: allTasks } } });
    await prisma.project.deleteMany({ where: { client_id: { in: [clientId, vtClientId] } } });
    await prisma.homeReconcileChange.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeReconcileMessage.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeReconcileHold.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeKeeperRun.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeOwedThread.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeKeeperSettings.deleteMany({ where: { user_id: { in: users } } });
    await prisma.oracleSession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.oracleMachine.deleteMany({ where: { id: machineId } });
    await prisma.site.deleteMany({ where: { client_id: { in: [clientId, vtClientId] } } });
    await prisma.clientContact.deleteMany({ where: { client_id: { in: [clientId, vtClientId] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, vtClientId] } } });
    await prisma.activityLog.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (!bastExisted) await prisma.user.deleteMany({ where: { id: BAST_USER_ID } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the context and the candidates (nothing is written)', () => {
    it('GET: the owner is on, caps are full, nothing is processed yet, the look-back is not done', async () => {
      const c = await loadContext(prisma, adminId, NOW);
      expect(c).toMatchObject({ owner_ok: true, on: true, auto: false, caps: { notes_left: 20, cards_left: 10 }, lookback_done: false });
      expect((c as { processed: string[] }).processed.filter((k) => k.includes(tag))).toEqual([]);
    });

    it('candidates: his security task comes with its basis, its tag and only the REAL open checklist items', async () => {
      const before = await prisma.homeReconcileMessage.count();
      const req = candidatesBodySchema.parse({
        messages: [{ message_key: mkey('kue'), account: acct, thread_id: th('kue'), thread_rfc_ids: [], to: [{ email: kue, name: '' }], cc: [], subject: 'Re: kue', sent_at: SENT.toISOString() }],
      });
      const r = await candidatesFor(prisma, adminId, req.messages[0], NOW);
      const t = r.tasks.find((x) => x.id === ids.kue);
      expect(t).toMatchObject({ mine: true, protected: true, free_to_change: false, basis: ['thread'] });
      expect(t?.open_items).toEqual(['Remove the File Manager plugin', 'Rotate the admin passwords']);
      expect(r.client).toMatchObject({ id: clientId });
      // A task made after the email, and the one with no tie, are not offered.
      expect(r.tasks.some((x) => x.id === ids.late)).toBe(false);
      expect(r.tasks.some((x) => x.id === ids.neverMine)).toBe(false);
      expect(await prisma.homeReconcileMessage.count()).toBe(before);
    });

    it('candidates: someone else\'s task is listed as not mine', async () => {
      const req = candidatesBodySchema.parse({
        messages: [{ message_key: mkey('sab'), account: acct, thread_id: th('sab'), thread_rfc_ids: [], to: [{ email: kue, name: '' }], cc: [], subject: 'x', sent_at: SENT.toISOString() }],
      });
      const r = await candidatesFor(prisma, adminId, req.messages[0], NOW);
      expect(r.tasks.find((x) => x.id === ids.sab)).toMatchObject({ mine: false });
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the dry POST and the real POST run the same validation', () => {
    const counts = async () => ({
      m: await prisma.homeReconcileMessage.count(),
      c: await prisma.homeReconcileChange.count(),
      cm: await prisma.comment.count(),
      a: await prisma.homeAction.count(),
      t: await prisma.task.count(),
      te: await prisma.timeEntry.count(),
      p: await prisma.project.count(),
      w: await prisma.wait.count(),
    });

    it('the same body gives the same decisions; the dry one writes nothing; the real one writes the one note', async () => {
      const actions = [
        note('own', 'I updated the footer links.'),
        note('own', 'Not in his words at all.'),
        note('own', 'I updated the footer links.', 'low'),
        { type: 'note', task_id: randomUUID(), quote: 'I updated the footer links.', confidence: 'high' },
        { type: 'note' },
        note('late', 'I updated the footer links.'),
      ];
      const m = message('own', actions, { new_part: 'Hi Kue.\nI updated the footer links.\nThanks' });
      const before = await counts();
      const dry = await saveReconcile(prisma, adminId, body([m], true), NOW);
      expect(await counts()).toEqual(before);
      const real = await saveReconcile(prisma, adminId, body([m], false), NOW);
      expect(real.messages[0].decisions).toEqual(dry.messages[0].decisions);
      expect(real.messages[0].outcome).toBe(dry.messages[0].outcome);
      expect(real.messages[0].decisions).toEqual([
        { i: 0, result: 'noted' },
        { i: 1, result: 'refused', reason: 'quote_not_new' },
        { i: 2, result: 'nothing', reason: 'low_confidence' },
        { i: 3, result: 'refused', reason: 'not_candidate' },
        { i: 4, result: 'refused', reason: 'bad_shape' },
        { i: 5, result: 'refused', reason: 'not_candidate' },
      ]);
      expect(real.messages[0].outcome).toBe('noted');
      const after = await counts();
      expect(after.m).toBe(before.m + 1);
      expect(after.cm).toBe(before.cm + 1);
      expect(after.t).toBe(before.t);
      expect(after.te).toBe(before.te);
      expect(after.p).toBe(before.p);
      expect(after.w).toBe(before.w);
    });

    it('a second POST of the same message answers already and writes nothing', async () => {
      const m = message('own', [note('own', 'I updated the footer links.')], { new_part: 'Hi Kue.\nI updated the footer links.\nThanks' });
      const before = await counts();
      const dry = await saveReconcile(prisma, adminId, body([m], true), NOW);
      const real = await saveReconcile(prisma, adminId, body([m], false), NOW);
      expect(dry.messages[0]).toMatchObject({ outcome: 'already', decisions: [] });
      expect(real.messages[0]).toMatchObject({ outcome: 'already', decisions: [] });
      expect(await counts()).toEqual(before);
      expect(((await loadContext(prisma, adminId, NOW)) as { processed: string[] }).processed).toContain(mkey('own'));
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the note: his own open task, one Handled line, Undo, "This was wrong"', () => {
    it('is internal, written by Bast, with his words, the recipient, the date and the link; the task is not touched', async () => {
      const cs = await commentsOn('own');
      expect(cs).toHaveLength(1);
      expect(cs[0]).toMatchObject({ user_id: BAST_USER_ID, is_internal: true, client_visible: false, client_question: false });
      expect(cs[0].content).toContain("From Mike's sent mail. Email to Kue Chen on Monday, November 9:");
      expect(cs[0].content).toContain('"I updated the footer links."');
      expect(cs[0].content).toContain('Open the email: https://mail.google.com/mail/u/?authuser=');
      const t = await prisma.task.findUnique({ where: { id: ids.own } });
      expect(t?.status).toBe('in_progress');
      expect(t?.assignee_id).toBe(adminId);
    });

    it('Handled for you has one line with Undo and "This was wrong", and its detail', async () => {
      const line = (await screen()).sections.handled.find((l) => l.text.includes(`Update the footer links ${tag}`));
      expect(line?.text).toBe(`Noted on "Update the footer links ${tag}" from your email to Kue Chen, November 9.`);
      expect(line?.undo_action_id).toBeTruthy();
      expect(line?.wrong_action_id).toBe(line?.undo_action_id);
      expect(line?.details).toEqual([`Your email to Kue Chen, Monday, November 9: "I updated the footer links."`]);
      expect(line?.href).toContain('mail.google.com');
      const row = await prisma.homeAction.findUnique({ where: { id: line?.undo_action_id as string } });
      expect(row).toMatchObject({ source: 'reconcile', action: 'reconcile_note' });
      expect(row?.undo_until?.getTime()).toBe(NOW.getTime() + 72 * 3600_000);
    });

    it('a protected task (security) gets a note but its done is a card that lists what is really still open', async () => {
      const m = message('kue', [note('kue'), done('kue')]);
      const r = await save([m]);
      expect(decisions(r, 'kue')).toEqual([{ i: 0, result: 'noted' }, { i: 1, result: 'carded' }]);
      expect((await prisma.task.findUnique({ where: { id: ids.kue } }))?.status).toBe('in_progress');
      const card = await cardFor('kue', 'done');
      expect(card).toMatchObject({ mode: 'card', state: 'open', reason: 'security', title: 'Your email says you removed File Manager. Mark this done?', confidence: 'high' });
      const lines = card?.lines as string[];
      expect(lines[0]).toBe('Your email to Kue Chen, Monday, November 9: "I removed the File Manager plugin."');
      expect(lines[1]).toBe('Still open on this task: Remove the File Manager plugin; Rotate the admin passwords');
      const item = (await screen()).candidates.find((c) => c.key === proposalKey(card!.id))?.item;
      expect(item?.type).toBe('proposal');
      expect(item?.proposal?.why).toBe('Why Bast asks: it is a security task, so Bast never closes it on its own.');
      expect(item?.proposal?.time).toMatchObject({ default: 30, choices: [15, 30, 60, 90, 120] });
      expect(item?.actions.map((a) => a.label)).toEqual(['Mark it done', 'Not yet', 'No']);
      expect(item?.default_if_ignored).toBe('Stays here. Nothing changes until you tap.');
    });

    it('Undo hides the note, deletes nothing, and holds the task for 30 days', async () => {
      const line = (await screen()).sections.handled.find((l) => l.text.includes(`Update the footer links ${tag}`));
      const before = await commentsOn('own');
      await runHomeUndo(prisma, adminId, line!.undo_action_id as string, NOW);
      const after = await commentsOn('own');
      expect(after).toHaveLength(before.length);
      expect(after[0].is_deleted).toBe(true);
      const hold = await prisma.homeReconcileHold.findUnique({ where: { user_id_target_key: { user_id: adminId, target_key: `task:${ids.own}` } } });
      expect(hold?.reason).toBe('undo');
      expect(hold!.until.getTime()).toBe(NOW.getTime() + 30 * 24 * 3600_000);
      const ch = await prisma.homeReconcileChange.findFirst({ where: { user_id: adminId, target_key: `task:${ids.own}`, mode: 'auto' } });
      expect(ch?.state).toBe('undone');
      expect((await screen()).sections.handled.some((l) => l.text.includes(`Update the footer links ${tag}`))).toBe(false);
    });

    it('"This was wrong" hides the note, holds the task 90 days, and a later email about it gives a card, not a note', async () => {
      const m1 = message('wrong', [note('wrong', 'I refreshed the sitemap.')], { new_part: 'Hi.\nI refreshed the sitemap.\nThanks' });
      expect(decisions(await save([m1]), 'wrong')).toEqual([{ i: 0, result: 'noted' }]);
      const line = (await screen()).sections.handled.find((l) => l.text.includes(`Refresh the sitemap ${tag}`));
      await runHomeUndo(prisma, adminId, line!.wrong_action_id as string, NOW, { wrong: true });
      const hold = await prisma.homeReconcileHold.findUnique({ where: { user_id_target_key: { user_id: adminId, target_key: `task:${ids.wrong}` } } });
      expect(hold?.reason).toBe('wrong');
      expect(hold!.until.getTime()).toBe(NOW.getTime() + 90 * 24 * 3600_000);
      expect((await prisma.homeReconcileMessage.findUnique({ where: { user_id_message_key: { user_id: adminId, message_key: mkey('wrong') } } }))?.wrong_at).not.toBeNull();
      const m2 = message('wrongAgain', [note('wrong', 'I refreshed the sitemap again.')], { new_part: 'Hi.\nI refreshed the sitemap again.\nThanks', thread_id: th('wrong'), thread_root: th('wrong') });
      const r2 = await save([m2]);
      expect(decisions(r2, 'wrongAgain')).toEqual([{ i: 0, result: 'carded' }]);
      expect(await commentsOn('wrong')).toHaveLength(1);
      expect((await cardFor('wrongAgain', 'note'))?.reason).toBe('wrong_hold');
    });

    it('"This was wrong" is refused on a row the reconciler did not write', async () => {
      const r = await tapAct({ action: 'not_now', item_key: `task:${ids.cap}` });
      await expect(runHomeUndo(prisma, adminId, r.action_id, NOW, { wrong: true })).rejects.toMatchObject({ code: 'not_undoable' });
      await runHomeUndo(prisma, adminId, r.action_id, NOW);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('cards', () => {
    it("someone else's task: a card only, even for a note; the tap adds the note and never changes the task", async () => {
      const r = await save([message('sab', [note('sab')])]);
      expect(decisions(r, 'sab')).toEqual([{ i: 0, result: 'carded' }]);
      expect(await commentsOn('sab')).toHaveLength(0);
      const card = await cardFor('sab', 'note');
      expect(card?.title).toBe(`Your email to Kue Chen is about Sabeen Stand-in's task "Rebuild the newsletter ${tag}". Add a note?`);
      expect(card?.reason).toBe('someone_else');
      const res = await tapAct({ action: 'proposal_yes', item_key: proposalKey(card!.id) });
      expect(res.message).toBe('Added the note.');
      const cs = await commentsOn('sab');
      expect(cs).toHaveLength(1);
      expect(cs[0]).toMatchObject({ user_id: BAST_USER_ID, is_internal: true, client_visible: false });
      const t = await prisma.task.findUnique({ where: { id: ids.sab } });
      expect(t).toMatchObject({ status: 'in_progress', assignee_id: otherId });
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
      expect((await commentsOn('sab'))[0].is_deleted).toBe(true);
      expect((await prisma.homeReconcileChange.findUnique({ where: { id: card!.id } }))?.state).toBe('undone');
    });

    it('a task made after the email is refused as not open', async () => {
      const r = await save([message('late', [note('late')])]);
      expect(decisions(r, 'late')).toEqual([{ i: 0, result: 'refused', reason: 'not_open' }]);
    });

    it('Mark it done with a time choice goes through the session door: status done, one time entry; the chat tap is refused', async () => {
      const card = await cardFor('kue', 'done');
      const key = proposalKey(card!.id);
      // The chat's home op (runHomeAct) cannot tap a done card that offers a time choice.
      await expect(tapAct({ action: 'proposal_yes', item_key: key })).rejects.toMatchObject({ statusCode: 400, message: 'Tap this on the home screen.' });
      expect((await prisma.task.findUnique({ where: { id: ids.kue } }))?.status).toBe('in_progress');
      const entriesBefore = await prisma.timeEntry.count();
      const res = await proposalYes(prisma, adminId, key, { now: NOW, timezone: TZ, allowTime: true, minutes: 30 });
      expect(res.message).toBe('Marked it done and logged 30 minutes.');
      expect((await prisma.task.findUnique({ where: { id: ids.kue } }))?.status).toBe('done');
      expect(await prisma.timeEntry.count()).toBe(entriesBefore + 1);
      const te = await prisma.timeEntry.findFirst({ where: { task_id: ids.kue, is_deleted: false } });
      expect(te).toMatchObject({ user_id: adminId, duration: 30, is_billable: true, is_running: false });
      expect(te?.ended_at?.getTime()).toBe(SENT.getTime());
      expect(te?.started_at.getTime()).toBe(SENT.getTime() - 30 * 60000);
      expect(te?.description).toBe('Estimated, logged after the fact from your email of November 9.');
      // Undo puts the task back and soft deletes the entry.
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
      expect((await prisma.task.findUnique({ where: { id: ids.kue } }))?.status).toBe('in_progress');
      expect((await prisma.timeEntry.findUnique({ where: { id: te!.id } }))?.is_deleted).toBe(true);
    });

    it('a card for a task that closed another way is not shown, and is refused when tapped', async () => {
      const m = message('own2', [done('own2', 'I fixed the contact form.')], { new_part: 'Hi.\nI fixed the contact form.\nThanks' });
      expect(decisions(await save([m]), 'own2')).toEqual([{ i: 0, result: 'carded' }]);
      const card = await cardFor('own2', 'done');
      expect(card?.reason).toBe('manual');
      expect((await screen()).candidates.some((c) => c.key === proposalKey(card!.id))).toBe(true);
      await prisma.task.update({ where: { id: ids.own2 }, data: { status: 'done' } });
      expect((await screen()).candidates.some((c) => c.key === proposalKey(card!.id))).toBe(false);
      await expect(tapAct({ action: 'proposal_yes', item_key: proposalKey(card!.id) })).rejects.toMatchObject({ code: 'card_gone' });
      await prisma.task.update({ where: { id: ids.own2 }, data: { status: 'in_progress' } });
    });

    it('No closes the card, and the same piece of work is never proposed again', async () => {
      const q = 'I tidied the newsletter template.';
      const m = message('own3', [done('own3', q)], { new_part: `Hi.\n${q}\nThanks` });
      expect(decisions(await save([m]), 'own3')).toEqual([{ i: 0, result: 'carded' }]);
      const card = await cardFor('own3', 'done');
      const res = await tapAct({ action: 'proposal_no', item_key: proposalKey(card!.id) });
      expect(res.message).toContain('Closed the card');
      expect((await prisma.homeReconcileChange.findUnique({ where: { id: card!.id } }))?.state).toBe('dismissed');
      const again = message('own3again', [done('own3', q)], { new_part: `Hi.\n${q}\nThanks`, thread_id: th('own3'), thread_root: th('own3') });
      expect(decisions(await save([again]), 'own3again')).toEqual([{ i: 0, result: 'refused', reason: 'duplicate' }]);
    });

    it('a later email in the same thread adds to the open card and makes no second card', async () => {
      const m1 = message('cap', [done('cap', 'I fixed the cap task.')], { new_part: 'Hi.\nI fixed the cap task.\nThanks' });
      await save([m1]);
      const first = await cardFor('cap', 'done');
      const m2 = message('capLater', [done('cap', 'I fixed the cap task.')], { new_part: 'Hi.\nI fixed the cap task.\nBye', thread_id: th('cap'), thread_root: th('cap') });
      expect(decisions(await save([m2]), 'capLater')).toEqual([{ i: 0, result: 'carded' }]);
      const all = await prisma.homeReconcileChange.findMany({ where: { user_id: adminId, kind: 'done', target_key: `task:${ids.cap}` } });
      expect(all).toHaveLength(1);
      expect((all[0].plan as { evidence?: string[] }).evidence).toEqual([mkey('capLater')]);
      expect(all[0].id).toBe(first!.id);
    });

    it('the look-back writes no notes, only cards (drawer only), and the end marker is accepted once', async () => {
      const m = message('own', [], {});
      void m;
      const lb = message('lookback1', [note('own', 'I updated the footer links.')], { lookback: true, new_part: 'Hi.\nI updated the footer links.\nThanks', thread_id: th('own'), thread_root: th('own') });
      const before = await commentsOn('own');
      const r = await save([lb]);
      expect(decisions(r, 'lookback1')).toEqual([{ i: 0, result: 'carded' }]);
      expect(await commentsOn('own')).toHaveLength(before.length);
      const card = await cardFor('lookback1', 'note');
      expect(card?.reason).toBe('older');
      const sc = await screen();
      expect(sc.sections.next.some((i) => i.key === proposalKey(card!.id))).toBe(false);
      const group = sc.everything_else.groups.find((g) => g.key === 'from_sent_mail');
      expect(group?.label).toBe('From your sent mail');
      expect(group?.items.some((i) => i.key === proposalKey(card!.id))).toBe(true);
      // The end marker: dry says would_set, real sets it, a second says already.
      const marker = (dry: boolean) => saveReconcile(prisma, adminId, reconcileBodySchema.parse({ dry, lookback_end: true, messages: [] }), NOW);
      expect(await marker(true)).toMatchObject({ lookback_end: 'would_set' });
      expect(((await loadContext(prisma, adminId, NOW)) as { lookback_done: boolean }).lookback_done).toBe(false);
      expect(await marker(false)).toMatchObject({ lookback_end: 'set' });
      expect(((await loadContext(prisma, adminId, NOW)) as { lookback_done: boolean }).lookback_done).toBe(true);
      expect(await marker(false)).toMatchObject({ lookback_end: 'already' });
    });

  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('Track it: work that is not in Citadel, the owner\'s project rule, and time only on his tap', () => {
    const q = 'Here is the sample page for the Phil Camp memorial.';
    const track = (over: Record<string, unknown> = {}) => ({
      type: 'track',
      title: 'You built and sent a sample page for Phil Camp',
      done_title: 'Build and send the Phil Camp sample page',
      next_step: 'Get them on a call',
      later: ['Get the content and images from them', 'Launch the page'],
      client_id: vtClientId,
      project_id: null,
      minutes: 90,
      estimate_basis: '6 emails over 2 days and one Bast session of about 1 hour 40 minutes',
      quote: q,
      confidence: 'high',
      ...over,
    });
    const tm = (k: string, actions: unknown[], over: Record<string, unknown> = {}) => message(k, actions, { to_label: editor, new_part: `Hi.\n${q}\nBest, Mike`, subject: 'Phil Camp sample', ...over });
    let cardId = '';

    it('makes a Track it card and nothing else: no project, task or time entry is created before his tap', async () => {
      const before = { p: await prisma.project.count(), t: await prisma.task.count(), te: await prisma.timeEntry.count() };
      const r = await save([tm('phil', [track()])]);
      expect(decisions(r, 'phil')).toEqual([{ i: 0, result: 'carded' }]);
      expect({ p: await prisma.project.count(), t: await prisma.task.count(), te: await prisma.timeEntry.count() }).toEqual(before);
      const card = await cardFor('phil', 'track');
      cardId = card!.id;
      expect(card).toMatchObject({ mode: 'card', state: 'open', target_key: null, reason: 'new_work', minutes_estimate: 90 });
      expect(card?.title).toBe('You built and sent a sample page for Phil Camp. Track it?');
      const lines = card?.lines as string[];
      expect(lines).toEqual([
        `Your email to The Editor, Monday, November 9: "${q}"`,
        'Done: Build and send the Phil Camp sample page (Monday, November 9).',
        "Time spent: about 1 hour 30 minutes. This is Bast's estimate: 6 emails over 2 days and one Bast session of about 1 hour 40 minutes. Change it before you tap.",
        `Counts toward Vermont Standard ${tag}'s retainer for November.`,
        'No live project for this yet. A new project will be made for it.',
        'Next: Get them on a call',
        'Later: Get the content and images from them. Launch the page.',
      ]);
    });

    it('with no live project the only filing button is "Start a project for it"; the card and its footer', async () => {
      const item = (await screen()).candidates.find((c) => c.key === proposalKey(cardId))?.item;
      expect(item?.actions.map((a) => a.label)).toEqual(['Start a project for it', 'Not now', 'No, leave it']);
      expect(item?.actions[0]).toMatchObject({ id: 'track_it', placement: 'new_project' });
      expect(item?.default_if_ignored).toBe('Stays here for two weeks, then goes quietly. Nothing is made until you tap.');
      expect(item?.proposal?.time).toMatchObject({ default: 90, billable_choice: true });
      expect(item?.proposal?.placement).toMatchObject({ kind: 'new' });
    });

    it('a placement the card did not offer is refused (project when none exists, none for multi-step work); nothing is written', async () => {
      const before = { p: await prisma.project.count(), t: await prisma.task.count(), te: await prisma.timeEntry.count() };
      for (const placement of ['project', 'none'] as const) {
        await expect(trackIt(prisma, adminId, proposalKey(cardId), { placement, minutes: 90, billable: true }, { now: NOW, timezone: TZ })).rejects.toMatchObject({ code: 'bad_choice' });
      }
      expect({ p: await prisma.project.count(), t: await prisma.task.count(), te: await prisma.timeEntry.count() }).toEqual(before);
    });

    it('Start a project for it: a live project, the done task, the next step, the later tasks blocked by it, one billable time entry', async () => {
      const res = await trackIt(prisma, adminId, proposalKey(cardId), { placement: 'new_project', minutes: 90, billable: true }, { now: NOW, timezone: TZ });
      expect(res.message).toBe(`Tracked: 4 tasks and 1 hour 30 minutes on Vermont Standard ${tag}.`);
      const ch = await prisma.homeReconcileChange.findUnique({ where: { id: cardId } });
      expect(ch?.state).toBe('applied');
      const created = ch?.created_ids as { project_id: string; task_ids: string[] };
      projectIds.push(created.project_id);
      const project = await prisma.project.findUnique({ where: { id: created.project_id } });
      expect(project).toMatchObject({ status: 'in_progress', type: 'project', client_id: vtClientId, created_by_id: BAST_USER_ID, next_step_text: 'Get them on a call', next_step_owner_id: adminId, next_step_source: 'bast' });
      expect(project?.budget_hours).toBeNull();
      expect(project?.hourly_rate).toBeNull();
      expect(project?.budget_amount).toBeNull();
      const tasks = await prisma.task.findMany({ where: { id: { in: created.task_ids } }, include: { blocked_by: { select: { id: true } } } });
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const [doneId, nextId, ...later] = created.task_ids;
      expect(byId.get(doneId)).toMatchObject({ status: 'done', assignee_id: adminId, project_id: created.project_id, client_id: vtClientId, estimated_minutes: 90, title: 'Build and send the Phil Camp sample page' });
      expect(byId.get(doneId)?.completed_at?.getTime()).toBe(SENT.getTime());
      expect(byId.get(doneId)?.tags).toEqual(['from-sent-mail']);
      expect(byId.get(doneId)?.description).toContain('Logged after the fact from your email of Monday, November 9.');
      expect(byId.get(doneId)?.origin_url).toContain('mail.google.com');
      expect(byId.get(nextId)).toMatchObject({ status: 'not_started', assignee_id: adminId, due_date: null, title: 'Get them on a call' });
      expect(later).toHaveLength(2);
      for (const id of later) expect(byId.get(id)?.blocked_by.map((b) => b.id)).toEqual([nextId]);
      for (const t of tasks) {
        expect(t.billing_amount).toBeNull();
        expect(t.is_billable).toBe(false);
      }
      const te = await prisma.timeEntry.findMany({ where: { task_id: doneId } });
      expect(te).toHaveLength(1);
      expect(te[0]).toMatchObject({ user_id: adminId, project_id: created.project_id, duration: 90, is_billable: true, is_running: false, hourly_rate: null });
      expect(te[0].started_at.getTime()).toBe(SENT.getTime() - 90 * 60000);
      expect(te[0].ended_at?.getTime()).toBe(SENT.getTime());
      expect(te[0].description).toBe('Estimated, logged after the fact from your email of November 9.');
      expect(ch?.time_entry_id).toBe(te[0].id);
    });

    it("the client's retainer report for November counts the 90 minutes", async () => {
      const res = await retainerGET(new NextRequest(`http://localhost/api/clients/${vtClientId}/retainer?month=2026-11`), { params: Promise.resolve({ id: vtClientId }) } as never);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.usedMinutes).toBe(90);
    });

    it('Undo soft deletes the entry and abandons the tasks; a task he changed after is left alone with "Changed since"', async () => {
      const ch = await prisma.homeReconcileChange.findUnique({ where: { id: cardId } });
      const created = ch?.created_ids as { project_id: string; task_ids: string[] };
      const [doneId, nextId, laterA] = created.task_ids;
      // He started the next step after Track it.
      await prisma.task.update({ where: { id: nextId }, data: { status: 'in_progress' } });
      const undoRes = await runHomeUndo(prisma, adminId, ch!.home_action_id as string, NOW);
      expect(undoRes.message).toBe('Changed since. Open the task.');
      expect((await prisma.task.findUnique({ where: { id: doneId } }))?.status).toBe('abandoned');
      expect((await prisma.task.findUnique({ where: { id: nextId } }))?.status).toBe('in_progress');
      expect((await prisma.task.findUnique({ where: { id: laterA } }))?.status).toBe('abandoned');
      expect((await prisma.timeEntry.findFirst({ where: { task_id: doneId } }))?.is_deleted).toBe(true);
      // The project it made still has a task he is working, so it stays.
      expect((await prisma.project.findUnique({ where: { id: created.project_id } }))?.status).toBe('in_progress');
      expect((await prisma.homeReconcileChange.findUnique({ where: { id: cardId } }))?.state).toBe('undone');
    });

    it('with one live project that clearly fits, the first button is "Add to {project}" and the second "Start a new project"', async () => {
      // The project Track it made earlier is still live (he started its next step); end it so only the one below is live.
      await prisma.project.updateMany({ where: { client_id: vtClientId }, data: { status: 'cancelled' } });
      const p = await prisma.project.create({ data: { name: `Phil Camp memorial page ${tag}`, status: 'in_progress', client_id: vtClientId, type: 'project' } });
      projectIds.push(p.id);
      const m = tm('phil2', [track({ project_id: p.id, quote: q })], { thread_id: th('phil2'), thread_root: th('phil2') });
      expect(decisions(await save([m]), 'phil2')).toEqual([{ i: 0, result: 'carded' }]);
      const card = await cardFor('phil2', 'track');
      const item = (await screen()).candidates.find((c) => c.key === proposalKey(card!.id))?.item;
      expect(item?.actions.map((a) => a.label)).toEqual([`Add to Phil Camp memorial page ${tag}`, 'Start a new project', 'Not now', 'No, leave it']);
      expect(item?.actions[0]).toMatchObject({ id: 'track_it', placement: 'project' });
      expect(item?.proposal?.placement).toMatchObject({ kind: 'add', project_name: `Phil Camp memorial page ${tag}` });
      // Tap: the tasks go into that live project, no new project.
      const projectsBefore = await prisma.project.count();
      const res = await trackIt(prisma, adminId, proposalKey(card!.id), { placement: 'project', minutes: null, billable: true }, { now: NOW, timezone: TZ });
      expect(res.message).toBe(`Tracked: 4 tasks on Vermont Standard ${tag}.`);
      expect(await prisma.project.count()).toBe(projectsBefore);
      const ch = await prisma.homeReconcileChange.findUnique({ where: { id: card!.id } });
      const created = ch?.created_ids as { project_id: string; task_ids: string[] };
      expect(created.project_id).toBe(p.id);
      expect(ch?.time_entry_id).toBeNull();
      expect(await prisma.timeEntry.count({ where: { task_id: { in: created.task_ids } } })).toBe(0);
    });

    it('a finished or hidden project is never offered or reused; two live candidates make the card ask with no default', async () => {
      const done = await prisma.project.create({ data: { name: `Phil Camp finished ${tag}`, status: 'done', client_id: clientId, type: 'project' } });
      const queue = await prisma.project.create({ data: { name: `Phil Camp queued ${tag}`, status: 'queue', client_id: clientId, type: 'project' } });
      projectIds.push(done.id, queue.id);
      const q2 = 'Here is the sample page for the Griswold memorial.';
      const m = message('ask', [track({ client_id: clientId, project_id: done.id, quote: q2, title: 'A sample page for Griswold' })], { to_label: kue, new_part: `Hi.\n${q2}\nBest` });
      expect(decisions(await save([m]), 'ask')).toEqual([{ i: 0, result: 'carded' }]);
      const card = await cardFor('ask', 'track');
      expect((card?.plan as { placement: { kind: string } }).placement.kind).toBe('new');
      const l1 = await prisma.project.create({ data: { name: `Griswold redesign ${tag}`, status: 'in_progress', client_id: clientId, type: 'project' } });
      const l2 = await prisma.project.create({ data: { name: `Griswold chatbot ${tag}`, status: 'review', client_id: clientId, type: 'project' } });
      projectIds.push(l1.id, l2.id);
      const q3 = 'Here is the sample page for the Griswold launch.';
      const m2 = message('ask2', [track({ client_id: clientId, project_id: l2.id, quote: q3, title: 'A launch page for Griswold' })], { to_label: kue, new_part: `Hi.\n${q3}\nBest` });
      expect(decisions(await save([m2]), 'ask2')).toEqual([{ i: 0, result: 'carded' }]);
      const card2 = await cardFor('ask2', 'track');
      const item = (await screen()).candidates.find((c) => c.key === proposalKey(card2!.id))?.item;
      expect(item?.proposal?.placement?.kind).toBe('ask');
      expect(item?.proposal?.lines.some((l) => /^Add to .* or start a new project\?$/.test(l))).toBe(true);
      expect(item?.actions.map((a) => a.label)).toEqual([expect.stringMatching(/^Add to Griswold/), 'Start a new project', 'Not now', 'No, leave it']);
      expect(item?.actions.every((a) => !a.filled)).toBe(true);
    });

    it('a dismissed work key is never re-made; a Track it for an unknown client is refused', async () => {
      const card = await cardFor('ask', 'track');
      await tapAct({ action: 'proposal_no', item_key: proposalKey(card!.id) });
      const q2 = 'Here is the sample page for the Griswold memorial.';
      const again = message('askAgain', [track({ client_id: clientId, quote: q2 })], { to_label: kue, new_part: `Hi.\n${q2}\nBest`, thread_id: th('ask'), thread_root: th('ask') });
      expect(decisions(await save([again]), 'askAgain')).toEqual([{ i: 0, result: 'refused', reason: 'duplicate' }]);
      const stranger = tm('stranger', [track({ client_id: randomUUID() })], { to_label: 'nobody@nowhere.test' });
      expect(decisions(await save([stranger]), 'stranger')).toEqual([{ i: 0, result: 'refused', reason: 'not_candidate' }]);
    });

    it('a time entry exists ONLY from the session door: homeActSchema refuses track_it and log_time', () => {
      expect(homeActSchema.safeParse({ action: 'track_it', item_key: proposalKey(cardId), placement: 'none', minutes: 30, billable: true }).success).toBe(false);
      expect(homeActSchema.safeParse({ action: 'log_time', task_id: ids.own, minutes: 30, day: '2026-11-10' }).success).toBe(false);
      expect(homeActSchema.safeParse({ action: 'proposal_yes', item_key: proposalKey(cardId) }).success).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('waits, sessions, Bast words and Log time', () => {
    // The daily card cap is its own test below; start these with the day's count back at zero.
    beforeAll(async () => {
      await prisma.homeReconcileChange.updateMany({ where: { user_id: adminId }, data: { created_at: new Date(NOW.getTime() - 2 * 24 * 3600_000) } });
    });

    it('a wait card: the tap opens mail.awaiting_reply (sends nothing) and Undo cancels it while it is waiting', async () => {
      const m = message('wait', [{ type: 'wait', wait_on: { email: kue, name: 'Kue Chen', what: 'the hosting login' }, quote: 'Can you send me the hosting login?', confidence: 'high' }], {
        new_part: 'Hi Kue.\nCan you send me the hosting login?\nThanks',
      });
      // A question is hedged ("?"), so nothing; the plain statement version is a card.
      expect(decisions(await save([m]), 'wait')).toEqual([{ i: 0, result: 'nothing', reason: 'hedged' }]);
      const m2 = message('wait2', [{ type: 'wait', wait_on: { email: kue, name: 'Kue Chen', what: 'the hosting login' }, quote: 'I asked for the hosting login.', confidence: 'high' }], {
        new_part: 'Hi Kue.\nI asked for the hosting login.\nThanks',
      });
      expect(decisions(await save([m2]), 'wait2')).toEqual([{ i: 0, result: 'carded' }]);
      const card = await cardFor('wait2', 'wait');
      expect(card?.title).toBe('You asked Kue Chen for the hosting login. Wait on them?');
      const outboxBefore = await prisma.emailOutbox.count();
      const res = await tapAct({ action: 'proposal_yes', item_key: proposalKey(card!.id) });
      expect(res.message).toBe('Started a wait on Kue Chen.');
      const wait = await prisma.wait.findFirst({ where: { email_thread_id: th('wait2') } });
      expect(wait).toMatchObject({ template_key: 'mail.awaiting_reply', state: 'waiting', email_account: acct, created_by_automation: 'sent-reconciler' });
      expect(wait?.title).toContain('Waiting on Kue Chen since November 9 for the hosting login');
      expect(await prisma.emailOutbox.count()).toBe(outboxBefore);
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
      expect((await prisma.wait.findUnique({ where: { id: wait!.id } }))?.state).not.toBe('waiting');
    });

    it('a session card clears the question through the home row, never touching the session; a changed question is refused', async () => {
      const m = message('sess', [{ type: 'session', session_key: `ext-${tag}`, quote: 'I picked the friendly tone.', confidence: 'high' }], { new_part: 'Hi Kue.\nI picked the friendly tone.\nThanks' });
      const r = await save([m]);
      expect(decisions(r, 'sess')).toEqual([{ i: 0, result: 'carded' }]);
      const card = await cardFor('sess', 'session');
      expect(card?.target_key).toBe(`session:ext-${tag}`);
      const before = await prisma.oracleSession.findFirst({ where: { external_id: `ext-${tag}` } });
      const res = await tapAct({ action: 'proposal_yes', item_key: proposalKey(card!.id) });
      expect(res.message).toBe('Cleared the question.');
      const state = await prisma.homeItemState.findFirst({ where: { user_id: adminId, item_key: `session:ext-${tag}` } });
      expect(state?.session_cleared_hash).toBe(sha(before!.waiting_on as string));
      const after = await prisma.oracleSession.findFirst({ where: { external_id: `ext-${tag}` } });
      expect(after?.waiting_on).toBe(before?.waiting_on);
      expect(after?.updated_at.getTime()).toBe(before?.updated_at.getTime());
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
    });

    it('Bast\'s own words (a hash of a draft Bast wrote) allow only Track it', async () => {
      const bastBody = 'Hi Kue.\nI updated the footer links.\nThanks';
      await prisma.homeOwedThread.create({ data: { user_id: adminId, thread_key: `thread:${acct}:${tag}-bast`, state: 'drafted', draft_hash: sha(bastBody), draft_text: bastBody } });
      const q1 = 'I updated the footer links.';
      const m = message('bastw', [note('own2', q1)], { new_part: bastBody, thread_id: th('own2'), thread_root: th('own2') });
      const r = await save([m]);
      expect(decisions(r, 'bastw')).toEqual([{ i: 0, result: 'refused', reason: 'bast_words' }]);
      expect(r.messages[0].outcome).toBe('bast_words');
      const ctx = (await loadContext(prisma, adminId, NOW)) as { bast_draft_hashes: string[] };
      expect(ctx.bast_draft_hashes).toContain(sha(bastBody));
    });

    it('Log time: his own done task with no time; refused for another user\'s task or one that already has time', async () => {
      const t = await task('logme', { title: `Log me ${tag}`, status: 'done' });
      const res = await logTime(prisma, adminId, { task_id: t.id, minutes: 30, day: '2026-11-10' }, { now: NOW, timezone: TZ });
      expect(res.message).toBe('Logged 30 minutes.');
      const te = await prisma.timeEntry.findFirst({ where: { task_id: t.id } });
      expect(te).toMatchObject({ user_id: adminId, duration: 30, is_billable: true });
      expect(te?.description).toContain('Estimated, logged after the fact from your email of');
      await expect(logTime(prisma, adminId, { task_id: t.id, minutes: 30, day: '2026-11-10' }, { now: NOW, timezone: TZ })).rejects.toMatchObject({ code: 'has_time' });
      await expect(logTime(prisma, adminId, { task_id: ids.sab, minutes: 30, day: '2026-11-10' }, { now: NOW, timezone: TZ })).rejects.toMatchObject({ code: 'not_found' });
      await expect(logTime(prisma, adminId, { task_id: ids.hasTime, minutes: 30, day: '2026-11-10' }, { now: NOW, timezone: TZ })).rejects.toMatchObject({ code: 'has_time' });
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
      expect((await prisma.timeEntry.findUnique({ where: { id: te!.id } }))?.is_deleted).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the daily caps, the off switch, and everyone else', () => {
    beforeAll(async () => {
      await prisma.homeReconcileChange.updateMany({ where: { user_id: adminId }, data: { created_at: new Date(NOW.getTime() - 2 * 24 * 3600_000) } });
    });

    it('the 11th new card of a day is nothing (the daily card cap)', async () => {
      const msg = await prisma.homeReconcileMessage.create({
        data: { user_id: adminId, message_key: `${tag}-cardcap`, account: acct, gmail_id: 'cardcap', thread_id: 'cardcap', sent_at: SENT, outcome: 'proposed' },
      });
      const recent = new Date(NOW.getTime() - 3600_000);
      await prisma.homeReconcileChange.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({ user_id: adminId, message_id: msg.id, kind: 'done', mode: 'card', state: 'dismissed', dedupe_key: `${tag}-cfill-${i}`, title: 'x', confidence: 'high', created_at: recent })),
      });
      expect(((await loadContext(prisma, adminId, NOW)) as { caps: { cards_left: number } }).caps.cards_left).toBe(0);
      const q = 'I tidied the newsletter template.';
      const m = message('own3cap', [done('own3', q)], { new_part: `Hi.\n${q}\nThanks`, thread_id: th('own3'), thread_root: th('own3') });
      expect(decisions(await save([m]), 'own3cap')).toEqual([{ i: 0, result: 'refused', reason: 'duplicate' }]);
      const m2 = message('capsess', [{ type: 'wait', wait_on: { email: kue, name: 'Kue Chen', what: 'the logo' }, quote: 'I asked for the logo.', confidence: 'high' }], { new_part: 'Hi.\nI asked for the logo.\nThanks' });
      expect(decisions(await save([m2]), 'capsess')).toEqual([{ i: 0, result: 'nothing', reason: 'cap' }]);
      await prisma.homeReconcileChange.deleteMany({ where: { user_id: adminId, dedupe_key: { startsWith: `${tag}-cfill-` } } });
    });

    it('the 21st note of a day becomes a card', async () => {
      const msg = await prisma.homeReconcileMessage.create({
        data: { user_id: adminId, message_key: `${tag}-capmsg`, account: acct, gmail_id: 'cap', thread_id: 'cap', sent_at: SENT, outcome: 'noted' },
      });
      const recent = new Date(NOW.getTime() - 3600_000);
      await prisma.homeReconcileChange.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({ user_id: adminId, message_id: msg.id, kind: 'note', mode: 'auto', state: 'applied', dedupe_key: `${tag}-fill-${i}`, title: 'x', confidence: 'high', created_at: recent })),
      });
      expect(((await loadContext(prisma, adminId, NOW)) as { caps: { notes_left: number } }).caps.notes_left).toBe(0);
      const q = 'I tidied the newsletter template.';
      const m = message('own3late', [note('own3', q)], { new_part: `Hi.\n${q}\nThanks`, thread_id: th('own3'), thread_root: th('own3') });
      const r = await save([m]);
      expect(decisions(r, 'own3late')).toEqual([{ i: 0, result: 'carded' }]);
      expect((await cardFor('own3late', 'note'))?.reason).toBe('cap');
      await prisma.homeReconcileChange.deleteMany({ where: { user_id: adminId, dedupe_key: { startsWith: `${tag}-fill-` } } });
    });

    it('with the home view off for the owner, nothing is written and the answer is skipped', async () => {
      await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'overlook' } });
      try {
        const before = await prisma.homeReconcileMessage.count();
        const ctx = await loadContext(prisma, adminId, NOW);
        expect(ctx).toMatchObject({ skipped: 'home_off', owner_ok: false, on: false });
        const r = await save([message('offq', [note('own3')])]);
        expect(r).toMatchObject({ skipped: 'home_off', messages: [] });
        const d = await saveReconcile(prisma, adminId, body([message('offq', [note('own3')])], true), NOW);
        expect(d).toMatchObject({ skipped: 'home_off', messages: [] });
        expect(await prisma.homeReconcileMessage.count()).toBe(before);
      } finally {
        await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'home' } });
      }
    });

    it('with the reconcile switch off nothing is written either', async () => {
      await prisma.homeKeeperSettings.update({ where: { user_id: adminId }, data: { reconcile_on: false } });
      try {
        const before = await prisma.homeReconcileMessage.count();
        expect(await loadContext(prisma, adminId, NOW)).toMatchObject({ owner_ok: true, on: false });
        expect(await save([message('offq2', [note('own3')])])).toMatchObject({ skipped: 'reconcile_off', messages: [] });
        expect(await prisma.homeReconcileMessage.count()).toBe(before);
      } finally {
        await prisma.homeKeeperSettings.update({ where: { user_id: adminId }, data: { reconcile_on: true } });
      }
    });

    it('a tech user and an overlook admin see no change, and no row of theirs was made', async () => {
      expect(await others()).toEqual(otherSnapshot);
      const tech = await screen(techId).catch(() => null);
      void tech;
      expect((await prisma.homeReconcileChange.count({ where: { user_id: { in: [techId, overlookAdminId, otherId] } } }))).toBe(0);
    });
  });
});
