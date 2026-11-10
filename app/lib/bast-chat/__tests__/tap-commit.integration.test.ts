// @vitest-environment node
/**
 * VERIFY-4 R4 against a real Postgres: inside a locked chat request, nothing best-effort can change the outcome and
 * nothing leaves the building before the commit.
 * - A title longer than the activity log's and the notification's columns (main loses those two rows and keeps the
 *   change): the chat's "in progress", reassignment, "mark done", the Hand to Bast tap and Undo all answer success and
 *   persist, exactly as on main.
 * - A forced failure in the change record (a trigger), and a swallowed failure inside a savepoint, leave the main
 *   write committed. A swallowed failure outside one surfaces as a 500, never a success with nothing written.
 * - A Slack send that takes 30 seconds runs after the commit: no advisory lock, no open transaction while it waits.
 * - A change that rolls back sends nothing and logs nothing.
 *
 * Runs only when DATABASE_URL names a local scratch database:
 *   DATABASE_URL='postgresql://...@localhost:55433/<..scratch..>' npx vitest run lib/bast-chat/__tests__/tap-commit.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

const who = vi.hoisted(() => ({ als: null as null | { getStore: () => unknown } }));
vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(async () => who.als!.getStore()),
}));
// Every channel on, so a notice would go to Slack; the Slack send itself is a stand-in that records when it ran.
const slack = vi.hoisted(() => ({ calls: [] as { at: number; inScope: boolean }[], delayMs: 0, scoped: null as null | (() => unknown) }));
vi.mock('@/lib/services/notification-preferences', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/notification-preferences')>()),
  getNotificationPreference: vi.fn(async () => ({ in_app: true, email: false, slack: true })),
}));
vi.mock('@/lib/services/slack-notifications', () => ({
  sendSlackNotification: vi.fn(async () => {
    slack.calls.push({ at: Date.now(), inScope: !!slack.scoped?.() });
    if (slack.delayMs) await new Promise((r) => setTimeout(r, slack.delayMs));
    return true;
  }),
}));

import { prisma } from '@/lib/db/prisma';
import { scopedTransaction, withSavepoint } from '@/lib/db/scope';
import { ApiError } from '@/lib/api/errors';
import { PATCH as patchRoute } from '@/app/api/tasks/[id]/route';
import { notifyTaskAssigned } from '@/lib/services/notifications';
import { logActivity } from '@/lib/services/activity';
import { BAST_USER_ID } from '../gate-mirror';
import { prepareOperation, releaseAction, storeProposal, undoAction } from '../actions';
import { inLockedTransaction } from '../task-locks';

slack.scoped = () => scopedTransaction();

const URL = process.env.DATABASE_URL ?? '';
const RUN = /scratch/i.test(URL) && /localhost|127\.0\.0\.1/.test(URL);
const CAP = 1_000_000;
const LONG = (tag: string) => `${'Proof the autumn menu page against the printed sheet and the price list. '.repeat(4)}${tag}`.slice(0, 300);

describe.skipIf(!RUN)('nothing best-effort changes a locked chat request (real database)', () => {
  const als = new AsyncLocalStorage<unknown>();
  who.als = als;
  const tag = `commit-${Date.now()}`;
  const ownerId = randomUUID();
  const techId = randomUUID();
  let conversationId = '';
  const chatAuth = { userId: BAST_USER_ID, email: 'bast@example.test', role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true };
  let watcher: PrismaClient;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner Commit', role: 'admin' } });
    await prisma.user.create({ data: { id: techId, email: `tech-${tag}@example.test`, password_hash: 'x', name: 'Tech Commit', role: 'tech' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast Commit', role: 'pm' } });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, update: { owner_user_id: ownerId, enabled: true, daily_write_cap: CAP }, create: { id: 1, owner_user_id: ownerId, enabled: true, daily_write_cap: CAP } });
    conversationId = (await prisma.bastChatConversation.create({ data: { owner_id: ownerId, status: 'running' } })).id;
    watcher = new PrismaClient({ datasourceUrl: URL.replace(/([?&])connection_limit=\d+/, '$1connection_limit=2') });
  });
  afterAll(async () => {
    await watcher.$disconnect();
    await prisma.$disconnect();
  });

  const newTask = async (title: string, o: Record<string, unknown> = {}) => (await prisma.task.create({ data: { title, status: 'not_started', assignee_id: ownerId, ...o } })).id;
  const chatPatch = async (id: string, body: Record<string, unknown>) =>
    als.run(chatAuth, async () => {
      const res = await patchRoute(new NextRequest(`http://localhost/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'X-Bast-Chat-Conversation': conversationId } }), { params: Promise.resolve({ id }) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    });
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const records = (id: string) => prisma.bastChatAction.findMany({ where: { target_id: id, target_type: 'task', status: 'applied' }, orderBy: { created_at: 'asc' } });

  it('a 300 character title: chat in progress, reassignment, mark done, the Hand to Bast tap and Undo all succeed and persist', async () => {
    const t = await newTask(LONG('A'));
    expect((await chatPatch(t, { status: 'in_progress' })).status).toBe(200);
    expect((await row(t)).status).toBe('in_progress');
    expect((await chatPatch(t, { assignee_id: techId })).status).toBe(200);
    expect((await row(t)).assignee_id).toBe(techId);
    expect((await chatPatch(t, { status: 'done' })).status).toBe(200);
    expect((await row(t)).status).toBe('done');
    // Undo of the newest change (done) puts it back to in progress.
    const recs = await records(t);
    expect(recs.length).toBe(3);
    const undone = await undoAction(recs[2].id, ownerId, new Date(), prisma);
    expect(undone.status).toBe('undone');
    expect((await row(t)).status).toBe('in_progress');
    // The Hand to Bast tap on another long title.
    const h = await newTask(LONG('B'));
    const { input, prepared } = await prepareOperation('task', { task_id: h, body: { assignee_id: BAST_USER_ID } }, { ownerId, db: prisma });
    const p = await storeProposal({ ownerId, conversationId, tool: 'change_task', op: 'task', input, prepared, reserve: false, db: prisma });
    expect((await releaseAction(p.id, ownerId, new Date(), prisma)).status).toBe('released');
    expect((await row(h)).assignee_id).toBe(BAST_USER_ID);
    // As on main, the two over-long best-effort rows are simply missing; nothing else is.
    expect(await prisma.activityLog.count({ where: { entity_id: t } })).toBe(0);
  }, 120_000);

  it('a change record that fails (a trigger refuses it) leaves the change itself committed', async () => {
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION bcv2_refuse_record() RETURNS trigger AS $$ BEGIN IF NEW.summary LIKE '%FAILREC%' THEN RAISE EXCEPTION 'refused for the test'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS bcv2_refuse_record ON bast_chat_actions');
    await prisma.$executeRawUnsafe('CREATE TRIGGER bcv2_refuse_record BEFORE INSERT ON bast_chat_actions FOR EACH ROW EXECUTE FUNCTION bcv2_refuse_record()');
    try {
      const t = await newTask('Rename me');
      const r = await chatPatch(t, { title: 'FAILREC renamed' });
      expect(r.status).toBe(200);
      expect((await row(t)).title).toBe('FAILREC renamed');
      expect(await records(t)).toHaveLength(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS bcv2_refuse_record ON bast_chat_actions');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS bcv2_refuse_record()');
    }
  });

  it('a swallowed failure inside a savepoint leaves the main write; outside one it is a 500 with nothing written', async () => {
    const a = await newTask('Savepoint A');
    await inLockedTransaction(prisma, async () => undefined, async () => {
      await prisma.task.update({ where: { id: a }, data: { title: 'Savepoint A kept' } });
      await withSavepoint(() => prisma.$executeRawUnsafe('SELECT 1/0')).catch(() => null);
      return null;
    });
    expect((await row(a)).title).toBe('Savepoint A kept');
    const b = await newTask('Savepoint B');
    const e = await inLockedTransaction(prisma, async () => undefined, async () => {
      await prisma.task.update({ where: { id: b }, data: { title: 'Savepoint B lost' } });
      await prisma.$executeRawUnsafe('SELECT 1/0').catch(() => null); // swallowed, no savepoint: the transaction is aborted
      return null;
    }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ statusCode: 500, code: 'tx_aborted', message: "That didn't go through. Try again." });
    expect((await row(b)).title).toBe('Savepoint B');
  });

  it('a nested $transaction inside a scope is a savepoint: its throw rolls back only its own writes', async () => {
    const t = await newTask('Nested');
    await inLockedTransaction(prisma, async () => undefined, async () => {
      await prisma.task.update({ where: { id: t }, data: { title: 'Nested outer' } });
      await prisma.$transaction(async (tx) => {
        await tx.task.update({ where: { id: t }, data: { notes: 'inner' } });
        throw new Error('inner fails');
      }).catch(() => null);
      return null;
    });
    const r = await row(t);
    expect(r.title).toBe('Nested outer');
    expect(r.notes).toBeNull();
  });

  it('a Slack send that takes 30 seconds runs after the commit: no lock, no open transaction while it waits', async () => {
    slack.calls = [];
    slack.delayMs = 30_000;
    try {
      const t = await newTask('Slow Slack', { project_id: null });
      const started = Date.now();
      const req = chatPatch(t, { assignee_id: techId });
      // While the send waits: no advisory lock held, no transaction left open on this database.
      const seen: { locks: number; inTx: number }[] = [];
      while (Date.now() - started < 25_000) {
        await new Promise((r) => setTimeout(r, 1000));
        if (slack.calls.length === 0) continue;
        const locks = (await watcher.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`) as { n: number }[];
        const inTx = (await watcher.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`) as { n: number }[];
        seen.push({ locks: locks[0].n, inTx: inTx[0].n });
        if (seen.length >= 3) break;
      }
      const res = await req;
      const took = Date.now() - started;
      console.log(`slow slack: answered ${res.status} after ${took} ms; while waiting: ${JSON.stringify(seen)}; slack calls ${JSON.stringify(slack.calls.map((c) => ({ inScope: c.inScope })))}`);
      expect(res.status).toBe(200);
      expect((await row(t)).assignee_id).toBe(techId);
      expect(slack.calls).toHaveLength(1);
      expect(slack.calls[0].inScope).toBe(false);
      expect(seen.length).toBeGreaterThan(0);
      for (const s of seen) expect(s).toEqual({ locks: 0, inTx: 0 });
    } finally {
      slack.delayMs = 0;
    }
  }, 120_000);

  it('a change that rolls back sends nothing and logs nothing', async () => {
    slack.calls = [];
    const t = await newTask('Rolled back', { project_id: null });
    const e = await inLockedTransaction(prisma, async () => undefined, async () => {
      await prisma.task.update({ where: { id: t }, data: { assignee_id: techId } });
      await notifyTaskAssigned(t, techId, 'Owner');
      await logActivity({ userId: ownerId, action: 'assigned', entityType: 'task', entityId: t, entityName: 'Rolled back' });
      throw new ApiError('Changed since. Open the task.', 409, 'changed_since');
    }).catch((x) => x);
    expect(e).toMatchObject({ statusCode: 409 });
    expect((await row(t)).assignee_id).toBe(ownerId);
    expect(slack.calls).toHaveLength(0);
    expect(await prisma.notification.count({ where: { entity_id: t } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { entity_id: t } })).toBe(0);
  });
});
