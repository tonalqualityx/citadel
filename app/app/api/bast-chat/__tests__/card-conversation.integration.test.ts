// @vitest-environment node
/**
 * One chat per card (operating model S4) against a real scratch Postgres, through the real routes:
 * a conversation tied to a card, the exemption from the one-open rule, reopening instead of starting fresh, "release it" and
 * "drop it" from inside a card conversation (existing home op, existing triage functions, the same 72 hour undo), and that
 * only Mike (the chat owner, in a session) can use any of it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { closeIdleConversations, currentConversation, startConversation } from '@/lib/bast-chat/events';
import { buildInbox } from '@/lib/bast-chat/inbox';
import * as convs from '../conversations/route';
import * as messages from '../conversations/[id]/messages/route';
import * as feedRoute from '../conversations/[id]/feed/route';
import * as undoRoute from '../actions/[id]/undo/route';
import * as workerOps from '../worker/ops/route';
import * as inboxRoute from '../worker/inbox/route';
import { runHomeUndo } from '@/lib/home/act';

const authMock = requireAuth as Mock;
const MIKE: AuthPayload = { userId: MIKE_USER_ID, email: 'mike@example.test', role: 'admin', via: 'session' };
const MIKE_KEY: AuthPayload = { ...MIKE, via: 'api_key', apiKeyId: 'k1' };
const WORKER: AuthPayload = { userId: MIKE_USER_ID, email: 'bast@example.test', role: 'pm', via: 'api_key', apiKeyId: 'k2', lane: 'bast-chat', laneEnforced: true };

const post = (path: string, body: unknown) => new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = async <T,>(auth: AuthPayload, f: () => Promise<T>): Promise<T> => {
  authMock.mockResolvedValue(auth);
  return f();
};

describe.skipIf(!SCRATCH)('one chat per card (real database)', () => {
  const tag = `s4${Date.now()}`;
  const taskIds: string[] = [];
  let otherAdminId: string;
  let before: { owner_user_id: string | null; enabled: boolean } | null = null;
  const mkTask = async (title: string, status: 'triage' | 'not_started' = 'triage', description?: string) => {
    const t = await prisma.task.create({ data: { title: `${tag} ${title}`, status, ...(description ? { description } : {}) } as never });
    taskIds.push(t.id);
    return t.id;
  };
  const convFor = (taskId: string) => prisma.bastChatConversation.findFirst({ where: { owner_id: MIKE_USER_ID, task_id: taskId }, orderBy: { created_at: 'desc' } });
  const openCard = async (taskId: string) => {
    const r = await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', { task_id: taskId })));
    return { status: r.status, body: (await r.json()) as { id: string; reopened: boolean } };
  };
  const taskStatus = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).status;
  const ops = async (conversationId: string, input: unknown, auth: AuthPayload = WORKER) => {
    const r = await as(auth, () => workerOps.POST(post('/api/bast-chat/worker/ops', { conversation_id: conversationId, op: 'home', input })));
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: MIKE_USER_ID }, update: { role: 'admin', is_active: true }, create: { id: MIKE_USER_ID, email: `mike-${tag}@example.test`, password_hash: 'x', name: 'Mike', role: 'admin' } });
    await prisma.userPreference.upsert({ where: { user_id: MIKE_USER_ID }, update: { home_view: 'home' }, create: { user_id: MIKE_USER_ID, home_view: 'home' } });
    otherAdminId = (await prisma.user.create({ data: { email: `adm-${tag}@example.test`, password_hash: 'x', name: 'Other Admin', role: 'admin' } })).id;
    const s = await prisma.bastChatSettings.findUnique({ where: { id: 1 } });
    before = s ? { owner_user_id: s.owner_user_id, enabled: s.enabled } : null;
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, update: { owner_user_id: MIKE_USER_ID, enabled: true, daily_write_cap: 1_000_000 }, create: { id: 1, owner_user_id: MIKE_USER_ID, enabled: true, daily_write_cap: 1_000_000 } });
    await prisma.bastChatConversation.updateMany({ where: { owner_id: MIKE_USER_ID, status: { not: 'closed' } }, data: { status: 'closed' } });
  });
  afterAll(async () => {
    if (before) await prisma.bastChatSettings.update({ where: { id: 1 }, data: before });
    await prisma.user.delete({ where: { id: otherAdminId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('a card conversation is created once per card, tied to it, and reopens the same id afterwards', async () => {
    const t = await mkTask('first card');
    const a = await openCard(t);
    expect(a.status).toBe(201);
    expect(a.body.reopened).toBe(false);
    expect((await convFor(t))!.id).toBe(a.body.id);
    const b = await openCard(t);
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ id: a.body.id, reopened: true });
    expect(await prisma.bastChatConversation.count({ where: { task_id: t } })).toBe(1);
  });

  it('two taps at the same moment still make one conversation', async () => {
    const t = await mkTask('race card');
    const rs = await Promise.all([openCard(t), openCard(t), openCard(t)]);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.bastChatConversation.count({ where: { task_id: t } })).toBe(1);
  });

  it('is exempt from the one-open rule in both directions: the general chat and card chats do not close each other', async () => {
    const t1 = await mkTask('exempt 1');
    const t2 = await mkTask('exempt 2');
    const general1 = (await startConversation(MIKE_USER_ID)).id;
    const c1 = (await openCard(t1)).body.id;
    const c2 = (await openCard(t2)).body.id;
    const st = async (id: string) => (await prisma.bastChatConversation.findUniqueOrThrow({ where: { id } })).status;
    expect([await st(general1), await st(c1), await st(c2)]).toEqual(['idle', 'idle', 'idle']);
    // Starting a new general chat closes the old general one only, exactly as before.
    const general2 = (await startConversation(MIKE_USER_ID)).id;
    expect(await st(general1)).toBe('closed');
    expect(await st(general2)).toBe('idle');
    expect(await st(c1)).toBe('idle');
    expect(await st(c2)).toBe('idle');
    // The general chat's "current" is never a card conversation, even a newer one.
    const t3 = await mkTask('exempt 3');
    await openCard(t3);
    expect((await currentConversation(MIKE_USER_ID))!.id).toBe(general2);
  });

  it('the general start through the route is unchanged: body {} answers 201 {id} and takes no task_id echo', async () => {
    const r = await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', {})));
    expect(r.status).toBe(201);
    expect(Object.keys(await r.json())).toEqual(['id']);
  });

  it('a closed card conversation reopens to idle with its turns intact, and takes a message', async () => {
    const t = await mkTask('closed then reopened');
    const id = (await openCard(t)).body.id;
    const sent = await as(MIKE, () => messages.POST(post(`/api/bast-chat/conversations/${id}/messages`, { client_ref: `${tag}-1`, text: 'what do you think of this one?' }), params(id)));
    expect(sent.status).toBe(201);
    await prisma.bastChatConversation.update({ where: { id }, data: { status: 'closed', closed_at: new Date() } });
    const refused = await as(MIKE, () => messages.POST(post(`/api/bast-chat/conversations/${id}/messages`, { client_ref: `${tag}-2`, text: 'still there?' }), params(id)));
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const again = await openCard(t);
    expect(again.body).toEqual({ id, reopened: true });
    const row = await prisma.bastChatConversation.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('idle');
    expect(row.closed_at).toBeNull();
    expect(await prisma.bastChatEvent.count({ where: { conversation_id: id, role: 'mike' } })).toBe(1);
    const ok = await as(MIKE, () => messages.POST(post(`/api/bast-chat/conversations/${id}/messages`, { client_ref: `${tag}-3`, text: 'still there?' }), params(id)));
    expect(ok.status).toBe(201);
  });

  it('the 4 hour idle sweep closes a card conversation and the next Talk about this reopens it', async () => {
    const t = await mkTask('idle sweep');
    const id = (await openCard(t)).body.id;
    await prisma.$executeRaw`UPDATE bast_chat_conversations SET updated_at = now() - interval '5 hours' WHERE id = ${id}::uuid`;
    await closeIdleConversations(new Date());
    expect((await prisma.bastChatConversation.findUniqueOrThrow({ where: { id } })).status).toBe('closed');
    expect((await openCard(t)).body).toEqual({ id, reopened: true });
    expect((await prisma.bastChatConversation.findUniqueOrThrow({ where: { id } })).status).toBe('idle');
  });

  it('every message in a card conversation is stored against the card, whatever the browser sent', async () => {
    const t = await mkTask('context forced');
    const other = await mkTask('some other card');
    const id = (await openCard(t)).body.id;
    await as(MIKE, () => messages.POST(post(`/api/bast-chat/conversations/${id}/messages`, { client_ref: `${tag}-c`, text: 'about this', context: { kind: 'task', id: other } }), params(id)));
    const ev = await prisma.bastChatEvent.findFirstOrThrow({ where: { conversation_id: id, role: 'mike' } });
    expect(ev.context).toMatchObject({ kind: 'task', id: t });
  });

  it('the machine gets the card title and body with the message (read now), and none for the general chat', async () => {
    const body = JSON.stringify([{ id: '4b1c9a52-0000-4000-8000-00000000b001', type: 'paragraph', content: [{ type: 'text', text: 'What is wanted: a reusable invoice checker' }] }]);
    const t = await mkTask('card with a body', 'triage', body);
    const id = (await openCard(t)).body.id;
    await as(MIKE, () => messages.POST(post(`/api/bast-chat/conversations/${id}/messages`, { client_ref: `${tag}-i`, text: 'go on' }), params(id)));
    const general = (await startConversation(MIKE_USER_ID)).id;
    await as(MIKE, () => messages.POST(post(`/api/bast-chat/conversations/${general}/messages`, { client_ref: `${tag}-g`, text: 'general question' }), params(general)));
    const view = await buildInbox(new Date(), prisma);
    const mine = view.messages.find((m) => m.conversation_id === id)!;
    expect(mine.card).toEqual({ task_id: t, title: `${tag} card with a body`, body: 'What is wanted: a reusable invoice checker' });
    expect(view.messages.find((m) => m.conversation_id === general)!.card).toBeUndefined();
    const r = await as(WORKER, () => inboxRoute.GET());
    expect(r.status).toBe(200);
  });

  it('release it from a card conversation releases that card at once, with the same undo window', async () => {
    const t = await mkTask('release me');
    const id = (await openCard(t)).body.id;
    await prisma.bastChatConversation.update({ where: { id }, data: { status: 'running' } });
    const r = await ops(id, { action: 'triage_release', task_ids: [t] });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('applied');
    expect(r.body.can_undo).toBe(true);
    // The chat line and the home action both keep Triage's 72 hours (not the chat's usual 24).
    expect(Date.parse(r.body.undo_until as string) - Date.now()).toBeGreaterThan(71 * 3600 * 1000);
    expect(await taskStatus(t)).toBe('not_started');
    // The home action it recorded undoes as every release does.
    const action = await prisma.bastChatAction.findUniqueOrThrow({ where: { id: r.body.action_id as string } });
    const homeActionId = (action.after as { home_action_id: string }).home_action_id;
    await runHomeUndo(prisma as never, MIKE_USER_ID, homeActionId, new Date());
    expect(await taskStatus(t)).toBe('triage');
  });

  it('drop it from a card conversation abandons that card, and it can be put back', async () => {
    const t = await mkTask('drop me');
    const id = (await openCard(t)).body.id;
    await prisma.bastChatConversation.update({ where: { id }, data: { status: 'running' } });
    const r = await ops(id, { action: 'triage_drop', task_ids: [t] });
    expect(r.status).toBe(200);
    expect(await taskStatus(t)).toBe('abandoned');
    const action = await prisma.bastChatAction.findUniqueOrThrow({ where: { id: r.body.action_id as string } });
    await runHomeUndo(prisma as never, MIKE_USER_ID, (action.after as { home_action_id: string }).home_action_id, new Date());
    expect(await taskStatus(t)).toBe('triage');
  });

  it('a card conversation cannot release or drop another card, or a whole plan', async () => {
    const mine = await mkTask('only me');
    const other = await mkTask('not me');
    const id = (await openCard(mine)).body.id;
    await prisma.bastChatConversation.update({ where: { id }, data: { status: 'running' } });
    for (const input of [
      { action: 'triage_release', task_ids: [other] },
      { action: 'triage_release', task_ids: [mine, other] },
      { action: 'triage_drop', task_ids: [other] },
      { action: 'triage_release_plan', group_key: 'none' },
    ]) {
      const r = await ops(id, input);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/one card/);
    }
    expect(await taskStatus(mine)).toBe('triage');
    expect(await taskStatus(other)).toBe('triage');
  });

  it('the general chat still releases any ids, as before', async () => {
    const a = await mkTask('general a');
    const b = await mkTask('general b');
    const general = (await startConversation(MIKE_USER_ID)).id;
    await prisma.bastChatConversation.update({ where: { id: general }, data: { status: 'running' } });
    const r = await ops(general, { action: 'triage_release', task_ids: [a, b] });
    expect(r.status).toBe(200);
    expect(await taskStatus(a)).toBe('not_started');
    expect(await taskStatus(b)).toBe('not_started');
  });

  it('only Mike can use any of it', async () => {
    const t = await mkTask('private card');
    const id = (await openCard(t)).body.id;
    await prisma.bastChatConversation.update({ where: { id }, data: { status: 'running' } });
    const other: AuthPayload = { userId: otherAdminId, email: 'o@example.test', role: 'admin', via: 'session' };
    // Another admin: no open, no lookup, no messages, no ops.
    expect((await as(other, () => convs.POST(post('/api/bast-chat/conversations', { task_id: t })))).status).toBe(403);
    expect((await as(other, () => convs.GET(get(`/api/bast-chat/conversations?task_id=${t}`)))).status).toBe(403);
    expect((await as(other, () => messages.POST(post(`/api/bast-chat/conversations/${id}/messages`, { client_ref: `${tag}-x`, text: 'hi' }), params(id)))).status).toBe(403);
    // Mike's own API key (not a session) is refused too.
    expect((await as(MIKE_KEY, () => convs.POST(post('/api/bast-chat/conversations', { task_id: t })))).status).toBe(403);
    // The worker routes take only the enforced lane key: Mike's session is refused.
    expect((await ops(id, { action: 'triage_release', task_ids: [t] }, MIKE)).status).toBe(403);
    // Signed out: 401.
    authMock.mockRejectedValue(new AuthError('Unauthorized', 401));
    expect((await convs.POST(post('/api/bast-chat/conversations', { task_id: t }))).status).toBe(401);
    expect(await taskStatus(t)).toBe('triage');
    // The card's conversation exists only for Mike.
    const ok = await as(MIKE, () => convs.GET(get(`/api/bast-chat/conversations?task_id=${t}`)));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { conversations: { id: string; task_id: string }[] }).conversations).toMatchObject([{ id, task_id: t }]);
  });

  it('refuses a card that does not exist, a bad id, and extra fields', async () => {
    const missing = '00000000-0000-4000-8000-0000000000aa';
    expect((await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', { task_id: missing })))).status).toBe(404);
    expect((await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', { task_id: 'nope' })))).status).toBe(400);
    expect((await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', { task_id: missing, owner_id: 'x' })))).status).toBe(400);
    expect((await as(MIKE, () => convs.GET(get('/api/bast-chat/conversations?task_id=nope')))).status).toBe(400);
    const none = await as(MIKE, () => convs.GET(get(`/api/bast-chat/conversations?task_id=${missing}`)));
    expect(((await none.json()) as { conversations: unknown[] }).conversations).toEqual([]);
  });

  // ---- start fresh on a card ----
  const fresh = async (taskId: string) => {
    const r = await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', { task_id: taskId, fresh: true })));
    return { status: r.status, body: (await r.json()) as { id: string; reopened: boolean } };
  };
  const mikeSays = (id: string, ref: string, text: string) => as(MIKE, () => messages.POST(post(`/api/bast-chat/conversations/${id}/messages`, { client_ref: ref, text }), params(id)));

  it('start fresh closes the open conversation (kept, turns intact) and opens a new empty one on the same card', async () => {
    const t = await mkTask('fresh card');
    const old = (await openCard(t)).body.id;
    expect((await mikeSays(old, `${tag}-f1`, 'can you open the live site?')).status).toBe(201);
    const r = await fresh(t);
    expect(r.status).toBe(201);
    expect(r.body.reopened).toBe(false);
    expect(r.body.id).not.toBe(old);
    const oldRow = await prisma.bastChatConversation.findUniqueOrThrow({ where: { id: old } });
    expect(oldRow.status).toBe('closed');
    expect(oldRow.closed_at).not.toBeNull();
    expect(await prisma.bastChatEvent.count({ where: { conversation_id: old } })).toBe(1);
    const fresh1 = await prisma.bastChatConversation.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(fresh1.task_id).toBe(t);
    expect(fresh1.status).toBe('idle');
    // No replay: the new conversation has no turns at all; the machine reads turns by conversation id.
    expect(await prisma.bastChatEvent.count({ where: { conversation_id: r.body.id } })).toBe(0);
    const feed = await as(MIKE, () => feedRoute.GET(get(`/api/bast-chat/conversations/${r.body.id}/feed?after=0`), params(r.body.id)));
    expect(((await feed.json()) as { events: unknown[] }).events).toHaveLength(0);
    // Opening the card again gives the newest one, not the old one.
    expect((await openCard(t)).body).toEqual({ id: r.body.id, reopened: true });
    expect((await as(MIKE, () => convs.GET(get(`/api/bast-chat/conversations?task_id=${t}`)))).status).toBe(200);
    const all = (await (await as(MIKE, () => convs.GET(get(`/api/bast-chat/conversations?task_id=${t}&all=1`)))).json()) as { conversations: { id: string }[] };
    expect(all.conversations.map((c) => c.id)).toEqual([r.body.id, old]);
    // The old one stays readable as history.
    const history = await as(MIKE, () => feedRoute.GET(get(`/api/bast-chat/conversations/${old}/feed?after=0`), params(old)));
    expect(((await history.json()) as { events: unknown[] }).events).toHaveLength(1);
  });

  it('at most one conversation per card is open, even with simultaneous opens and fresh starts', async () => {
    const t = await mkTask('one open card');
    await Promise.all([openCard(t), fresh(t), fresh(t), openCard(t), fresh(t)]);
    const rows = await prisma.bastChatConversation.findMany({ where: { owner_id: MIKE_USER_ID, task_id: t } });
    expect(rows.filter((c) => c.status !== 'closed')).toHaveLength(1);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // The database holds it too: a second open conversation on the card is refused.
    await expect(prisma.bastChatConversation.create({ data: { owner_id: MIKE_USER_ID, task_id: t } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('start fresh needs a card, and the general New chat is unchanged', async () => {
    const bad = await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', { fresh: true })));
    expect(bad.status).toBe(400);
    const g1 = (await startConversation(MIKE_USER_ID)).id;
    const t = await mkTask('general untouched');
    const card = (await openCard(t)).body.id;
    const g2 = (await as(MIKE, () => convs.POST(post('/api/bast-chat/conversations', {})))).status;
    expect(g2).toBe(201);
    expect((await prisma.bastChatConversation.findUniqueOrThrow({ where: { id: g1 } })).status).toBe('closed');
    expect((await prisma.bastChatConversation.findUniqueOrThrow({ where: { id: card } })).status).toBe('idle');
  });

  it('an action of the earlier conversation is still in the card feed and its Undo still works', async () => {
    const t = await mkTask('undo after fresh');
    const old = (await openCard(t)).body.id;
    const c = await prisma.comment.create({ data: { task_id: t, user_id: MIKE_USER_ID, content: 'a note from the chat', is_internal: true, client_visible: false } });
    const a = await prisma.bastChatAction.create({
      data: {
        conversation_id: old,
        event_seq: null,
        tool: 'comment_on_task',
        target_type: 'comment',
        target_id: c.id,
        summary: 'Added a note to "x".',
        status: 'applied',
        undo_until: new Date(Date.now() + 3600_000),
        before: { task_id: t, comment: null },
        after: { task_id: t, comment_id: c.id },
      },
    });
    const next = (await fresh(t)).body.id;
    const feed = await as(MIKE, () => feedRoute.GET(get(`/api/bast-chat/conversations/${next}/feed?after=0`), params(next)));
    const body = (await feed.json()) as { actions: { id: string; conversation_id: string; can_undo?: boolean; undo_until: string | null }[] };
    const mine = body.actions.find((x) => x.id === a.id)!;
    expect(mine.conversation_id).toBe(old);
    expect(mine.undo_until).not.toBeNull();
    const undone = await as(MIKE, () => undoRoute.POST(post(`/api/bast-chat/actions/${a.id}/undo`, {}), params(a.id)));
    expect(undone.status).toBe(200);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).is_deleted).toBe(true);
    expect((await prisma.bastChatAction.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('undone');
  });
});
