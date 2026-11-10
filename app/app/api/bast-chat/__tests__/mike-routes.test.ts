// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, AuthError } from '@/lib/api/errors';
import { ACTION, CONV, OTHER_SESSION, OWNER_ID, OWNER_KEY, OWNER_SESSION, SETTINGS, ctx, req } from './harness';

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, conv: null as unknown }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ role: 'admin', is_active: true })), findMany: vi.fn(async () => []) },
    bastChatConversation: { findUnique: vi.fn(async () => h.conv) },
    bastChatEvent: { findFirst: vi.fn(async () => ({ seq: 7 })), findMany: vi.fn(async () => []) },
    bastChatAction: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/bast-chat/settings', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/settings')>()),
  getSettings: vi.fn(async () => h.settings),
  updateSettings: vi.fn(async (patch: object) => ({ ...h.settings, ...patch })),
}));
vi.mock('@/lib/bast-chat/events', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/events')>()),
  startConversation: vi.fn(async () => ({ id: CONV })),
  listConversations: vi.fn(async () => [{ id: CONV, title: 'Hi', status: 'idle', last_message_at: new Date(), created_at: new Date() }]),
  currentConversation: vi.fn(async () => ({ id: CONV, title: null, status: 'idle', last_message_at: null, created_at: new Date() })),
  appendMikeMessage: vi.fn(async () => ({ seq: 3, duplicate: false })),
  requestStop: vi.fn(async () => ({ queued: true })),
  feed: vi.fn(async () => ({
    events: [
      { seq: 1, role: 'mike', kind: 'text', payload: { text: 'hello' }, context: null, expired_at: null, delivered_at: null, created_at: new Date() },
      { seq: 2, role: 'assistant', kind: 'text', payload: { text: 'hi' }, context: null, expired_at: null, delivered_at: null, created_at: new Date() },
      { seq: 3, role: 'tool', kind: 'result', payload: { text: 'secret email body' }, context: null, expired_at: null, delivered_at: null, created_at: new Date() },
    ],
    last_seq: 3,
    has_more: false,
  })),
}));
vi.mock('@/lib/bast-chat/actions', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/actions')>()),
  undoAction: vi.fn(async () => ({ id: ACTION, status: 'undone' })),
  releaseAction: vi.fn(async () => ({ id: ACTION, status: 'released' })),
  declineAction: vi.fn(async () => ({ id: ACTION, status: 'declined' })),
  listActions: vi.fn(async () => [
    { id: ACTION, conversation_id: CONV, event_seq: 2, tool: 'propose_handoff', target_id: CONV, summary: 'Hand it over', status: 'proposed', can_undo: false, undo_until: null, proposed_assignee_id: OWNER_ID, created_at: new Date() },
  ]),
}));
vi.mock('@/lib/bast-chat/heartbeat', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/heartbeat')>()),
  workerStatus: vi.fn(async () => ({ online: true, paused: false, pause_reason: null, auth_state: 'token', isolation_ok: true, live_conversations: 0, last_heartbeat_at: new Date() })),
}));
vi.mock('@/lib/bast-chat/usage', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/usage')>()),
  getUsage: vi.fn(async () => ({ turns: 1, writes: 0, cost_usd: 0.5 })),
}));
vi.mock('@/lib/bast-chat/card-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/card-context')>()),
  resolveCardContext: vi.fn(async () => ({ kind: 'none' })),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { appendMikeMessage } from '@/lib/bast-chat/events';
import { releaseAction } from '@/lib/bast-chat/actions';
import * as status from '../status/route';
import * as convs from '../conversations/route';
import * as feed from '../conversations/[id]/feed/route';
import * as messages from '../conversations/[id]/messages/route';
import * as stop from '../conversations/[id]/stop/route';
import * as undo from '../actions/[id]/undo/route';
import * as release from '../actions/[id]/release/route';
import * as decline from '../actions/[id]/decline/route';
import * as settings from '../admin/settings/route';

type Handler = (r: never, c: never) => Promise<Response>;
interface Row { name: string; h: Handler; method: string; path: string; body?: unknown; c: unknown; keys: string[]; strict?: boolean; owned?: boolean; settingsRoute?: boolean }
const P = '/api/bast-chat';
const rows: Row[] = [
  { name: 'GET status', h: status.GET as Handler, method: 'GET', path: `${P}/status`, c: {}, keys: ['conversation_id', 'enabled', 'last_assistant_seq', 'usage', 'worker'] },
  { name: 'GET conversations', h: convs.GET as Handler, method: 'GET', path: `${P}/conversations`, c: {}, keys: ['conversations'] },
  { name: 'POST conversations', h: convs.POST as Handler, method: 'POST', path: `${P}/conversations`, body: {}, c: {}, keys: ['id'], strict: true },
  { name: 'GET feed', h: feed.GET as Handler, method: 'GET', path: `${P}/conversations/${CONV}/feed?after=0`, c: ctx({ id: CONV }), keys: ['actions', 'conversation', 'events', 'live_action', 'live_text', 'waiting', 'worker'], owned: true },
  { name: 'POST messages', h: messages.POST as Handler, method: 'POST', path: `${P}/conversations/${CONV}/messages`, body: { client_ref: 'a1', text: 'hello', context: { screen: 'home', kind: 'none' } }, c: ctx({ id: CONV }), keys: ['seq'], strict: true, owned: true },
  { name: 'POST stop', h: stop.POST as Handler, method: 'POST', path: `${P}/conversations/${CONV}/stop`, body: {}, c: ctx({ id: CONV }), keys: ['queued'], strict: true, owned: true },
  { name: 'POST undo', h: undo.POST as Handler, method: 'POST', path: `${P}/actions/${ACTION}/undo`, body: {}, c: ctx({ id: ACTION }), keys: ['action'], strict: true },
  { name: 'POST release', h: release.POST as Handler, method: 'POST', path: `${P}/actions/${ACTION}/release`, body: {}, c: ctx({ id: ACTION }), keys: ['action'], strict: true },
  { name: 'POST decline', h: decline.POST as Handler, method: 'POST', path: `${P}/actions/${ACTION}/decline`, body: {}, c: ctx({ id: ACTION }), keys: ['action'], strict: true },
  { name: 'GET settings', h: settings.GET as Handler, method: 'GET', path: `${P}/admin/settings`, c: {}, keys: ['settings'], settingsRoute: true },
  { name: 'PATCH settings', h: settings.PATCH as Handler, method: 'PATCH', path: `${P}/admin/settings`, body: { enabled: true }, c: {}, keys: ['settings'], strict: true, settingsRoute: true },
];

const call = (r: Row, body: unknown = r.body, headers?: Record<string, string>) => r.h(req(r.method, r.path, body, headers) as never, r.c as never);
const keysOf = async (res: Response) => Object.keys(await res.json()).sort();

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = { ...SETTINGS };
  h.conv = { id: CONV, owner_id: OWNER_ID, status: 'idle', live_text: 'so far', live_action: null };
  vi.mocked(requireAuth).mockResolvedValue(OWNER_SESSION);
});

describe('Mike routes: access', () => {
  for (const r of rows) {
    describe(r.name, () => {
      it('401 signed out, with {error}', async () => {
        vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
        const res = await call(r);
        expect(res.status).toBe(401);
        expect(Object.keys(await res.json())).toEqual(['error']);
      });
      it('403 for an API key, even the owner\'s own', async () => {
        vi.mocked(requireAuth).mockResolvedValue(OWNER_KEY);
        const res = await call(r);
        expect(res.status).toBe(403);
        expect(Object.keys(await res.json())).toEqual(['error']);
      });
      it('403 for a signed-in user who is not the owner', async () => {
        vi.mocked(requireAuth).mockResolvedValue(OTHER_SESSION);
        expect((await call(r)).status).toBe(403);
      });
      it('403 when the database role is no longer admin', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ role: 'pm', is_active: true } as never);
        expect((await call(r)).status).toBe(403);
      });
      it(r.settingsRoute ? 'still answers while the chat is switched off' : '403 while the chat is switched off', async () => {
        h.settings = { ...SETTINGS, enabled: false };
        expect((await call(r)).status).toBe(r.settingsRoute ? 200 : 403);
      });
      it('403 when no owner is set', async () => {
        h.settings = { ...SETTINGS, owner_user_id: null };
        expect((await call(r)).status).toBe(403);
      });
      if (r.owned) {
        it('404 for a conversation that belongs to nobody', async () => {
          h.conv = null;
          const res = await call(r);
          expect(res.status).toBe(404);
          expect(Object.keys(await res.json())).toEqual(['error']);
        });
        it('404 for another owner\'s conversation', async () => {
          h.conv = { id: CONV, owner_id: 'someone-else', status: 'idle' };
          expect((await call(r)).status).toBe(404);
        });
        it('404 for an id that is not a uuid', async () => {
          const bad = { ...r, c: ctx({ id: 'nope' }) };
          expect((await call(bad)).status).toBe(404);
        });
      }
      if (r.strict) {
        it('400 on an extra field, with {error}', async () => {
          const res = await call(r, { ...(r.body as object), extra: 1 });
          expect(res.status).toBe(400);
          expect(Object.keys(await res.json())).toEqual(['error']);
        });
      }
      if (r.method !== 'GET') {
        it('refuses a cross-site request', async () => {
          expect((await call(r, r.body, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
        });
        it('refuses a body that is not JSON content', async () => {
          const res = await r.h(new Request(`http://localhost:3000${r.path}`, { method: r.method, body: '{}', headers: { 'Content-Type': 'text/plain' } }) as never, r.c as never);
          expect(res.status).toBe(415);
        });
      }
      it('happy path: exact key set, no-store', async () => {
        const res = await call(r);
        expect([200, 201]).toContain(res.status);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await keysOf(res)).toEqual(r.keys);
      });
    });
  }
  it('an action id that is not a uuid is 404', async () => {
    const res = await undo.POST(req('POST', `${P}/actions/x/undo`, {}) as never, ctx({ id: 'x' }));
    expect(res.status).toBe(404);
  });
});

describe('Mike routes: shapes the panel hook reads', () => {
  it('status', async () => {
    const b = await (await status.GET()).json();
    expect(b).toEqual({
      enabled: true,
      worker: { online: true, paused: false, pause_reason: null, auth_state: 'token' },
      conversation_id: CONV,
      last_assistant_seq: 7,
      usage: { turns_left: 99, writes_left: 25, usd_left: 7.5 },
    });
  });
  it('conversations POST is 201 {id}', async () => {
    const res = await convs.POST(req('POST', `${P}/conversations`, {}) as never);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: CONV });
  });
  it('feed: event keys, client_ref on Mike\'s message only, tool events carry no payload text', async () => {
    vi.mocked(prisma.bastChatEvent.findMany).mockImplementation((async (a: { where: { seq?: unknown; role?: string } }) =>
      a.where.seq ? [{ seq: 1, client_ref: 'a1' }] : [{ seq: 1, expired_at: null }]) as never);
    const b = await (await feed.GET(req('GET', `${P}/conversations/${CONV}/feed?after=0`) as never, ctx({ id: CONV }))).json();
    expect(b.conversation).toEqual({ id: CONV, status: 'idle' });
    expect(b.live_text).toBe('so far');
    expect(Object.keys(b.events[0]).sort()).toEqual(['client_ref', 'created_at', 'delivered', 'expired', 'kind', 'payload', 'role', 'seq']);
    expect(b.events[0].client_ref).toBe('a1');
    expect(Object.keys(b.events[1]).sort()).toEqual(['created_at', 'kind', 'payload', 'role', 'seq']);
    expect(b.events[2].payload).toEqual({});
    expect(b.waiting).toEqual([{ seq: 1, delivered: false, expired: false }]);
    expect(Object.keys(b.actions[0]).sort()).toEqual(['event_seq', 'id', 'proposed_assignee', 'status', 'summary', 'tool', 'undo_until']);
    expect(Object.keys(b.worker).sort()).toEqual(['auth_state', 'online', 'pause_reason', 'paused']);
  });
  it('feed: a bad after is 400', async () => {
    const res = await feed.GET(req('GET', `${P}/conversations/${CONV}/feed?after=-1`) as never, ctx({ id: CONV }));
    expect(res.status).toBe(400);
  });
  it('messages: 201 for new, 200 for a repeat client_ref, 429 passes the plain sentence', async () => {
    const send = () => messages.POST(req('POST', `${P}/conversations/${CONV}/messages`, { client_ref: 'a1', text: 'hi' }) as never, ctx({ id: CONV }));
    expect((await send()).status).toBe(201);
    vi.mocked(appendMikeMessage).mockResolvedValueOnce({ seq: 3, duplicate: true });
    const dup = await send();
    expect(dup.status).toBe(200);
    expect(await dup.json()).toEqual({ seq: 3 });
    vi.mocked(appendMikeMessage).mockRejectedValueOnce(new ApiError("Today's message limit is reached. It resets at midnight.", 429, 'daily_cap'));
    const capped = await send();
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "Today's message limit is reached. It resets at midnight." });
  });
  it('messages: a bad card is 400 (zod from the card parser), a missing text is 400', async () => {
    const { resolveCardContext } = await import('@/lib/bast-chat/card-context');
    vi.mocked(resolveCardContext).mockRejectedValueOnce(new (await import('zod')).ZodError([]));
    const res = await messages.POST(req('POST', `${P}/conversations/${CONV}/messages`, { client_ref: 'a', text: 'x', context: { kind: 'task' } }) as never, ctx({ id: CONV }));
    expect(res.status).toBe(400);
    const res2 = await messages.POST(req('POST', `${P}/conversations/${CONV}/messages`, { client_ref: 'a' }) as never, ctx({ id: CONV }));
    expect(res2.status).toBe(400);
  });
  it('release runs as the owner session id', async () => {
    await release.POST(req('POST', `${P}/actions/${ACTION}/release`, {}) as never, ctx({ id: ACTION }));
    expect(releaseAction).toHaveBeenCalledWith(ACTION, OWNER_ID);
  });
  it('settings PATCH: a model that is not Sonnet or Haiku is 400', async () => {
    const res = await settings.PATCH(req('PATCH', `${P}/admin/settings`, { model: 'opus' }) as never);
    expect(res.status).toBe(400);
  });
});
