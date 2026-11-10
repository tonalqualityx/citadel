/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/bast-chat/worker/ops against the real operations and the real proposal code, on in-memory tables.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { ACTION, CONV, NOT_WORKERS, OTHER_ID, OWNER_ID, SETTINGS, WORKER, req } from '../../../../app/api/bast-chat/__tests__/harness';

const h = vi.hoisted(() => ({ db: null as any, settings: {} as any }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k) => h.db?.[k as string] }) }));
vi.mock('@/lib/bast-chat/settings', async (orig) => ({ ...(await orig<typeof import('@/lib/bast-chat/settings')>()), getSettings: vi.fn(async () => h.settings) }));
vi.mock('@/lib/services/user-timezone', () => ({ resolveUserTimezone: vi.fn(async () => 'America/New_York') }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({})) }));
vi.mock('@/lib/services/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/bast-chat/events', async (orig) => ({ ...(await orig<typeof import('@/lib/bast-chat/events')>()), appendChatNote: vi.fn(async () => undefined) }));
const homeAct = vi.hoisted(() => vi.fn());
vi.mock('@/lib/home/act', async (orig) => ({ ...(await orig<typeof import('@/lib/home/act')>()), runHomeAct: homeAct, runHomeUndo: vi.fn() }));
vi.mock('@/lib/home/ensure-day', () => ({ ensureHomeDay: vi.fn(async () => '2026-11-10') }));
vi.mock('@/lib/home/state', () => ({ getHomeAction: vi.fn(async () => ({ before: { states: [] }, after: { states: [] } })), getItemState: vi.fn(async () => null) }));

import { requireAuth } from '@/lib/auth/middleware';
import * as route from '../../../../app/api/bast-chat/worker/ops/route';
import { undoAction, releaseAction } from '../../actions';

const PROJ = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const TASK = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const KEY = `task:${TASK}`;
const P = '/api/bast-chat/worker/ops';
let project: any;
let actions: any[];
let writes: number;
let conv: any;

function makeDb() {
  const db: any = {
    bastChatConversation: { findUnique: vi.fn(async () => conv) },
    user: { findUnique: vi.fn(async () => ({ is_active: true, role: 'admin', email: 'm@x.test', name: 'Mike' })) },
    userPreference: { findUnique: vi.fn(async () => ({ home_view: 'home' })) },
    task: { findUnique: vi.fn(async () => ({ title: 'Grok rescan', tags: [] })) },
    project: {
      findFirst: vi.fn(async () => (project ? { ...project } : null)),
      updateMany: vi.fn(async ({ where, data }: any) => { if (project.status !== where.status) return { count: 0 }; Object.assign(project, data); return { count: 1 }; }),
    },
    bastChatUsage: { createMany: vi.fn(async () => ({ count: 1 })), updateMany: vi.fn(async () => { writes += 1; return { count: 1 }; }) },
    bastChatAction: {
      create: vi.fn(async ({ data }: any) => { const row = { id: `00000000-0000-4000-8000-${String(actions.length + 1).padStart(12, '0')}`, created_at: new Date(), ...data }; actions.push(row); return row; }),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async ({ where }: any) => actions.find((a) => a.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const a = actions.find((x) => x.id === where.id && (!where.status || x.status === where.status)); if (!a) return { count: 0 }; Object.assign(a, data); return { count: 1 }; }),
      update: vi.fn(async ({ where, data }: any) => { const a = actions.find((x) => x.id === where.id); Object.assign(a, data); return a; }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => actions.find((a) => a.id === where.id)),
    },
    bastChatEvent: { create: vi.fn(async () => ({})), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({})) },
  };
  db.$transaction = async (fn: any) => fn(db);
  // The advisory locks (task-locks.ts): no keys come back, so nothing waits.
  db.$queryRaw = vi.fn(async () => []);
  db.$executeRaw = vi.fn(async () => 0);
  return db;
}

const call = (body: unknown) => route.POST(req('POST', P, body) as never);
const body = (op: string, input: object, extra: object = {}) => ({ conversation_id: CONV, op, input, ...extra });
const proj = (status: string) => body('project', { project_id: PROJ, status });

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = { ...SETTINGS, handoff_user_ids: [] };
  conv = { id: CONV, owner_id: OWNER_ID, status: 'running' };
  project = { id: PROJ, name: 'VCDP site', status: 'in_progress', completed_date: null, is_deleted: false };
  actions = [];
  writes = 0;
  h.db = makeDb();
  homeAct.mockResolvedValue({ ok: true, action_id: '77777777-7777-4777-8777-777777777777', undo_until: null, item_key: KEY, message: 'Moved up.' });
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
});

describe('who may call it', () => {
  it('401 signed out', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await call(proj('review'))).status).toBe(401);
  });
  for (const [who, auth] of NOT_WORKERS) {
    it(`403 for ${who}, nothing touched`, async () => {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      const res = await call(proj('review'));
      expect(res.status).toBe(403);
      expect(Object.keys(await res.json())).toEqual(['error']);
      expect(h.db.project.updateMany).not.toHaveBeenCalled();
      expect(writes).toBe(0);
    });
  }
});

describe('what it refuses, always as {error}', () => {
  const refused = async (b: unknown, status: number) => {
    const res = await call(b);
    expect(res.status).toBe(status);
    const j = await res.json();
    expect(Object.keys(j)).toEqual(['error']);
    expect(typeof j.error).toBe('string');
    expect(h.db.project.updateMany).not.toHaveBeenCalled();
    expect(h.db.bastChatAction.create).not.toHaveBeenCalled();
    expect(writes).toBe(0);
  };
  it('an unknown op, and the task kind (not reachable here)', async () => {
    await refused(body('nope', {}), 400);
    await refused(body('task', { task_id: TASK, body: { status: 'done' } }), 400);
  });
  it('extra fields at the top and inside the input', async () => {
    await refused({ ...proj('review'), extra: 1 }, 400);
    await refused(body('project', { project_id: PROJ, status: 'review', user_id: OTHER_ID }), 400);
    await refused(body('home', { action: 'matters_more', item_key: KEY, user_id: OTHER_ID }), 400);
    await refused(body('home', { action: 'matters_more', item_key: KEY, owner_id: OTHER_ID }), 400);
  });
  it('a closed conversation, a foreign one, a missing one', async () => {
    conv = { id: CONV, owner_id: OWNER_ID, status: 'closed' };
    await refused(proj('review'), 409);
    for (const status of ['idle', 'queued']) {
      conv = { id: CONV, owner_id: OWNER_ID, status };
      await refused(proj('review'), 409);
    }
    conv = { id: CONV, owner_id: OTHER_ID, status: 'running' };
    await refused(proj('review'), 404);
    conv = null;
    await refused(proj('review'), 404);
  });
  it('a chat that is switched off, and an owner who is no longer an active admin', async () => {
    h.settings = { ...SETTINGS, enabled: false };
    await refused(proj('review'), 409);
    h.settings = { ...SETTINGS };
    h.db.user.findUnique.mockResolvedValue({ is_active: true, role: 'pm' });
    await refused(proj('review'), 409);
  });
  it('a bad body (not an object input, not json)', async () => {
    await refused({ conversation_id: CONV, op: 'project', input: 'x' }, 400);
    await refused('{nope', 400);
  });
});

describe('a write that needs no tap', () => {
  it('applies, records true before and after for Undo, counts one write, answers 200', async () => {
    const res = await call(proj('review'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(['action_id', 'can_undo', 'line', 'result', 'status', 'undo_until']);
    expect(j).toMatchObject({ status: 'applied', line: 'Moved the VCDP site project to review.', can_undo: true, result: { project_id: PROJ, status: 'review' } });
    expect(project.status).toBe('review');
    expect(writes).toBe(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ conversation_id: CONV, tool: 'change_project', target_type: 'project', target_id: PROJ, status: 'applied', before: { status: 'in_progress' }, after: { status: 'review' } });
    expect(j.action_id).toBe(actions[0].id);
  });
  it('Undo through the real undoAction restores it (registered by importing the ops module)', async () => {
    const j = await (await call(proj('review'))).json();
    h.db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER_ID });
    const v = await undoAction(j.action_id, OWNER_ID, new Date(), h.db);
    expect(v.status).toBe('undone');
    expect(project.status).toBe('in_progress');
  });
  it('a write that misses its compare-and-set is a 409 and records nothing', async () => {
    project.status = 'review';
    h.db.project.findFirst = vi.fn(async () => ({ ...project, status: 'in_progress' })); // read says in_progress, row says review: CAS misses
    const res = await call(proj('done'));
    expect(res.status).toBe(409);
    expect(actions).toHaveLength(0);
  });
  it('a home change acts for the configured owner whatever the request says, one write counted', async () => {
    const res = await call(body('home', { action: 'matters_more', item_key: KEY }));
    expect(res.status).toBe(200);
    expect(homeAct).toHaveBeenCalledTimes(1);
    expect(homeAct.mock.calls[0][1]).toBe(OWNER_ID);
    expect(writes).toBe(1);
    expect(actions[0]).toMatchObject({ tool: 'home_change', target_type: 'home', target_id: '77777777-7777-4777-8777-777777777777', status: 'applied' });
  });
});

describe('a change that needs a tap', () => {
  it('a project going live: 202, a proposal row, X-Bast-Chat-Action, nothing else written, one write counted', async () => {
    project.status = 'queue';
    const res = await call(proj('ready'));
    expect(res.status).toBe(202);
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(['action_id', 'line', 'proposal_kind', 'status']);
    expect(j).toMatchObject({ status: 'proposed', proposal_kind: 'client_show' });
    expect(res.headers.get('X-Bast-Chat-Action')).toBe(j.action_id);
    expect(project.status).toBe('queue');
    expect(h.db.project.updateMany).not.toHaveBeenCalled();
    expect(writes).toBe(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ status: 'proposed', proposal_kind: 'client_show', tool: 'change_project', target_type: 'project', target_id: PROJ });
  });
  it('the tap (releaseAction) then applies it as the owner through the op, and is not counted again', async () => {
    project.status = 'queue';
    const j = await (await call(proj('ready'))).json();
    h.db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER_ID });
    const v = await releaseAction(j.action_id, OWNER_ID, new Date(), h.db);
    expect(v.status).toBe('released');
    expect(project.status).toBe('ready');
    expect(writes).toBe(1);
  });
  it('a change between proposal and tap kills the tap and writes nothing', async () => {
    project.status = 'queue';
    const j = await (await call(proj('ready'))).json();
    project.status = 'suspended';
    h.db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER_ID });
    await expect(releaseAction(j.action_id, OWNER_ID, new Date(), h.db)).rejects.toMatchObject({ statusCode: 409 });
    expect(project.status).toBe('suspended');
  });
});

void ACTION;
