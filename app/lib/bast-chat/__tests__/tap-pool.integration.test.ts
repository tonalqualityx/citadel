// @vitest-environment node
/**
 * VERIFY-3 X3 and X4 against a real Postgres with a tiny pool. Every query of a locked chat request runs on the lock's
 * own connection, so a burst of chat edits, chat comments and owner taps, many more than the pool has connections,
 * plus ordinary staff requests alongside, all answer within 10 seconds: a success, a proposal, or a plain 409. And a tap
 * that dies half way (its write held up until its transaction gives out) leaves the proposal waiting, unclaimed.
 *
 * Runs only when DATABASE_URL names a local scratch database AND sets connection_limit=3:
 *   DATABASE_URL='postgresql://...@localhost:55433/<..scratch..>?connection_limit=3' npx vitest run lib/bast-chat/__tests__/tap-pool.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';

// Who is calling, per request (the requests run at once in one process).
const who = vi.hoisted(() => ({ als: null as null | { getStore: () => unknown } }));
vi.mock('@/lib/auth/middleware', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/middleware')>()),
  requireAuth: vi.fn(async () => who.als!.getStore()),
}));

import { prisma } from '@/lib/db/prisma';
import { PATCH as patchRoute, GET as getRoute } from '@/app/api/tasks/[id]/route';
import { BAST_USER_ID } from '../gate-mirror';
import { prepareOperation, releaseAction, storeProposal } from '../actions';
import { getRunnableOp } from '../ops';
import { applyChatOp } from '../ops/apply';
import { BUSY_TEXT } from '../task-locks';

const URL = process.env.DATABASE_URL ?? '';
const RUN = /scratch/i.test(URL) && /localhost|127\.0\.0\.1/.test(URL) && /connection_limit=3\b/.test(URL);
const CAP = 1_000_000;
const LIMIT_MS = 10_000;

type Outcome = { kind: string; status: number; code: string | null; ms: number; error?: string };

describe.skipIf(!RUN)('locked chat work on a pool of three connections (real database)', () => {
  const als = new AsyncLocalStorage<unknown>();
  who.als = als;
  const tag = `pool-${Date.now()}`;
  const ownerId = randomUUID();
  let conversationId = '';
  let projectId = '';
  const chatAuth = { userId: BAST_USER_ID, email: 'bast@example.test', role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true };
  const staffAuth = () => ({ userId: ownerId, email: `owner-${tag}@example.test`, role: 'admin', via: 'session' });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner Pool', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast Pool', role: 'pm' } });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, update: { owner_user_id: ownerId, enabled: true, daily_write_cap: CAP }, create: { id: 1, owner_user_id: ownerId, enabled: true, daily_write_cap: CAP } });
    conversationId = (await prisma.bastChatConversation.create({ data: { owner_id: ownerId, status: 'running' } })).id;
    const client = await prisma.client.create({ data: { name: `Pool client ${tag}`, type: 'direct', status: 'active' } });
    projectId = (await prisma.project.create({ data: { name: `Pool project ${tag}`, client_id: client.id, status: 'in_progress', dependencies_ordering_only: true } })).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const newTask = async (title: string) => (await prisma.task.create({ data: { title: `${title} ${tag}`, status: 'not_started', assignee_id: ownerId, project_id: projectId } })).id;
  const propose = async (taskId: string) => {
    const { input, prepared } = await prepareOperation('task', { task_id: taskId, body: { assignee_id: BAST_USER_ID } }, { ownerId, db: prisma });
    return (await storeProposal({ ownerId, conversationId, tool: 'change_task', op: 'task', input, prepared, reserve: false, db: prisma })).id;
  };
  const timed = async (kind: string, fn: () => Promise<{ status: number; code: string | null }>): Promise<Outcome> => {
    const t0 = Date.now();
    try {
      const r = await fn();
      return { kind, ...r, ms: Date.now() - t0 };
    } catch (e) {
      const o = e as { statusCode?: number; code?: string; message?: string };
      return { kind, status: o.statusCode ?? 500, code: o.code ?? null, ms: Date.now() - t0, error: o.message };
    }
  };
  const httpOutcome = async (res: Response) => ({ status: res.status, code: res.status >= 400 ? (((await res.json()) as { code?: string }).code ?? null) : null });
  const chatEdit = (taskId: string, title: string) =>
    timed('chat_patch', () =>
      als.run(chatAuth, async () =>
        httpOutcome(await patchRoute(new NextRequest(`http://localhost/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ title }), headers: { 'content-type': 'application/json', 'X-Bast-Chat-Conversation': conversationId } }), { params: Promise.resolve({ id: taskId }) })),
      ),
    );
  const staffEdit = (taskId: string, title: string) =>
    timed('staff_patch', () =>
      als.run(staffAuth(), async () => httpOutcome(await patchRoute(new NextRequest(`http://localhost/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ title }), headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ id: taskId }) }))),
    );
  const staffGet = (taskId: string) =>
    timed('staff_get', () => als.run(staffAuth(), async () => httpOutcome(await getRoute(new NextRequest(`http://localhost/api/tasks/${taskId}`), { params: Promise.resolve({ id: taskId }) }))));
  const tap = (proposalId: string) => timed('tap', async () => ({ status: (await releaseAction(proposalId, ownerId, new Date(), prisma)).status === 'released' ? 200 : 500, code: null }));
  const chatComment = (taskId: string, text: string) =>
    timed('chat_comment', async () => {
      const r = await applyChatOp({ ownerId, conversationId, op: getRunnableOp('comment')!, rawInput: { task_id: taskId, text }, dailyWriteCap: CAP, now: new Date(), db: prisma });
      return { status: r.kind === 'applied' ? 200 : 202, code: null };
    });

  /** Every answer is a success, a proposal, or a plain 409, inside the limit; never a 500 or a 401. */
  const judge = (label: string, out: Outcome[]) => {
    const by = (k: string) => out.filter((o) => o.kind === k);
    const summary = [...new Set(out.map((o) => o.kind))].map((k) => `${k}: ${by(k).length} (${[...new Set(by(k).map((o) => `${o.status}${o.code ? ` ${o.code}` : ''}`))].join(', ')}), slowest ${Math.max(...by(k).map((o) => o.ms))} ms`);
    console.log(`pool ${label}: ${out.length} requests; ${summary.join('; ')}`);
    const bad = out.filter((o) => ![200, 201, 202, 409].includes(o.status) || o.ms > LIMIT_MS);
    expect(bad).toEqual([]);
    for (const o of out.filter((x) => x.status === 409)) expect(['busy', 'changed_since', 'not_proposed']).toContain(o.code);
    for (const o of out.filter((x) => x.kind.startsWith('staff'))) expect(o.status).toBe(200);
  };

  it('30 chat edits and 30 taps on 30 different tasks, 15 chat comments, and staff edits and reads alongside', async () => {
    const editTasks = await Promise.all(Array.from({ length: 30 }, (_, i) => newTask(`edit ${i}`)));
    const tapTasks: string[] = [];
    for (let i = 0; i < 30; i++) tapTasks.push(await newTask(`tap ${i}`));
    const proposals: string[] = [];
    for (const t of tapTasks) proposals.push(await propose(t));
    const staffTasks = await Promise.all(Array.from({ length: 10 }, (_, i) => newTask(`staff ${i}`)));
    const out = await Promise.all([
      ...editTasks.map((t, i) => chatEdit(t, `chat edit ${i}`)),
      ...proposals.map((p) => tap(p)),
      ...editTasks.slice(0, 15).map((t, i) => chatComment(t, `chat note ${i}`)),
      ...staffTasks.map((t, i) => staffEdit(t, `staff edit ${i}`)),
      ...staffTasks.map((t) => staffGet(t)),
    ]);
    judge('different tasks', out);
    expect(out.filter((o) => o.kind === 'tap' && o.status === 200).length).toBeGreaterThan(0);
    expect(out.filter((o) => o.kind === 'chat_patch' && o.status === 200).length).toBeGreaterThan(0);
    for (const t of tapTasks) expect(['not_started']).toContain((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status);
  }, 120_000);

  it('30 at once on ONE task: 10 taps of 10 proposals, 10 chat edits, 10 chat comments, with staff reads alongside', async () => {
    const t = await newTask('shared');
    const proposals: string[] = [];
    for (let i = 0; i < 10; i++) proposals.push(await propose(t));
    const staffTask = await newTask('staff shared');
    const out = await Promise.all([
      ...proposals.map((p) => tap(p)),
      ...Array.from({ length: 10 }, (_, i) => chatEdit(t, `shared edit ${i}`)),
      ...Array.from({ length: 10 }, (_, i) => chatComment(t, `shared note ${i}`)),
      ...Array.from({ length: 10 }, () => staffGet(staffTask)),
    ]);
    judge('one task', out);
    // At most one tap of the ten can win, and only if no chat write landed before it.
    expect(out.filter((o) => o.kind === 'tap' && o.status === 200).length).toBeLessThanOrEqual(1);
  }, 120_000);

  it('X4: a tap that dies half way (its write held up until its transaction gives out) leaves the proposal waiting, unclaimed, and tappable', async () => {
    const t = await newTask('stuck');
    const p = await propose(t);
    // Another connection holds the task row, so the tap's update waits until its lock timeout and the transaction rolls back.
    const other = new PrismaClient({ datasourceUrl: URL.replace(/([?&])connection_limit=3/, '$1connection_limit=2') });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = other.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${t}::uuid FOR UPDATE`;
      locked();
      await held;
    }, { timeout: 60_000 });
    await isLocked;
    const first = await timed('tap', async () => ({ status: (await releaseAction(p, ownerId, new Date(), prisma)).status === 'released' ? 200 : 500, code: null }));
    release();
    await holder;
    await other.$disconnect();
    console.log(`pool stuck tap: first tap ${first.status} ${first.code ?? ''} in ${first.ms} ms (${first.error ?? ''})`);
    expect(first.status).toBe(409);
    expect(first.code).toBe('busy');
    expect(first.error).toBe(BUSY_TEXT);
    const row = await prisma.bastChatAction.findUniqueOrThrow({ where: { id: p } });
    expect(row.status).toBe('proposed');
    expect(row.resolved_at).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).assignee_id).toBe(ownerId);
    // Nothing is stuck: the same proposal taps now.
    expect((await releaseAction(p, ownerId, new Date(), prisma)).status).toBe('released');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).assignee_id).toBe(BAST_USER_ID);
  }, 120_000);
});
