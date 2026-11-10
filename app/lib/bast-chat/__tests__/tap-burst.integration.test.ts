// @vitest-environment node
/**
 * VERIFY-5 Z1 against a real Postgres: one conversation, everything at once. 60 chat edits, 60 owner taps and 60 chat
 * comments in ONE conversation, with staff edits and reads alongside: no 500, no 401, no deadlock (Postgres's own
 * counter for this database), the slowest answer under 10 seconds. Before the fix (the conversation row locked FOR
 * UPDATE), taps of one conversation deadlocked on it.
 *
 * Runs on any local scratch database, at whatever pool the URL sets; the gate runs it on the default pool and on
 * connection_limit=3:
 *   DATABASE_URL='postgresql://...@localhost:55433/<..scratch..>[?connection_limit=3]' npx vitest run lib/bast-chat/__tests__/tap-burst.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NextRequest } from 'next/server';

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

const URL = process.env.DATABASE_URL ?? '';
const RUN = /scratch/i.test(URL) && /localhost|127\.0\.0\.1/.test(URL);
const CAP = 1_000_000;
const LIMIT_MS = 10_000;
const K = Number(process.env.BAST_CHAT_BURST ?? 60);

type Outcome = { kind: string; status: number; code: string | null; ms: number; error?: string };

describe.skipIf(!RUN)(`one conversation, ${K} chat edits, ${K} taps and ${K} comments at once (real database)`, () => {
  const als = new AsyncLocalStorage<unknown>();
  who.als = als;
  const tag = `burst-${Date.now()}`;
  const ownerId = randomUUID();
  let conversationId = '';
  const chatAuth = { userId: BAST_USER_ID, email: 'bast@example.test', role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true };
  const staffAuth = () => ({ userId: ownerId, email: `owner-${tag}@example.test`, role: 'admin', via: 'session' });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner Burst', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast Burst', role: 'pm' } });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, update: { owner_user_id: ownerId, enabled: true, daily_write_cap: CAP }, create: { id: 1, owner_user_id: ownerId, enabled: true, daily_write_cap: CAP } });
    conversationId = (await prisma.bastChatConversation.create({ data: { owner_id: ownerId, status: 'running' } })).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const newTask = async (title: string) => (await prisma.task.create({ data: { title: `${title} ${tag}`, status: 'not_started', assignee_id: ownerId } })).id;
  const timed = async (kind: string, fn: () => Promise<{ status: number; code: string | null }>): Promise<Outcome> => {
    const t0 = Date.now();
    try {
      return { kind, ...(await fn()), ms: Date.now() - t0 };
    } catch (e) {
      const o = e as { statusCode?: number; code?: string; message?: string };
      return { kind, status: o.statusCode ?? 500, code: o.code ?? null, ms: Date.now() - t0, error: o.message };
    }
  };
  const http = async (res: Response) => ({ status: res.status, code: res.status >= 400 ? (((await res.json()) as { code?: string }).code ?? null) : null });
  const deadlocks = async () => Number(((await prisma.$queryRaw`SELECT deadlocks::bigint AS n FROM pg_stat_database WHERE datname = current_database()`) as { n: bigint }[])[0].n);

  it('no 500, no 401, no deadlock, nothing over 10 seconds', async () => {
    const edits = await Promise.all(Array.from({ length: K }, (_, i) => newTask(`edit ${i}`)));
    const notes = await Promise.all(Array.from({ length: K }, (_, i) => newTask(`note ${i}`)));
    const staff = await Promise.all(Array.from({ length: 20 }, (_, i) => newTask(`staff ${i}`)));
    const proposals: string[] = [];
    for (let i = 0; i < K; i++) {
      const t = await newTask(`tap ${i}`);
      const { input, prepared } = await prepareOperation('task', { task_id: t, body: { assignee_id: BAST_USER_ID } }, { ownerId, db: prisma });
      proposals.push((await storeProposal({ ownerId, conversationId, tool: 'change_task', op: 'task', input, prepared, reserve: false, db: prisma })).id);
    }
    const before = await deadlocks();
    const patchAs = (auth: unknown, t: string, body: Record<string, unknown>, chat: boolean) =>
      als.run(auth, async () => {
        const headers: Record<string, string> = { 'content-type': 'application/json', ...(chat ? { 'X-Bast-Chat-Conversation': conversationId } : {}) };
        const req = new NextRequest(`http://localhost/api/tasks/${t}`, { method: 'PATCH', body: JSON.stringify(body), headers });
        return http(await patchRoute(req, { params: Promise.resolve({ id: t }) }));
      });
    const readAs = (t: string) => als.run(staffAuth(), async () => http(await getRoute(new NextRequest(`http://localhost/api/tasks/${t}`), { params: Promise.resolve({ id: t }) })));
    const tapOne = async (p: string) => ({ status: (await releaseAction(p, ownerId, new Date(), prisma)).status === 'released' ? 200 : 500, code: null });
    const noteOne = async (t: string, i: number) => {
      const r = await applyChatOp({ ownerId, conversationId, op: getRunnableOp('comment')!, rawInput: { task_id: t, text: `burst note ${i}` }, dailyWriteCap: CAP, now: new Date(), db: prisma });
      return { status: r.kind === 'applied' ? 200 : 202, code: null };
    };
    const out = await Promise.all([
      ...edits.map((t, i) => timed('chat_edit', () => patchAs(chatAuth, t, { title: `burst edit ${i}` }, true))),
      ...proposals.map((p) => timed('tap', () => tapOne(p))),
      ...notes.map((t, i) => timed('chat_comment', () => noteOne(t, i))),
      ...staff.map((t, i) => timed('staff_edit', () => patchAs(staffAuth(), t, { title: `staff ${i}` }, false))),
      ...staff.map((t) => timed('staff_read', () => readAs(t))),
    ]);
    const after = await deadlocks();
    const kinds = [...new Set(out.map((o) => o.kind))];
    console.log(`burst (${/connection_limit=(\d+)/.exec(URL)?.[1] ?? 'default'} pool): ${out.length} requests, deadlocks ${after - before}; ${kinds
      .map((k) => {
        const r = out.filter((o) => o.kind === k);
        return `${k} ${r.length} (${[...new Set(r.map((o) => `${o.status}${o.code ? ` ${o.code}` : ''}`))].join(', ')}) slowest ${Math.max(...r.map((o) => o.ms))} ms`;
      })
      .join('; ')}`);
    expect(out.filter((o) => o.status !== 200)).toEqual([]);
    expect(Math.max(...out.map((o) => o.ms))).toBeLessThan(LIMIT_MS);
    expect(after - before).toBe(0);
    // Every tap landed and every seq of the conversation is unique and gapless.
    const seqs = (await prisma.bastChatEvent.findMany({ where: { conversation_id: conversationId }, select: { seq: true }, orderBy: { seq: 'asc' } })).map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs[seqs.length - 1] - seqs[0] + 1).toBe(seqs.length);
  }, 300_000);
});
