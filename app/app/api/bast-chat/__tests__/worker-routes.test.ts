// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { ACTION, CONV, NOT_WORKERS, OWNER_ID, SETTINGS, WORKER, ctx, req } from './harness';

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, conv: null as unknown }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const db: Record<string, unknown> = {
    bastChatConversation: { findUnique: vi.fn(async () => h.conv) },
    user: { findUnique: vi.fn(async () => ({ is_active: true, role: 'admin' })) },
    bastChatAction: { create: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222', undo_until: new Date('2026-11-11T00:00:00Z') })) },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  // The commit check of a locked write (lib/db/scope.ts assertAlive).
  db.$queryRaw = async () => [{ alive: 1 }];
  return { prisma: db };
});
vi.mock('@/lib/bast-chat/usage', async (orig) => ({ ...(await orig<typeof import('@/lib/bast-chat/usage')>()), reserveWrite: vi.fn(async () => undefined) }));
vi.mock('@/lib/bast-chat/ops', () => {
  const op = {
    name: 'project',
    tool: 'change_project',
    target_type: 'project',
    run: vi.fn(async () => ({ target_id: '33333333-3333-4333-8333-333333333333', before: {}, after: {}, summary: 'Moved the VCDP project to review.', result: { status: 'review' }, undoable: true })),
  };
  return { getRunnableOp: (n: string) => (n === 'project' ? op : null), OP_NAMES: ['project'] };
});
vi.mock('@/lib/bast-chat/settings', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/settings')>()),
  getSettings: vi.fn(async () => h.settings),
}));
vi.mock('@/lib/bast-chat/inbox', () => ({
  buildInbox: vi.fn(async () => ({ messages: [], stops: [], settings: { enabled: true } })),
  expireStaleMessages: vi.fn(),
}));
vi.mock('@/lib/bast-chat/heartbeat', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/heartbeat')>()),
  recordHeartbeat: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/bast-chat/events', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/events')>()),
  recentText: vi.fn(async () => [{ seq: 1, role: 'mike', text: 'hello' }]),
  patchWorkerConversation: vi.fn(async () => undefined),
  appendWorkerEvents: vi.fn(async () => ({ last_seq: 5, first_seq: 4, acked: 1 })),
}));
vi.mock('@/lib/bast-chat/actions', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/actions')>()),
  recordAction: vi.fn(async () => ({ id: ACTION, status: 'applied', undo_until: new Date('2026-11-11T00:00:00Z') })),
  prepareOperation: vi.fn(async (_n: string, input: unknown) => ({ input, prepared: { reach: { needs_tap: false }, expect: {}, copy: { clause: 'x' } } })),
}));
vi.mock('@/lib/bast-chat/route-helpers', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/route-helpers')>()),
  ownerToday: vi.fn(async () => ({
    date: '2026-11-10', arc_name: 'Arc', why: 'w', size_line: 's', quick: [], steps: [],
    group_key: 'own', swap: [], lighter: null, pinned: null, emergencies: [], parked: [],
    counts: { needs_you_now: 0, working_on: 0, leads: 0, mail: 0, next: 0, handled: 0, everything_else: 0 },
  })),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { recentText, appendWorkerEvents } from '@/lib/bast-chat/events';
import { recordAction } from '@/lib/bast-chat/actions';
import { ownerToday } from '@/lib/bast-chat/route-helpers';
import * as inbox from '../worker/inbox/route';
import * as heartbeat from '../worker/heartbeat/route';
import * as conv from '../worker/conversations/[id]/route';
import * as events from '../worker/conversations/[id]/events/route';
import * as actions from '../worker/actions/route';
import * as today from '../worker/today/route';
import * as ops from '../worker/ops/route';

type Handler = (r: never, c: never) => Promise<Response>;
interface Row { name: string; lane: string; h: Handler; method: string; path: string; body?: unknown; c: unknown; keys: string[]; owned?: boolean }
const P = '/api/bast-chat/worker';
const HB = { version: '1', sdk_version: '1', paused: false, live_conversations: [], isolation: null, auth_state: 'token' };
const ACT = { conversation_id: CONV, tool: 'propose_handoff', target_id: ACTION, status: 'proposed', proposed_assignee_id: OWNER_ID, summary: 'Proposed' };
const OPS_BODY = { conversation_id: CONV, op: 'project', input: { project_id: '44444444-4444-4444-8444-444444444444', status: 'review' } };
const rows: Row[] = [
  { name: 'GET inbox', lane: 'GET /api/bast-chat/worker/inbox', h: inbox.GET as Handler, method: 'GET', path: `${P}/inbox`, c: {}, keys: ['messages', 'settings', 'stops'] },
  { name: 'POST heartbeat', lane: 'POST /api/bast-chat/worker/heartbeat', h: heartbeat.POST as Handler, method: 'POST', path: `${P}/heartbeat`, body: HB, c: {}, keys: ['ok'] },
  { name: 'GET conversation', lane: 'GET /api/bast-chat/worker/conversations/:id', h: conv.GET as Handler, method: 'GET', path: `${P}/conversations/${CONV}?history=20`, c: ctx({ id: CONV }), keys: ['messages'], owned: true },
  { name: 'PATCH conversation', lane: 'PATCH /api/bast-chat/worker/conversations/:id', h: conv.PATCH as Handler, method: 'PATCH', path: `${P}/conversations/${CONV}`, body: { status: 'running', live_text: 'x' }, c: ctx({ id: CONV }), keys: ['ok'], owned: true },
  { name: 'POST events', lane: 'POST /api/bast-chat/worker/conversations/:id/events', h: events.POST as Handler, method: 'POST', path: `${P}/conversations/${CONV}/events`, body: { acks: [1], events: [{ role: 'assistant', kind: 'text', payload: { text: 'hi' } }] }, c: ctx({ id: CONV }), keys: ['acked', 'first_seq', 'last_seq'], owned: true },
  { name: 'POST actions', lane: 'POST /api/bast-chat/worker/actions', h: actions.POST as Handler, method: 'POST', path: `${P}/actions`, body: ACT, c: {}, keys: ['id', 'status', 'undo_until'] },
  { name: 'GET today', lane: 'GET /api/bast-chat/worker/today', h: today.GET as Handler, method: 'GET', path: `${P}/today`, c: {}, keys: ['arc_name', 'counts', 'date', 'emergencies', 'group_key', 'lighter', 'parked', 'pinned', 'quick', 'size_line', 'steps', 'swap', 'why'] },
  { name: 'POST ops', lane: 'POST /api/bast-chat/worker/ops', h: ops.POST as Handler, method: 'POST', path: `${P}/ops`, body: OPS_BODY, c: {}, keys: ['action_id', 'can_undo', 'line', 'result', 'status', 'undo_until'] },
];
const call = (r: Row, body: unknown = r.body) => r.h(req(r.method, r.path, body) as never, r.c as never);

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = { ...SETTINGS };
  h.conv = { id: CONV, owner_id: OWNER_ID, status: 'idle' };
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
});

describe('the eight worker routes', () => {
  it('are exactly the lane list (method and path)', () => {
    // The keeper route has its own test file (worker/home-keeper/__tests__/route.test.ts and worker/home-keeper/summaries/__tests__/route.test.ts); the owed route has its own too (worker/owed/__tests__/route.test.ts, and worker/owed/bookings/__tests__/route.test.ts for 4d), and so has home-watch with its ack and its scan result (worker/home-watch/__tests__/route.test.ts, worker/home-watch/ack/__tests__/route.test.ts and worker/home-watch/scan/__tests__/route.test.ts), and so has the session read (worker/session-asks/[id]/__tests__/route.test.ts), and so has the sends listing (worker/sends/__tests__/route.test.ts), and so has the sent-mail reconciler (worker/reconcile/__tests__/route.test.ts and worker/reconcile/candidates/__tests__/route.test.ts), and so has the looks-finished sweep (worker/finished/__tests__/route.test.ts), and so has the decision replay (worker/decision-replay/__tests__/route.test.ts).
    const lane = LANE_ROUTES['bast-chat'].filter((r) => r.pattern.startsWith('/api/bast-chat/worker/') && !r.pattern.startsWith('/api/bast-chat/worker/home-keeper') && !r.pattern.startsWith('/api/bast-chat/worker/owed') && !r.pattern.startsWith('/api/bast-chat/worker/home-watch') && !r.pattern.startsWith('/api/bast-chat/worker/session-asks') && !r.pattern.startsWith('/api/bast-chat/worker/sends') && !r.pattern.startsWith('/api/bast-chat/worker/reconcile') && !r.pattern.startsWith('/api/bast-chat/worker/finished') && !r.pattern.startsWith('/api/bast-chat/worker/decision-replay')).map((r) => `${r.method} ${r.pattern}`).sort();
    expect(rows.map((r) => r.lane).sort()).toEqual(lane);
    expect(lane).toHaveLength(8);
  });

  for (const r of rows) {
    describe(r.name, () => {
      it('401 signed out', async () => {
        vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
        const res = await call(r);
        expect(res.status).toBe(401);
        expect(Object.keys(await res.json())).toEqual(['error']);
      });
      for (const [who, auth] of NOT_WORKERS) {
        it(`403 for ${who}`, async () => {
          vi.mocked(requireAuth).mockResolvedValue(auth);
          const res = await call(r);
          expect(res.status).toBe(403);
          expect(Object.keys(await res.json())).toEqual(['error']);
        });
      }
      if (r.owned) {
        it('404 for a conversation that belongs to nobody', async () => {
          h.conv = null;
          expect((await call(r)).status).toBe(404);
        });
        it('404 for the wrong owner\'s conversation', async () => {
          h.conv = { id: CONV, owner_id: 'someone-else', status: 'idle' };
          expect((await call(r)).status).toBe(404);
        });
        it('404 for an id that is not a uuid', async () => {
          expect((await call({ ...r, c: ctx({ id: 'nope' }) })).status).toBe(404);
        });
      }
      if (r.body !== undefined) {
        it('400 on an extra field', async () => {
          const res = await call(r, { ...(r.body as object), extra: 1 });
          expect(res.status).toBe(400);
          expect(Object.keys(await res.json())).toEqual(['error']);
        });
        it('413 on a body over the cap', async () => {
          const res = await call(r, JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
          expect(res.status).toBe(413);
        });
        it('400 on a body that is not JSON', async () => {
          expect((await call(r, '{nope')).status).toBe(400);
        });
      }
      it('happy path: exact key set, no-store', async () => {
        // The ops route needs the conversation to be running (a tool call happens inside a turn).
        if (r.name === 'POST ops') h.conv = { id: CONV, owner_id: OWNER_ID, status: 'running' };
        const res = await call(r);
        expect([200, 201]).toContain(res.status);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(Object.keys(await res.json()).sort()).toEqual(r.keys);
      });
    });
  }
});

describe('worker route details', () => {
  it('conversation GET seeds history as {messages:[{seq, role, text}]} from recentText', async () => {
    const b = await (await conv.GET(req('GET', `${P}/conversations/${CONV}?history=5`) as never, ctx({ id: CONV }))).json();
    expect(b).toEqual({ messages: [{ seq: 1, role: 'mike', text: 'hello' }] });
    expect(recentText).toHaveBeenCalledWith(CONV, 5, expect.anything());
  });
  it('conversation GET: a bad history is 400', async () => {
    expect((await conv.GET(req('GET', `${P}/conversations/${CONV}?history=abc`) as never, ctx({ id: CONV }))).status).toBe(400);
  });
  it('PATCH refuses status closed and a model that is not allowed is left to the logic (status closed is 400 here)', async () => {
    const res = await conv.PATCH(req('PATCH', `${P}/conversations/${CONV}`, { status: 'closed' }) as never, ctx({ id: CONV }));
    expect(res.status).toBe(400);
  });
  it('events: an event with a role of mike is 400 (the worker cannot write Mike\'s side)', async () => {
    const res = await events.POST(req('POST', `${P}/conversations/${CONV}/events`, { events: [{ role: 'mike', kind: 'text', payload: {} }] }) as never, ctx({ id: CONV }));
    expect(res.status).toBe(400);
    expect(appendWorkerEvents).not.toHaveBeenCalled();
  });
  it('actions: records for the owner from the settings, 201, ISO undo_until', async () => {
    const res = await actions.POST(req('POST', `${P}/actions`, ACT) as never);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ACTION, status: 'applied', undo_until: '2026-11-11T00:00:00.000Z' });
    expect(recordAction).toHaveBeenCalledWith(expect.objectContaining(ACT), OWNER_ID);
  });
  it('actions: applied, filed and failed records from the worker are refused with 400 and a plain sentence', async () => {
    vi.mocked(recordAction).mockImplementationOnce(async (raw, owner, now, db) => (await vi.importActual<typeof import('@/lib/bast-chat/actions')>('@/lib/bast-chat/actions')).recordAction(raw, owner, now, db));
    for (const body of [
      { conversation_id: CONV, tool: 'update_task', target_id: ACTION, status: 'applied', before: { status: 'done' }, after: { status: 'blocked' } },
      { conversation_id: CONV, tool: 'create_task', target_id: ACTION, status: 'applied' },
      { conversation_id: CONV, tool: 'update_task', target_id: ACTION, status: 'failed', error: 'x' },
    ]) {
      vi.mocked(recordAction).mockImplementationOnce(async (raw, owner, now, db) => (await vi.importActual<typeof import('@/lib/bast-chat/actions')>('@/lib/bast-chat/actions')).recordAction(raw, owner, now, db));
      const res = await actions.POST(req('POST', `${P}/actions`, body) as never);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('The chat can only propose a handoff. Citadel records every change itself.');
    }
  });
  it('actions: the status can only be applied, proposed or failed (never released)', async () => {
    const res = await actions.POST(req('POST', `${P}/actions`, { ...ACT, status: 'released' }) as never);
    expect(res.status).toBe(400);
  });
  it('without an owner every owner-bound worker route is 404', async () => {
    h.settings = { ...SETTINGS, owner_user_id: null };
    expect((await today.GET()).status).toBe(404);
    expect((await actions.POST(req('POST', `${P}/actions`, ACT) as never)).status).toBe(404);
  });
  it('today asks for the owner from the settings and takes no user id', async () => {
    await today.GET();
    expect(ownerToday).toHaveBeenCalledWith(OWNER_ID, expect.any(Date), expect.anything());
  });
});
