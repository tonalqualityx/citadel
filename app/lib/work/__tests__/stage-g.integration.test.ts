// @vitest-environment node
/**
 * Work stage G against a real Postgres: the one-time looks-finished sweep. The route and the home act run as handlers and functions
 * with the sign-in mocked. Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. Seeds its own rows and removes
 * only those (and puts the one BastChatSettings row back as it found it). Run on its own clean database:
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/work_g_int npx vitest run lib/work/__tests__/stage-g.integration.test.ts
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
import { POST as finishedPost } from '@/app/api/bast-chat/worker/finished/route';
import { runSweep } from '../finished-store';
import { closeAsksForTask } from '../ask-closure';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(!SCRATCH)('Work stage G: the looks-finished sweep (real database)', () => {
  const tag = `wg-${Date.now()}`;
  const adminId = randomUUID();
  const techId = randomUUID();
  const users = [adminId, techId];
  let clientId = '';
  const ids: Record<string, string> = {};
  const taskIds: string[] = [];
  let settingsBefore: { owner_user_id: string | null } | null = null;

  const as = (a: unknown) => { auth.current = a; };
  const worker = () => ({ userId: adminId, email: `bast-${tag}@example.test`, role: 'pm', via: 'api_key', apiKeyId: 'k', lane: 'bast-chat', laneEnforced: true });
  const opts = (now = NOW) => ({ now, timezone: TZ, date: zonedDateString(now, TZ) });
  const key = (id: string) => `finished:${id}`;

  const task = async (k: string, over: Record<string, unknown> = {}, quietDays = 10) => {
    const t = await prisma.task.create({ data: { title: `${k} ${tag}`, status: 'in_progress', assignee_id: adminId, client_id: clientId, tags: [], created_at: ago(30), ...over } as never });
    await prisma.$executeRawUnsafe(`UPDATE tasks SET updated_at = $1 WHERE id = $2::uuid`, ago(quietDays), t.id);
    ids[k] = t.id;
    taskIds.push(t.id);
    return t;
  };
  const live = (k: string, daysAgo = 8) => prisma.taskReceipt.create({ data: { task_id: ids[k], step: 'live', live_url: `https://${k.toLowerCase()}.example.test/`, created_at: ago(daysAgo) } as never });
  const items = (state?: string) => prisma.workFinishedItem.findMany({ where: { user_id: adminId, ...(state ? { state } : {}), task_id: { in: taskIds } } });
  const itemFor = async (k: string) => prisma.workFinishedItem.findFirstOrThrow({ where: { user_id: adminId, task_id: ids[k] }, orderBy: { created_at: 'desc' } });
  const keyOf = async (k: string) => key((await itemFor(k)).id);
  const status = async (k: string) => (await prisma.task.findUniqueOrThrow({ where: { id: ids[k] } })).status;
  const screen = async (userId = adminId) => {
    const [raw, states] = await Promise.all([loadHomeInputs(prisma, userId, NOW, { timezone: TZ }), loadItemStates(prisma, userId)]);
    const sel = selectHome({ raw, states, now: NOW });
    const all = Object.values(sel.sections as unknown as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v : [])) as { key?: string; finished?: { rows: { key: string; task_id: string; title: string; ticked: boolean; group: string; strength: string; evidence: { line: string }[] }[]; others: string[] }; title?: string; type?: string }[];
    return { raw, sel, card: all.find((i) => i.key === 'finished:all') ?? null };
  };
  const row = async (k: string) => {
    const { card } = await screen();
    const r = card?.finished?.rows.find((x) => x.task_id === ids[k]);
    if (!r) throw new Error(`no row for ${k}`);
    return r;
  };
  const sweep = (dry: boolean, machine: unknown[] = [], now = NOW) => runSweep(prisma, { dry, machine_evidence: machine as never }, now);
  const snapshot = async () => ({
    tasks: (await prisma.task.findMany({ where: { id: { in: taskIds } }, orderBy: { id: 'asc' }, select: { id: true, status: true, updated_at: true } })).map((t) => `${t.id}:${t.status}:${t.updated_at.toISOString()}`),
    comments: await prisma.comment.count({ where: { task_id: { in: taskIds } } }),
    asks: await prisma.emailAsk.count({ where: { message_id: { startsWith: tag }, state: 'open' } }),
    actions: await prisma.homeAction.count({ where: { user_id: adminId } }),
    outbox: await prisma.emailOutbox.count({ where: { created_at: { gte: ago(1) } } }),
  });

  beforeAll(async () => {
    settingsBefore = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `admin-${tag}@example.test`, password_hash: 'x', name: 'Admin WG', role: 'admin' },
        { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Sabeen WG', role: 'tech' },
      ],
    });
    await prisma.userPreference.createMany({ data: [{ user_id: adminId, home_view: 'home', timezone: TZ }, { user_id: techId, home_view: 'overlook', timezone: TZ }] });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, create: { id: 1, owner_user_id: adminId }, update: { owner_user_id: adminId } });
    clientId = (await prisma.client.create({ data: { name: `Lifeline ${tag}`, status: 'active' } })).id;

    await task('Strong');
    await live('Strong');
    await task('Medium');
    await task('MediumTwin', { status: 'done', completed_at: ago(2), title: `Medium ${tag}` });
    await task('Secure', { tags: ['security'] });
    await live('Secure');
    await task('Portal', { client_visible: true });
    await live('Portal');
    await task('Partial', { requirements: [{ id: 'a', text: 'one', completed: true, sort_order: 0 }, { id: 'b', text: 'two', completed: false, sort_order: 1 }] });
    await live('Partial');
    await task('NoProof');
    await task('Fresh', {}, 0.5);
    await live('Fresh');
    await task('Sabeens', { assignee_id: techId });
    await live('Sabeens');
    await task('Linked');
    await live('Linked');
    await prisma.emailAsk.create({
      data: { message_id: `${tag}-ask`, thread_id: `${tag}-th`, account: 'mike@becomeindelible.com', from_name: 'Jeffrey', from_email: `j-${tag}@client.test`, subject: 'Linked subject', gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId, task_id: ids.Linked, received_at: ago(9), deep_link: `https://mail.google.com/mail/u/0/#all/${tag}-ask` } as never,
    });
    await task('Worker');
    await task('Orphan', { title: `Orphaned thread: ${tag} scope`, created_at: ago(20) });
    await task('OrphanKept', { id: 'c4722a17-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: `Orphaned thread: ${tag} kept`, created_at: ago(20) });
  });

  afterAll(async () => {
    await prisma.emailAsk.deleteMany({ where: { message_id: { startsWith: tag } } });
    await prisma.workFinishedItem.deleteMany({ where: { user_id: { in: users } } });
    await prisma.taskReceipt.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.notification.deleteMany({ where: { user_id: { in: users } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.homeReconcileHold.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeAction.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeItemState.deleteMany({ where: { user_id: { in: users } } });
    await prisma.homeDay.deleteMany({ where: { user_id: { in: users } } }).catch(() => undefined);
    await prisma.activityLog.deleteMany({ where: { user_id: { in: users } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    if (settingsBefore) await prisma.bastChatSettings.update({ where: { id: 1 }, data: { owner_user_id: settingsBefore.owner_user_id } });
    else await prisma.bastChatSettings.deleteMany({ where: { id: 1 } });
    await prisma.userPreference.deleteMany({ where: { user_id: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the sweep itself changes nothing', () => {
    it('a dry run counts and writes nothing, and a real run only makes rows', async () => {
      const before = await snapshot();
      const dry = await sweep(true);
      expect(dry.dry).toBe(true);
      expect(dry.created).toBe(0);
      expect(dry.total).toBeGreaterThanOrEqual(6);
      expect(dry.sample.length).toBeGreaterThan(0);
      expect(await items()).toHaveLength(0);
      expect(await snapshot()).toEqual(before);

      const real = await sweep(false);
      expect(real.created).toBeGreaterThanOrEqual(7);
      expect(await items('open')).not.toHaveLength(0);
      expect(await snapshot()).toEqual(before); // no task, comment, ask, Handled line or mail changed
    });

    it('a second real run while rows are open answers already_open and writes nothing', async () => {
      const n = (await items()).length;
      const again = await sweep(false);
      expect(again.already_open).toBe(true);
      expect(again.created).toBe(0);
      expect((await items()).length).toBe(n);
    });

    it('a task with no proof, a task edited in the last 48 hours and the orphan the owner kept are never candidates', async () => {
      const got = (await items()).map((i) => i.task_id);
      for (const k of ['NoProof', 'Fresh', 'OrphanKept']) expect(got).not.toContain(ids[k]);
      for (const k of ['Strong', 'Secure', 'Portal', 'Partial', 'Orphan']) expect(got).toContain(ids[k]);
    });

    it("another person's task is counted, not listed, and never closable", async () => {
      const other = await prisma.workFinishedItem.findFirst({ where: { user_id: adminId, task_id: ids.Sabeens } });
      expect(other?.grp).toBe('others');
      const { card } = await screen();
      expect(card?.finished?.rows.some((r) => r.title === `Sabeens ${tag}`)).toBe(false);
      expect(card?.finished?.others.some((l) => l.startsWith('1 of Sabeen WG'))).toBe(true);
      await expect(runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [key(other!.id)] }, opts())).rejects.toThrow();
      expect(await status('Sabeens')).toBe('in_progress');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the card', () => {
    it('is one row with each task and its proof; strong is ticked, medium is not', async () => {
      const { card, sel } = await screen();
      expect(card?.type).toBe('finished');
      expect(card?.title).toMatch(/^\d+ tasks look finished\. Close them\?$/);
      const strong = await row('Strong');
      expect(strong.group).toBe('main');
      expect(strong.strength).toBe('strong');
      expect(strong.ticked).toBe(true);
      expect(strong.evidence[0].line).toMatch(/^Live on strong\.example\.test since .* \(go-live receipt\)$/);
      // exactly one such card on the screen
      const all = Object.values(sel.sections as unknown as Record<string, unknown>).flatMap((v) => (Array.isArray(v) ? v : [])) as { type?: string }[];
      expect(all.filter((i) => i.type === 'finished')).toHaveLength(1);
    });

    it('medium proof is unticked', async () => {
      // Make a medium row: its later done twin says the same thing. Sweep rows are fixed once made, so check the rule on a fresh pass.
      await prisma.workFinishedItem.deleteMany({ where: { user_id: adminId } });
      await prisma.task.update({ where: { id: ids.MediumTwin }, data: { completed_at: ago(2) } });
      await sweep(false);
      const m = await row('Medium');
      expect(m.strength).toBe('medium');
      expect(m.ticked).toBe(false);
    });

    it('security, portal and partly-ticked tasks sit in their own groups', async () => {
      expect((await row('Secure')).group).toBe('security');
      expect((await row('Portal')).group).toBe('portal');
      expect((await row('Partial')).group).toBe('unticked');
      expect((await row('Orphan')).group).toBe('orphan');
    });

    it("another user's screen is unchanged", async () => {
      const mine = await screen(techId);
      expect(mine.raw.finished ?? null).toBeNull();
      expect(mine.card).toBeNull();
      // and the owner off the home view gets nothing from the sweep
      await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'overlook' } });
      const off = await sweep(true);
      await prisma.userPreference.update({ where: { user_id: adminId }, data: { home_view: 'home' } });
      expect(off.skipped).toBe('home_off');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('the taps', () => {
    it('a security task is never in the batch, and one tap closes only that one', async () => {
      const sec = await keyOf('Secure');
      const strong = await keyOf('Strong');
      // A batch that names the security row alongside a main row closes the main row only.
      const res = await runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [sec, strong] }, opts());
      expect(res.undo_until).not.toBeNull();
      expect(await status('Secure')).toBe('in_progress');
      expect(await status('Strong')).toBe('done');
      expect((await itemFor('Secure')).state).toBe('open');
      // A batch of only the security row closes nothing.
      await expect(runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [sec] }, opts())).rejects.toThrow();
      expect(await status('Secure')).toBe('in_progress');
      // The one tap closes that task and nothing else.
      const before = await status('Portal');
      await runHomeAct(prisma, adminId, { action: 'finished_close_one', item_key: sec }, opts());
      expect(await status('Secure')).toBe('done');
      expect(await status('Portal')).toBe(before);
    });

    it('a portal task closes only by its own tap', async () => {
      const k = await keyOf('Portal');
      await expect(runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [k] }, opts())).rejects.toThrow();
      expect(await status('Portal')).toBe('in_progress');
      await runHomeAct(prisma, adminId, { action: 'finished_close_one', item_key: k }, opts());
      expect(await status('Portal')).toBe('done');
    });

    it('a task with an unticked item is never closed, by a batch or by one tap', async () => {
      const k = await keyOf('Partial');
      await expect(runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [k] }, opts())).rejects.toThrow();
      await expect(runHomeAct(prisma, adminId, { action: 'finished_close_one', item_key: k }, opts())).rejects.toThrow();
      expect(await status('Partial')).toBe('in_progress');
    });

    it('a main row refuses the one-tap act', async () => {
      const k = await keyOf('Medium');
      await expect(runHomeAct(prisma, adminId, { action: 'finished_close_one', item_key: k }, opts())).rejects.toThrow();
      expect(await status('Medium')).toBe('in_progress');
    });

    it('a batch closes through the normal status path: activity, an internal comment, Stage A closes the emails, one Handled line', async () => {
      const k = await keyOf('Linked');
      const res = await runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [k] }, opts());
      expect(await status('Linked')).toBe('done');
      const t = await prisma.task.findUniqueOrThrow({ where: { id: ids.Linked } });
      expect(t.completed_at).not.toBeNull();
      expect(await prisma.activityLog.count({ where: { user_id: adminId, entity_id: ids.Linked } })).toBeGreaterThan(0);
      const c = await prisma.comment.findFirstOrThrow({ where: { task_id: ids.Linked } });
      expect(c.is_internal).toBe(true);
      expect(c.client_visible).toBe(false);
      expect(c.content).toMatch(/^Closed from the looks-finished list: Live on linked\.example\.test since .*\.$/);
      const ask = await prisma.emailAsk.findUniqueOrThrow({ where: { message_id: `${tag}-ask` } });
      expect(ask.state).toBe('handled');
      expect(ask.closed_reason).toBe('task_done');
      const { sel } = await screen();
      expect(sel.sections.handled.some((l) => l.text === 'Closed 1 task that looked finished.' || /^Closed \d+ tasks? that looked finished\./.test(l.text))).toBe(true);
      expect((await itemFor('Linked')).state).toBe('closed');
      expect((await itemFor('Linked')).home_action_id).toBe(res.action_id);
    });

    it('Undo restores the status and the emails Stage A closed', async () => {
      const row0 = await prisma.homeAction.findFirstOrThrow({ where: { user_id: adminId, action: 'finished_close', item_key: null, before: { path: ['finished', 'items', '0', 'task_id'], equals: ids.Linked } as never } });
      await runHomeUndo(prisma, adminId, row0.id, NOW);
      expect(await status('Linked')).toBe('in_progress');
      const ask = await prisma.emailAsk.findUniqueOrThrow({ where: { message_id: `${tag}-ask` } });
      expect(ask.state).toBe('open');
      expect(ask.closed_reason).toBeNull();
      expect((await itemFor('Linked')).state).toBe('undone');
      // Stage A's own line for that close is marked undone too, so it cannot be tapped a second time.
      const stageA = await prisma.homeAction.findMany({ where: { user_id: adminId, action: 'work_close', undone_at: null } });
      expect(stageA.some((a) => JSON.stringify(a.before).includes(ids.Linked))).toBe(false);
      // A second Undo is refused.
      await expect(runHomeUndo(prisma, adminId, row0.id, NOW)).rejects.toThrow();
    });

    it('Undo leaves a task that changed since the close as the owner left it', async () => {
      const k = await keyOf('Orphan');
      const res = await runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [k] }, opts());
      expect(await status('Orphan')).toBe('done');
      await prisma.task.update({ where: { id: ids.Orphan }, data: { title: `Orphaned thread: ${tag} scope, edited` } });
      await runHomeUndo(prisma, adminId, res.action_id, NOW);
      expect(await status('Orphan')).toBe('done'); // changed since: not put back
      expect((await itemFor('Orphan')).state).toBe('closed');
    });

    it('a task edited after the list was made is left open by the batch', async () => {
      await prisma.workFinishedItem.deleteMany({ where: { user_id: adminId, state: 'open' } });
      await task('Late');
      await live('Late');
      await sweep(false);
      const k = await keyOf('Late');
      await prisma.task.update({ where: { id: ids.Late }, data: { notes: 'edited after the sweep' } });
      await expect(runHomeAct(prisma, adminId, { action: 'finished_close', item_keys: [k] }, opts())).rejects.toThrow();
      expect(await status('Late')).toBe('in_progress');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('not finished', () => {
    it('Keep takes the row off the card and hides the task for 90 days, not longer', async () => {
      await prisma.workFinishedItem.deleteMany({ where: { user_id: adminId, state: 'open' } });
      await task('Keeper');
      await live('Keeper');
      await sweep(false);
      const k = await keyOf('Keeper');
      const res = await runHomeAct(prisma, adminId, { action: 'finished_keep', item_key: k }, opts());
      expect(res.undo_until).not.toBeNull();
      expect(await status('Keeper')).toBe('in_progress');
      const { card } = await screen();
      expect(card?.finished?.rows.some((r) => r.title === `Keeper ${tag}`) ?? false).toBe(false);
      // The sweep does not offer it again.
      await prisma.workFinishedItem.deleteMany({ where: { user_id: adminId, state: 'open' } });
      const soon = await sweep(true, [], new Date(NOW.getTime() + 89 * DAY));
      expect(soon.sample.join('|')).not.toContain(`Keeper ${tag}`);
      await sweep(false);
      expect(await prisma.workFinishedItem.count({ where: { user_id: adminId, task_id: ids.Keeper, state: 'open' } })).toBe(0);
      // After 90 days it may be offered again (a later run key, so the old kept row does not collide).
      await prisma.workFinishedItem.deleteMany({ where: { user_id: adminId, state: 'open' } });
      await sweep(false, [], new Date(NOW.getTime() + 91 * DAY));
      expect(await prisma.workFinishedItem.count({ where: { user_id: adminId, task_id: ids.Keeper, state: 'open' } })).toBe(1);
      await prisma.workFinishedItem.deleteMany({ where: { user_id: adminId, state: 'open' } });
    });

    it('Undo of Not finished puts the row back', async () => {
      const it0 = await itemFor('Keeper');
      expect(it0.state).toBe('kept');
      const act = await prisma.homeAction.findFirstOrThrow({ where: { user_id: adminId, action: 'finished_keep' }, orderBy: { created_at: 'desc' } });
      await runHomeUndo(prisma, adminId, act.id, NOW);
      expect((await itemFor('Keeper')).state).toBe('open');
    });
  });

  // ------------------------------------------------------------------------------------------------------------------
  describe('machine proof and the route', () => {
    it('worker done evidence after the last update makes a strong row; before it does not', async () => {
      await prisma.workFinishedItem.deleteMany({ where: { user_id: adminId, state: 'open' } });
      const r1 = await sweep(true, [{ task_id: ids.Worker, kind: 'worker_done', ref: 'run-1', at: ago(2).toISOString() }]);
      expect(r1.counts.main.strong).toBeGreaterThan(0);
      const r0 = await sweep(true, [{ task_id: ids.Worker, kind: 'worker_done', ref: 'run-1', at: ago(20).toISOString() }]);
      expect(r0.counts.main.strong).toBe(r1.counts.main.strong - 1);
    });

    it('the route is the chat worker only and runs the sweep for the owner', async () => {
      const post = (body: unknown) => finishedPost(new NextRequest('http://localhost:3000/api/bast-chat/worker/finished', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
      as({ userId: adminId, email: 'a@example.test', role: 'admin', via: 'session' });
      expect((await post({ dry: true })).status).toBe(403);
      as(worker());
      const dry = await post({ dry: true });
      expect(dry.status).toBe(200);
      const j = await dry.json();
      expect(j.dry).toBe(true);
      expect(j.created).toBe(0);
      expect((await post({ dry: true, user_id: adminId })).status).toBe(400);
    });

    it('Stage A is untouched: closeAsksForTask still closes a finished task\'s emails', async () => {
      await task('Direct');
      const a = await prisma.emailAsk.create({
        data: { message_id: `${tag}-direct`, thread_id: `${tag}-thd`, account: 'mike@becomeindelible.com', from_name: 'J', from_email: `j2-${tag}@client.test`, subject: 'Direct', gist: 'g', queue: 'answer', severity: 'internal', is_urgent: false, state: 'open', client_id: clientId, task_id: ids.Direct, received_at: ago(9), deep_link: 'https://mail.google.com/x' } as never,
      });
      await prisma.task.update({ where: { id: ids.Direct }, data: { status: 'done', completed_at: NOW } });
      const r = await closeAsksForTask(prisma, ids.Direct, 'done');
      expect(r.closed).toEqual([a.id]);
    });
  });
});
