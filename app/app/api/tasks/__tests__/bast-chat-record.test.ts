/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const BAST = 'ca5335e7-a374-4eff-92dc-fd67ceef2297';
const SABEEN = 'b565b492-cdea-497b-a13d-85f003916bf9';
const CONV = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const ARC = '33333333-3333-4333-8333-333333333333';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const p: any = {
    bastChatSettings: { findUnique: vi.fn() },
    bastChatConversation: { findFirst: vi.fn(), findUnique: vi.fn() },
    bastChatAction: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    bastChatUsage: { upsert: vi.fn() },
    task: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    project: { findUnique: vi.fn() },
    arc: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    emailAsk: { findFirst: vi.fn() },
    function: { findUnique: vi.fn() },
    sop: { findUnique: vi.fn() },
    charter: { findUnique: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn() },
  };
  p.$transaction = vi.fn(async (fn: any) => fn(p));
  return { prisma: p };
});
vi.mock('@/lib/api/formatters', () => ({ formatTaskResponse: vi.fn((t) => t) }));
vi.mock('@/lib/services/activity', () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), logStatusChange: vi.fn() }));
vi.mock('@/lib/services/notifications', () => ({ notifyTaskAssigned: vi.fn() }));

import { POST } from '../route';
import { PATCH } from '../[id]/route';
import { POST as workerActions } from '../../bast-chat/worker/actions/route';
import { requireAuth } from '@/lib/auth/middleware';
import type { AuthPayload } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { undoAction } from '@/lib/bast-chat/actions';

const authMock = vi.mocked(requireAuth);
const db: any = prisma;
const as = <T>(o: object) => o as T;
const chat = as<AuthPayload>({ userId: BAST, role: 'pm', via: 'api_key', lane: 'bast-chat', laneEnforced: true });
const mike = as<AuthPayload>({ userId: OWNER, role: 'admin', via: 'session' });
const jreq = (method: string, url: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: TASK }) };
const patch = (body: unknown) => PATCH(jreq('PATCH', `http://localhost/api/tasks/${TASK}`, body), ctx);

const task = (o: Record<string, unknown> = {}) => ({ id: TASK, title: 'Update the invoice template', status: 'not_started', arc_id: null, assignee_id: OWNER, tags: [], is_deleted: false, project: null, started_at: null, completed_at: null, claim_token: null, ...o });

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER });
  db.bastChatConversation.findFirst.mockResolvedValue({ id: CONV });
  db.bastChatAction.create.mockResolvedValue({ id: 'a1' });
  db.user.findUnique.mockResolvedValue({ id: BAST, name: 'Bast Fae', is_active: true });
  db.task.count.mockResolvedValue(0);
  db.task.findMany.mockResolvedValue([]);
});

const rowOf = () => db.bastChatAction.create.mock.calls[0][0].data;

describe('PATCH by the chat key writes the record itself', () => {
  it('a status change writes exactly one record with the true before and after, and returns its id in the header', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ status: 'done' }));
    const res = await patch({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Bast-Chat-Action')).toBe('a1');
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(1);
    expect(rowOf()).toMatchObject({ conversation_id: CONV, tool: 'update_task', target_id: TASK, status: 'applied', summary: 'Marked "Update the invoice template" done.', before: { status: 'in_progress' }, after: { status: 'done' } });
    expect(rowOf().undo_until).toBeInstanceOf(Date);
    expect(db.bastChatUsage.upsert).toHaveBeenCalledTimes(1);
    expect(Object.keys(await res.json())).not.toContain('chat_action');
  });

  it('a rename plus an arc move is one record naming exactly the fields that changed', async () => {
    authMock.mockResolvedValue(chat);
    db.arc.findUnique.mockResolvedValue({ id: ARC });
    db.task.findUnique.mockResolvedValue(task({ title: 'Old', status: 'blocked' }));
    db.task.update.mockResolvedValue(task({ title: 'New', arc_id: ARC, status: 'blocked' }));
    const res = await patch({ title: 'New', arc_id: ARC, status: 'blocked' });
    expect(res.status).toBe(200);
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(1);
    expect(rowOf().before).toEqual({ title: 'Old', arc_id: null });
    expect(rowOf().after).toEqual({ title: 'New', arc_id: ARC });
    expect(rowOf().summary).toBe('Renamed "Old" to "New". Moved "New" into an arc.');
  });

  it('a take-back of Bast\'s task records the true previous assignee', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ assignee_id: BAST }));
    db.task.update.mockResolvedValue(task({ assignee_id: OWNER }));
    const res = await patch({ assignee_id: OWNER });
    expect(res.status).toBe(200);
    expect(rowOf().before).toEqual({ assignee_id: BAST });
    expect(rowOf().after).toEqual({ assignee_id: OWNER });
    expect(rowOf().summary).toBe('Took "Update the invoice template" back from Bast.');
  });

  it('a PATCH that changes none of the four fields writes no record and no header (clearing a date; content on a from-chat task)', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ tags: ['from-chat'], due_date: new Date() }));
    db.task.update.mockResolvedValue(task({ tags: ['from-chat'], due_date: null }));
    const r1 = await patch({ due_date: null });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('X-Bast-Chat-Action')).toBeNull();
    const r2 = await patch({ description: 'More detail' });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('X-Bast-Chat-Action')).toBeNull();
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
  });

  it('a status sent that is already the status is a no-op: no record, no cap used', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ status: 'in_progress' }));
    const res = await patch({ status: 'in_progress' });
    expect(res.headers.get('X-Bast-Chat-Action')).toBeNull();
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });

  it('with no open conversation the record goes to the newest conversation; with none at all the change stands, unrecorded', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ status: 'done' }));
    db.bastChatConversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'newest' });
    expect((await patch({ status: 'done' })).headers.get('X-Bast-Chat-Action')).toBe('a1');
    expect(rowOf().conversation_id).toBe('newest');
    db.bastChatAction.create.mockClear();
    db.bastChatConversation.findFirst.mockResolvedValue(null);
    const res = await patch({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Bast-Chat-Action')).toBeNull();
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });

  it('a failure to write the record does not fail the change', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ status: 'done' }));
    db.bastChatAction.create.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await patch({ status: 'done' });
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Bast-Chat-Action')).toBeNull();
  });

  it('a refused PATCH (a task that is not the owner\'s) writes no record', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ assignee_id: SABEEN }));
    const res = await patch({ status: 'done' });
    expect(res.status).toBe(403);
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });
});

describe('POST by the chat key writes a filed record', () => {
  it('one record for the new task, the line from the task, id in the header', async () => {
    authMock.mockResolvedValue(chat);
    db.task.create.mockResolvedValue(task({ id: TASK, title: 'Pick six photos for the holiday carousel and send Mark the shortlist', tags: ['from-chat'] }));
    const res = await POST(jreq('POST', 'http://localhost/api/tasks', { title: 'Pick six photos for the holiday carousel and send Mark the shortlist', assignee_id: OWNER, tags: ['from-chat'] }));
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Bast-Chat-Action')).toBe('a1');
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(1);
    expect(rowOf()).toMatchObject({ tool: 'create_task', target_id: TASK, status: 'applied', after: { status: 'not_started', assignee_id: OWNER } });
    expect(rowOf().before).toBeUndefined();
    expect(rowOf().summary).toBe('Filed "Pick six photos for the holiday carousel and send Mark...".');
  });
});

describe('any other caller: no record, no header, no chat reads', () => {
  it('PATCH and POST by Mike\'s session', async () => {
    authMock.mockResolvedValue(mike);
    db.task.findUnique.mockResolvedValue(task({ assignee_id: BAST, status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ assignee_id: BAST, status: 'done' }));
    const r1 = await patch({ status: 'done' });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('X-Bast-Chat-Action')).toBeNull();
    db.task.create.mockResolvedValue(task({ tags: ['from-chat'] }));
    const r2 = await POST(jreq('POST', 'http://localhost/api/tasks', { title: 't', assignee_id: OWNER, tags: ['from-chat'] }));
    expect(r2.headers.get('X-Bast-Chat-Action')).toBeNull();
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.bastChatSettings.findUnique).not.toHaveBeenCalled();
    expect(db.bastChatConversation.findFirst).not.toHaveBeenCalled();
  });
  it('a key of another lane, and a key with no lane', async () => {
    for (const a of [as<AuthPayload>({ userId: BAST, role: 'pm', via: 'api_key', lane: 'bast', laneEnforced: true }), as<AuthPayload>({ userId: BAST, role: 'pm', via: 'api_key' })]) {
      authMock.mockResolvedValue(a);
      db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
      db.task.update.mockResolvedValue(task({ status: 'done' }));
      const res = await patch({ status: 'done' });
      expect(res.headers.get('X-Bast-Chat-Action')).toBeNull();
    }
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.bastChatSettings.findUnique).not.toHaveBeenCalled();
  });
});

describe('VERIFY-2 N1 to N3 replayed against the worker route: each is refused now', () => {
  const post = async (body: unknown) => {
    authMock.mockResolvedValue(chat);
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true });
    db.bastChatConversation.findUnique.mockResolvedValue({ id: CONV, owner_id: OWNER });
    return workerActions(jreq('POST', 'http://localhost/api/bast-chat/worker/actions', body) as never);
  };
  const attacks: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['record on Bast\'s blocked task (N1)', { assignee_id: BAST, status: 'blocked' }, { before: { status: 'not_started' }, after: { status: 'blocked' } }],
    ['rename record on Sabeen\'s task (N1)', { assignee_id: SABEEN, title: 'Her title' }, { before: { title: 'x' }, after: { title: 'Her title' } }],
    ['abandon through a crafted before (N2)', { status: 'not_started' }, { before: { status: 'abandoned' }, after: { status: 'not_started' } }],
    ['blank title through a crafted before (N2)', { title: 'T' }, { before: { title: ' ' }, after: { title: 'T' } }],
    ['unassign through a crafted before (N2)', {}, { before: { assignee_id: null }, after: { assignee_id: OWNER } }],
    ['a take-back that never happened (N2)', {}, { before: { assignee_id: SABEEN }, after: { assignee_id: OWNER } }],
    ['move into an arc through remove_from_arc (N2)', {}, { tool: 'remove_from_arc', before: { arc_id: ARC }, after: { arc_id: null } }],
    ['a no-op record to burn the daily cap (N3)', { title: 'T' }, { before: { title: 'T' }, after: { title: 'T' }, summary: '<script>' }],
  ];
  for (const [name, taskFields, rec] of attacks) {
    it(`${name}: 400, no row, no write counted`, async () => {
      db.task.findUnique.mockResolvedValue(task(taskFields));
      const res = await post({ conversation_id: CONV, tool: 'update_task', target_id: TASK, status: 'applied', ...rec });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('The chat can only propose a handoff. Citadel records every change itself.');
      expect(db.bastChatAction.create).not.toHaveBeenCalled();
      expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
    });
  }
  it('a filed record and a failed record are refused too', async () => {
    db.task.findUnique.mockResolvedValue(task({ tags: ['from-chat'] }));
    expect((await post({ conversation_id: CONV, tool: 'create_task', target_id: TASK, status: 'applied' })).status).toBe(400);
    expect((await post({ conversation_id: CONV, tool: 'update_task', target_id: TASK, status: 'failed', error: 'x' })).status).toBe(400);
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });
  it('a handoff proposal for the owner\'s own task still works; for Sabeen or a task that is not the owner\'s it does not', async () => {
    db.task.findUnique.mockResolvedValue(task());
    db.bastChatAction.create.mockResolvedValue({ id: 'p1', status: 'proposed', undo_until: null });
    const ok = await post({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'proposed', proposed_assignee_id: BAST });
    expect(ok.status).toBe(201);
    expect((await post({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'proposed', proposed_assignee_id: SABEEN })).status).toBe(400);
    db.task.findUnique.mockResolvedValue(task({ assignee_id: BAST }));
    expect((await post({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'proposed', proposed_assignee_id: BAST })).status).toBe(400);
  });
});

describe('Undo of a server-written record', () => {
  const stored = (over: Record<string, unknown>) => ({ id: 'a1', conversation_id: CONV, event_seq: null, tool: 'update_task', target_id: TASK, summary: 's', before: null, after: null, proposed_assignee_id: null, status: 'applied', undo_until: new Date(Date.now() + 3600_000), created_at: new Date(), ...over });
  beforeEach(() => {
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER });
    db.bastChatAction.findFirst.mockResolvedValue(null);
    db.bastChatAction.update.mockImplementation(async ({ data }: any) => ({ ...stored({}), ...data }));
    db.task.updateMany.mockResolvedValue({ count: 1 });
    db.task.count.mockResolvedValue(1);
  });
  it('a status undo writes the true before, only on the owner\'s task still holding the true after', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { status: 'in_progress' }, after: { status: 'done' } }));
    await undoAction('22222222-2222-4222-8222-222222222299', OWNER);
    const c = db.task.updateMany.mock.calls[0][0];
    expect(c.where).toMatchObject({ id: TASK, status: 'done', assignee_id: OWNER });
    expect(c.data).toEqual({ status: 'in_progress' });
  });
  it('an undo of a filed task abandons it only while it is still the owner\'s and tagged from-chat', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ tool: 'create_task', after: { status: 'not_started', assignee_id: OWNER } }));
    await undoAction('22222222-2222-4222-8222-222222222299', OWNER);
    const c = db.task.updateMany.mock.calls[0][0];
    expect(c.where).toMatchObject({ assignee_id: OWNER, tags: { has: 'from-chat' }, status: 'not_started' });
    expect(c.data).toEqual({ status: 'abandoned' });
  });
  it('an undo of a take-back from Bast is a proposal the owner taps; the task is not written', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { assignee_id: BAST }, after: { assignee_id: OWNER } }));
    db.task.findUnique.mockResolvedValue({ title: 'Update the invoice template' });
    await undoAction('22222222-2222-4222-8222-222222222299', OWNER);
    expect(db.task.updateMany).not.toHaveBeenCalled();
    expect(db.bastChatAction.create.mock.calls[0][0].data).toMatchObject({ tool: 'propose_handoff', status: 'proposed', proposed_assignee_id: BAST });
  });
  it('an undo of a take-back from anyone else says to open the task', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { assignee_id: SABEEN }, after: { assignee_id: OWNER } }));
    await expect(undoAction('22222222-2222-4222-8222-222222222299', OWNER)).rejects.toMatchObject({ message: 'Open the task to hand it back.' });
  });
});
