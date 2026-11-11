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

const who = vi.hoisted(() => ({ als: null as null | { getStore: () => unknown }, lookup: null as null | ((id: string) => Promise<unknown>) }));
// The real requireAuth reads the user (or the key) from the database and answers 401 "Invalid token" when that read
// fails, which is how a starved pool showed up in VERIFY-6 A1. The stand-in does the same read.
vi.mock('@/lib/auth/middleware', async (orig) => {
  const { AuthError } = await import('@/lib/api/errors');
  return {
    ...(await orig<typeof import('@/lib/auth/middleware')>()),
    requireAuth: vi.fn(async () => {
      const s = who.als!.getStore() as { userId: string };
      if (who.lookup) {
        try {
          await who.lookup(s.userId);
        } catch {
          throw new AuthError('Invalid token', 401);
        }
      }
      return s;
    }),
  };
});

import { prisma } from '@/lib/db/prisma';
import { PrismaClient } from '@prisma/client';
import { PATCH as patchRoute, GET as getRoute } from '@/app/api/tasks/[id]/route';
import { POST as createRoute } from '@/app/api/tasks/route';
import { BAST_USER_ID, MIKE_USER_ID } from '../gate-mirror';
import { declineAction, prepareOperation, releaseAction, storeProposal, undoAction, undoSince } from '../actions';
import { appendMikeMessage, appendWorkerEvents, patchWorkerConversation } from '../events';
import { getSettings } from '../settings';
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

/**
 * VERIFY-6 A1: every kind of chat-lane request at once in ONE conversation (the owner's messages, the daemon's events
 * and cost, its conversation PATCH, taps, declines, Undo, undo-since, every op, chat PATCH, chat create, proposal
 * store), with a chat comment op on each tapped task (the cycle VERIFY-6 found through the day's usage row), and staff
 * edits and reads alongside. Then the same with one task row held for 20 seconds by an outside transaction (its own
 * connection, outside the app's pool). Gates: 0 deadlocks (pg_stat_database), no 500, no 401, the owner's message never
 * fails because a task is locked, the slowest request not on the held task under 10 seconds. The gate runs it on the
 * default pool and on connection_limit=3.
 */
describe.skipIf(!RUN)('every chat-lane request at once in one conversation, and one task row held 20 s (real database)', () => {
  const als = new AsyncLocalStorage<unknown>();
  const tag = `mix-${Date.now()}`;
  const ownerId = randomUUID();
  const M = Number(process.env.BAST_CHAT_MIX ?? 20);
  const HOLD_MS = Number(process.env.BAST_CHAT_HOLD_MS ?? 20_000);
  let conversationId = '';
  let clientId = '';
  const chatAuth = { userId: BAST_USER_ID, email: 'bast@example.test', role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true };
  const staffAuth = () => ({ userId: ownerId, email: `owner-${tag}@example.test`, role: 'admin', via: 'session' });

  beforeAll(async () => {
    who.als = als;
    who.lookup = (id: string) => prisma.user.findUnique({ where: { id }, select: { id: true } });
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner Mix', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast Mix', role: 'pm' } });
    await prisma.bastChatSettings.upsert({
      where: { id: 1 },
      update: { owner_user_id: ownerId, enabled: true, daily_write_cap: CAP, daily_turn_cap: CAP, daily_cost_cap_usd: CAP },
      create: { id: 1, owner_user_id: ownerId, enabled: true, daily_write_cap: CAP, daily_turn_cap: CAP, daily_cost_cap_usd: CAP },
    });
    conversationId = (await prisma.bastChatConversation.create({ data: { owner_id: ownerId, status: 'running' } })).id;
    clientId = (await prisma.client.create({ data: { name: `Mix client ${tag}`, type: 'direct', status: 'active' } })).id;
    await prisma.userPreference.upsert({ where: { user_id: ownerId }, update: { home_view: 'home' }, create: { user_id: ownerId, home_view: 'home' } });
    // A task Bast files is reviewed by Mike (the create route's default reviewer).
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: {}, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike Mix', role: 'admin' } });
  });
  afterAll(async () => {
    who.lookup = null;
    await prisma.$disconnect();
  });

  type Out = { kind: string; status: number; code: string | null; ms: number; held: boolean; error?: string };
  const deadlocks = async () => Number(((await prisma.$queryRaw`SELECT deadlocks::bigint AS n FROM pg_stat_database WHERE datname = current_database()`) as { n: bigint }[])[0].n);
  const newTask = async (title: string, o: Record<string, unknown> = {}) => (await prisma.task.create({ data: { title: `${title} ${tag}`, status: 'not_started', assignee_id: ownerId, ...o } })).id;
  const http = async (res: Response) => {
    if (res.status < 400) return { status: res.status, code: null };
    const j = (await res.json()) as { code?: string; error?: string };
    if (res.status >= 500) console.log('500 body', JSON.stringify(j));
    return { status: res.status, code: j.code ?? null };
  };
  /** One request as the real routes see it: the auth read first (401 when it fails), then the work. */
  const timed = (kind: string, held: boolean, auth: unknown, fn: () => Promise<{ status: number; code: string | null }>) =>
    als.run(auth, async (): Promise<Out> => {
      const t0 = Date.now();
      try {
        try {
          await who.lookup!((auth as { userId: string }).userId);
        } catch {
          return { kind, status: 401, code: 'auth', ms: Date.now() - t0, held };
        }
        return { kind, held, ...(await fn()), ms: Date.now() - t0 };
      } catch (e) {
        const o = e as { statusCode?: number; code?: string; message?: string };
        return { kind, held, status: o.statusCode ?? 500, code: o.code ?? null, ms: Date.now() - t0, error: o.message };
      }
    });
  const patchAs = (t: string, body: Record<string, unknown>, chat: boolean) => async () => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(chat ? { 'X-Bast-Chat-Conversation': conversationId } : {}) };
    return http(await patchRoute(new NextRequest(`http://localhost/api/tasks/${t}`, { method: 'PATCH', body: JSON.stringify(body), headers }), { params: Promise.resolve({ id: t }) }));
  };
  const readAs = (t: string) => async () => http(await getRoute(new NextRequest(`http://localhost/api/tasks/${t}`), { params: Promise.resolve({ id: t }) }));
  const CREATE = ['P', 'O', 'S', 'T'].join('');
  const createAs = (title: string) => async () =>
    http(
      await createRoute(
        new NextRequest('http://localhost/api/tasks', {
          method: CREATE,
          body: JSON.stringify({ title, assignee_id: ownerId, tags: ['from-chat'] }),
          headers: { 'content-type': 'application/json', 'X-Bast-Chat-Conversation': conversationId },
        }),
      ),
    );
  const op = (name: string, input: Record<string, unknown>) => async () => {
    const r = await applyChatOp({ ownerId, conversationId, op: getRunnableOp(name)!, rawInput: input, dailyWriteCap: CAP, now: new Date(), db: prisma });
    return { status: r.kind === 'applied' ? 200 : 202, code: null };
  };
  const ok200 = (fn: () => Promise<unknown>) => async () => {
    await fn();
    return { status: 200, code: null };
  };
  const hand = async (t: string) => {
    const { input, prepared } = await prepareOperation('task', { task_id: t, body: { assignee_id: BAST_USER_ID } }, { ownerId, db: prisma });
    return (await storeProposal({ ownerId, conversationId, tool: 'change_task', op: 'task', input, prepared, reserve: false, db: prisma })).id;
  };
  const chatEditRecord = async (t: string, title: string) => {
    const r = await als.run(chatAuth, () =>
      patchRoute(
        new NextRequest(`http://localhost/api/tasks/${t}`, { method: 'PATCH', body: JSON.stringify({ title }), headers: { 'content-type': 'application/json', 'X-Bast-Chat-Conversation': conversationId } }),
        { params: Promise.resolve({ id: t }) },
      ),
    );
    const id = r.headers.get('X-Bast-Chat-Action');
    if (!id) throw new Error(`no record: ${r.status} ${JSON.stringify(await r.json())}`);
    return id;
  };

  /** Everything the chat lane can do, about `m` of each, on fresh rows. */
  async function fixtures(m: number) {
    const tapTasks = await Promise.all(Array.from({ length: m }, (_, i) => newTask(`tap ${i}`)));
    const taps: string[] = [];
    for (const t of tapTasks) taps.push(await hand(t));
    const declineTasks = await Promise.all(Array.from({ length: Math.ceil(m / 4) }, (_, i) => newTask(`decline ${i}`)));
    const declines: string[] = [];
    for (const t of declineTasks) declines.push(await hand(t));
    const undoTasks = await Promise.all(Array.from({ length: Math.ceil(m / 2) }, (_, i) => newTask(`undo ${i}`)));
    const records: string[] = [];
    for (const [i, t] of undoTasks.entries()) records.push(await chatEditRecord(t, `undo me ${i} ${tag}`));
    const sinceTasks = await Promise.all(Array.from({ length: 3 }, (_, i) => newTask(`since ${i}`)));
    const since: string[] = [];
    for (const [i, t] of sinceTasks.entries()) since.push(await chatEditRecord(t, `renamed since ${i} ${tag}`));
    const edits = await Promise.all(Array.from({ length: m }, (_, i) => newTask(`edit ${i}`)));
    const staff = await Promise.all(Array.from({ length: Math.ceil(m / 2) }, (_, i) => newTask(`staff ${i}`)));
    const projects = await Promise.all(
      Array.from({ length: 4 }, (_, i) => prisma.project.create({ data: { name: `Mix project ${i} ${tag}`, client_id: clientId, status: 'in_progress' } }).then((p) => p.id)),
    );
    const waits: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = (await prisma.$queryRaw`INSERT INTO waits (id, kind, template_key, step, title, duration_value, due_at, terminal_action, owner_user_id, updated_at) VALUES (gen_random_uuid(), 'handoff', 'handoff.generic', 1, ${`Mix wait ${i} ${tag}`}, 2, now() + interval '2 days', 'escalate', ${ownerId}::uuid, now()) RETURNING id::text AS id`) as { id: string }[];
      waits.push(r[0].id);
    }
    const asks: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = (await prisma.$queryRaw`INSERT INTO email_asks (id, updated_at, message_id, account, from_email, subject, deep_link, received_at, thread_id) VALUES (gen_random_uuid(), now(), ${`mix-${randomUUID()}`}, 'mike', 'c@example.test', ${`Mix ask ${i}`}, 'https://mail.example.test/z', now(), ${`thr-mix-${randomUUID()}`}) RETURNING id::text AS id`) as { id: string }[];
      asks.push(r[0].id);
    }
    const homeTasks = await Promise.all(Array.from({ length: 4 }, (_, i) => newTask(`home ${i}`)));
    const storeTasks = await Promise.all(Array.from({ length: Math.ceil(m / 4) }, (_, i) => newTask(`store ${i}`)));
    return { tapTasks, taps, declines, records, since, edits, staff, projects, waits, asks, homeTasks, storeTasks };
  }

  function jobs(f: Awaited<ReturnType<typeof fixtures>>, m: number, settings: Awaited<ReturnType<typeof getSettings>>, heldTask: string | null): Promise<Out>[] {
    const owner = staffAuth();
    const out: Promise<Out>[] = [];
    const isHeld = (t: string) => t === heldTask;
    f.taps.forEach((p, i) => out.push(timed('tap', isHeld(f.tapTasks[i]), owner, ok200(() => releaseAction(p, ownerId, new Date(), prisma)))));
    // The cycle VERIFY-6 found: a chat comment op on each task being tapped, at the same time.
    f.tapTasks.forEach((t, i) => out.push(timed('op_comment', isHeld(t), chatAuth, op('comment', { task_id: t, text: `mix note ${i}` }))));
    f.declines.forEach((p) => out.push(timed('decline', false, owner, ok200(() => declineAction(p, ownerId, new Date(), prisma)))));
    f.records.forEach((r) => out.push(timed('undo', false, owner, ok200(() => undoAction(r, ownerId, new Date(), prisma)))));
    out.push(timed('undo_since', false, owner, ok200(() => undoSince(ownerId, { from_action_id: f.since[0] }, new Date(), prisma))));
    f.edits.forEach((t, i) => out.push(timed('chat_patch', isHeld(t), chatAuth, patchAs(t, { title: `mix edit ${i} ${tag}` }, true))));
    for (let i = 0; i < Math.ceil(m / 4); i++) out.push(timed('chat_create', false, chatAuth, createAs(`mix filed ${i} ${tag}`)));
    f.storeTasks.forEach((t) =>
      out.push(
        timed('proposal_store', false, chatAuth, async () => {
          const { input, prepared } = await prepareOperation('task', { task_id: t, body: { assignee_id: BAST_USER_ID } }, { ownerId, db: prisma });
          await storeProposal({ ownerId, conversationId, tool: 'change_task', op: 'task', input, prepared, reserve: true, db: prisma });
          return { status: 202, code: null };
        }),
      ),
    );
    f.projects.forEach((p) => out.push(timed('op_project', false, chatAuth, op('project', { project_id: p, status: 'review' }))));
    f.waits.forEach((w) => out.push(timed('op_wait', false, chatAuth, op('wait', { wait_id: w, action: 'redate', due_at: new Date(Date.now() + 4 * 86400e3).toISOString() }))));
    f.asks.forEach((a) => out.push(timed('op_email_ask', false, chatAuth, op('email_ask', { ask_id: a, state: 'handled' }))));
    f.homeTasks.forEach((t) => out.push(timed('op_home', false, chatAuth, op('home', { action: 'not_now', item_key: `task:${t}` }))));
    for (let i = 0; i < m; i++) {
      out.push(timed('send', false, owner, ok200(() => appendMikeMessage({ conversationId, ownerId, text: `mix message ${i}`, context: { kind: 'none' }, clientRef: `${tag}-${heldTask ?? 'mix'}-${i}`, settings }))));
      out.push(
        timed(
          'daemon_events',
          false,
          chatAuth,
          ok200(() =>
            appendWorkerEvents(conversationId, ownerId, {
              events: [
                { role: 'assistant', kind: 'text', payload: { text: `answer ${i}` } },
                { role: 'system', kind: 'cost', payload: { turn_usd: 0.01 } },
              ],
            }),
          ),
        ),
      );
    }
    for (let i = 0; i < 4; i++) out.push(timed('daemon_patch', false, chatAuth, ok200(() => patchWorkerConversation(conversationId, { status: 'running', live_text: `thinking ${i}` }))));
    f.staff.forEach((t, i) => {
      out.push(timed('staff_edit', false, owner, patchAs(t, { title: `staff ${i} ${tag}` }, false)));
      out.push(timed('staff_read', false, owner, readAs(t)));
    });
    return out;
  }

  const summary = (label: string, out: Out[], dl: number) =>
    console.log(
      `${label} (${/connection_limit=(\d+)/.exec(URL)?.[1] ?? 'default'} pool): ${out.length} requests, deadlocks ${dl}; ${[...new Set(out.map((o) => o.kind))]
        .map((k) => {
          const r = out.filter((o) => o.kind === k);
          return `${k} ${r.length} (${[...new Set(r.map((o) => `${o.status}${o.code ? ` ${o.code}` : ''}${o.held ? ' held' : ''}`))].join(', ')}) slowest ${Math.max(...r.map((o) => o.ms))} ms`;
        })
        .join('; ')}`,
    );
  /** A truthful refusal: something changed since, was already decided, or (on the held task only) is busy. */
  const refusalOk = (o: Out) => o.status === 409 && ['changed_since', 'not_proposed', 'undo_used', 'later_change', 'undo_pending', ...(o.held ? ['busy'] : [])].includes(o.code ?? '');
  const bad = (out: Out[]) => {
    const b = out.filter((o) => o.status >= 500 || o.status === 401 || o.status === 429 || (o.status >= 400 && !refusalOk(o)));
    if (b.length) console.log('bad answers', JSON.stringify(b.slice(0, 10)));
    return b;
  };
  const gapless = async () => {
    const seqs = (await prisma.bastChatEvent.findMany({ where: { conversation_id: conversationId }, select: { seq: true }, orderBy: { seq: 'asc' } })).map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs[seqs.length - 1] - seqs[0] + 1).toBe(seqs.length);
  };

  it('every request type at once: 0 deadlocks, no 500, no 401, every send lands, nothing over 10 seconds', async () => {
    const settings = await getSettings(prisma);
    const f = await fixtures(M);
    const before = await deadlocks();
    const out = await Promise.all(jobs(f, M, settings, null));
    const dl = (await deadlocks()) - before;
    summary('mix', out, dl);
    expect(bad(out)).toEqual([]);
    expect(out.filter((o) => o.kind === 'send').every((o) => o.status === 200)).toBe(true);
    expect(Math.max(...out.map((o) => o.ms))).toBeLessThan(LIMIT_MS);
    expect(dl).toBe(0);
    await gapless();
  }, 300_000);

  it('one task row held 20 s by an outside transaction: only its own requests wait, nothing else does', async () => {
    const settings = await getSettings(prisma);
    const f = await fixtures(M);
    const held = f.tapTasks[0];
    f.edits[0] = held; // its own chat edit too, besides its tap and its comment
    const outside = new PrismaClient({ datasources: { db: { url: URL.replace(/([?&])connection_limit=\d+&?/, '$1').replace(/[?&]$/, '') } } });
    const before = await deadlocks();
    let release: () => void = () => undefined;
    const locked = new Promise<void>((r) => (release = r));
    const holding = outside.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${held}::uuid FOR UPDATE`;
        release();
        await new Promise((r) => setTimeout(r, HOLD_MS));
      },
      { timeout: HOLD_MS + 15_000, maxWait: 10_000 },
    );
    await locked;
    const extra = Array.from({ length: 4 }, (_, i) => timed('op_comment', true, chatAuth, op('comment', { task_id: held, text: `held note ${i}` })));
    const out = await Promise.all([...jobs(f, M, settings, held), ...extra]);
    await holding;
    await outside.$disconnect();
    const dl = (await deadlocks()) - before;
    summary('hold', out, dl);
    expect(bad(out)).toEqual([]);
    expect(out.filter((o) => o.kind === 'send').every((o) => o.status === 200)).toBe(true);
    expect(Math.max(...out.filter((o) => !o.held).map((o) => o.ms))).toBeLessThan(LIMIT_MS);
    expect(dl).toBe(0);
    await gapless();
  }, 300_000);
});
