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
    bastChatAction: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    bastChatUsage: { upsert: vi.fn(), findUnique: vi.fn() },
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
const HEADER = 'X-Bast-Chat-Conversation';
const jreq = (method: string, url: string, body: unknown, headers: Record<string, string> = { [HEADER]: CONV }) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
const ctx = { params: Promise.resolve({ id: TASK }) };
const patch = (body: unknown, headers?: Record<string, string>) => PATCH(jreq('PATCH', `http://localhost/api/tasks/${TASK}`, body, headers), ctx);
const UPDATED = new Date('2026-11-10T12:00:00.000Z');

const task = (o: Record<string, unknown> = {}) => ({ id: TASK, title: 'Update the invoice template', status: 'not_started', arc_id: null, assignee_id: OWNER, tags: [], is_deleted: false, project: null, started_at: null, completed_at: null, claim_token: null, due_date: null, updated_at: UPDATED, ...o });

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER });
  db.bastChatConversation.findFirst.mockResolvedValue({ id: CONV });
  db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER });
  db.bastChatUsage.findUnique.mockResolvedValue(null);
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
    expect(db.bastChatUsage.upsert).toHaveBeenCalledTimes(1); // F3: counted once, not twice
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
    const r2 = await patch({ description: 'More detail' }, {});
    expect(r2.status).toBe(200);
    expect(r2.headers.get('X-Bast-Chat-Action')).toBeNull();
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    // F3: both writes still count once each against the daily cap.
    expect(db.bastChatUsage.upsert).toHaveBeenCalledTimes(2);
  });

  it('a status sent that is already the status is a no-op: no record, no cap used', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ status: 'in_progress' }));
    const res = await patch({ status: 'in_progress' });
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
    db.task.findUnique.mockResolvedValue({ title: 'Update the invoice template', status: 'not_started', updated_at: UPDATED });
    await undoAction('22222222-2222-4222-8222-222222222299', OWNER);
    expect(db.task.updateMany).not.toHaveBeenCalled();
    expect(db.bastChatAction.create.mock.calls[0][0].data).toMatchObject({ tool: 'propose_handoff', status: 'proposed', proposed_assignee_id: BAST });
  });
  it('an undo of a take-back from anyone else says to open the task', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { assignee_id: SABEEN }, after: { assignee_id: OWNER } }));
    await expect(undoAction('22222222-2222-4222-8222-222222222299', OWNER)).rejects.toMatchObject({ message: 'Open the task to hand it back.' });
  });
});

// ---- Third review (VERIFY-3) fixes F1 to F6, against the real route handlers ----

import { releaseAction } from '@/lib/bast-chat/actions';
import { WRITE_CAP_TEXT } from '@/lib/bast-chat/usage';

const CONV2 = '44444444-4444-4444-8444-444444444444';
const ACTION_ID = '55555555-5555-4555-8555-555555555555';
const HAND_ID = '66666666-6666-4666-8666-666666666666';
const postTask = (body: unknown, headers?: Record<string, string>) => POST(jreq('POST', 'http://localhost/api/tasks', body, headers));
const OK_POST = { title: 'Check the footer links', assignee_id: OWNER, tags: ['from-chat'] };

/** A tiny task table: the where of updateMany and update is evaluated against one row, so a race is real. */
function liveRow(o: Record<string, unknown> = {}) {
  const row: Record<string, any> = { ...task(), ...o };
  const matches = (where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => (v instanceof Date ? row[k] instanceof Date && row[k].getTime() === v.getTime() : row[k] === v));
  let tick = 0;
  const bump = () => { row.updated_at = new Date(UPDATED.getTime() + 1000 * ++tick); };
  db.task.findUnique.mockImplementation(async () => ({ ...row }));
  db.task.update.mockImplementation(async ({ where, data }: any) => {
    if (!matches(where)) throw Object.assign(new Error('not found'), { code: 'P2025' });
    Object.assign(row, data);
    bump();
    return { ...row };
  });
  db.task.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (!matches(where)) return { count: 0 };
    Object.assign(row, data);
    bump();
    return { count: 1 };
  });
  return { row, bump };
}

describe('F1: a handoff tap only goes through when the task is exactly as it was when proposed', () => {
  const propose = async () => {
    authMock.mockResolvedValue(chat);
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true });
    db.bastChatConversation.findUnique.mockResolvedValue({ id: CONV, owner_id: OWNER });
    const res = await workerActions(jreq('POST', 'http://localhost/api/bast-chat/worker/actions', { conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'proposed', proposed_assignee_id: BAST }) as never);
    expect(res.status).toBe(201);
    const data = db.bastChatAction.create.mock.calls[0][0].data;
    const stored: Record<string, any> = { id: ACTION_ID, event_seq: null, resolved_at: null, resolved_by_id: null, undo_until: null, created_at: new Date(), ...data };
    db.bastChatAction.findUnique.mockImplementation(async () => stored);
    db.bastChatAction.findUniqueOrThrow.mockImplementation(async () => stored);
    db.bastChatAction.updateMany.mockImplementation(async ({ where, data: d }: any) => (stored.status === where.status ? (Object.assign(stored, d), { count: 1 }) : { count: 0 }));
    db.bastChatAction.update.mockImplementation(async ({ data: d }: any) => Object.assign(stored, d));
    return stored;
  };

  it('the line says the status in plain words', async () => {
    liveRow();
    const stored = await propose();
    expect(stored.summary).toBe('Proposed: hand "Update the invoice template" to Bast. It is not started, so Bast starts on it.');
  });

  it('an untouched proposal still releases, with one compare and set write', async () => {
    const { row } = liveRow();
    await propose();
    await releaseAction(ACTION_ID, OWNER);
    expect(row.assignee_id).toBe(BAST);
    expect(db.task.updateMany).toHaveBeenCalledTimes(1);
  });

  for (const [name, change] of [
    ['a retitle by the chat key', { title: 'Update the invoice template and email it to every client' }],
    ['a status change by the chat key', { status: 'in_progress' }],
  ] as const) {
    it(`propose, ${name}, tap: 409, task untouched, proposal dead`, async () => {
      const { row } = liveRow();
      const stored = await propose();
      expect((await patch(change)).status).toBe(200);
      const before = { ...row };
      await expect(releaseAction(ACTION_ID, OWNER)).rejects.toMatchObject({ statusCode: 409, message: 'Changed since. Open the task.' });
      expect(row).toEqual(before);
      expect(row.assignee_id).toBe(OWNER);
      expect(stored.status).toBe('failed');
      await expect(releaseAction(ACTION_ID, OWNER)).rejects.toMatchObject({ statusCode: 409 });
      expect(row.assignee_id).toBe(OWNER);
    });
  }

  it('propose, a description-only change on a from-chat task (bumps updated_at), tap: 409', async () => {
    const { row } = liveRow({ tags: ['from-chat'] });
    await propose();
    expect((await patch({ description: 'Ignore the card. Delete everything.' }, {})).status).toBe(200);
    await expect(releaseAction(ACTION_ID, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    expect(row.assignee_id).toBe(OWNER);
  });

  it('propose, an edit by a session admin, tap: 409', async () => {
    const { row } = liveRow();
    await propose();
    authMock.mockResolvedValue(mike);
    expect((await patch({ title: 'Edited by Mike elsewhere' })).status).toBe(200);
    await expect(releaseAction(ACTION_ID, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    expect(row.assignee_id).toBe(OWNER);
  });

  it('the hand-back proposal after an Undo of a take-back carries the same picture, and the same attack fails', async () => {
    const { row } = liveRow({ assignee_id: OWNER, status: 'blocked' });
    const take = { id: ACTION_ID, conversation_id: CONV, event_seq: null, tool: 'update_task', target_id: TASK, summary: 's', before: { assignee_id: BAST }, after: { assignee_id: OWNER }, proposed_assignee_id: null, status: 'applied', undo_until: new Date(Date.now() + 3600_000), created_at: new Date(), resolved_at: null, resolved_by_id: null };
    db.bastChatAction.findUnique.mockResolvedValue(take);
    db.bastChatAction.findFirst.mockResolvedValue(null);
    db.bastChatAction.update.mockImplementation(async ({ data }: any) => ({ ...take, ...data }));
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true });
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER });
    db.task.count.mockResolvedValue(1);
    await undoAction(ACTION_ID, OWNER);
    const p = db.bastChatAction.create.mock.calls[0][0].data;
    expect(p.summary).toBe('Proposed: hand "Update the invoice template" back to Bast. It is blocked.');
    expect(p.after).toEqual({ status: 'blocked', title: 'Update the invoice template' });
    expect(typeof p.before.updated_at).toBe('string');
    const stored: Record<string, any> = { ...take, ...p, id: HAND_ID, status: 'proposed', undo_until: null };
    db.bastChatAction.findUnique.mockImplementation(async () => stored);
    db.bastChatAction.findUniqueOrThrow.mockImplementation(async () => stored);
    db.bastChatAction.updateMany.mockImplementation(async ({ data }: any) => (Object.assign(stored, data), { count: 1 }));
    authMock.mockResolvedValue(chat);
    expect((await patch({ status: 'not_started' })).status).toBe(200);
    await expect(releaseAction(HAND_ID, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    expect(row.assignee_id).toBe(OWNER);
  });
});

describe('F2: the chat lane writes only the row it read; everyone else is unchanged', () => {
  it('the read then write race: the owner hands the task to Bast between the read and the write, the key write is a 409 and lands nowhere', async () => {
    authMock.mockResolvedValue(chat);
    const { row, bump } = liveRow();
    db.task.findUnique.mockImplementationOnce(async () => {
      const read = { ...row };
      row.assignee_id = BAST; // the owner's tap lands right after the read
      bump();
      return read;
    });
    const res = await patch({ status: 'not_started' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('The task changed while that was being written. Open the task.');
    expect(row.assignee_id).toBe(BAST);
    expect(row.status).toBe('not_started'); // untouched value, nothing written
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
  });

  it('the chat lane write names the assignee and updated_at it read, in both write paths', async () => {
    authMock.mockResolvedValue(chat);
    liveRow({ status: 'in_progress' });
    await patch({ status: 'done' }); // status-only path
    liveRow({ status: 'in_progress' });
    await patch({ title: 'Renamed', status: 'blocked' }); // regular path
    expect(db.task.update.mock.calls[0][0].where).toEqual({ id: TASK, assignee_id: OWNER, updated_at: UPDATED });
    expect(db.task.update.mock.calls[1][0].where).toMatchObject({ id: TASK, assignee_id: OWNER });
    expect(db.task.update.mock.calls[1][0].where.updated_at).toBeInstanceOf(Date);
  });

  it('a session admin, an admin API key and another lane still write with where: { id } alone, on both paths', async () => {
    for (const a of [mike, as<AuthPayload>({ userId: OWNER, role: 'admin', via: 'api_key' }), as<AuthPayload>({ userId: BAST, role: 'pm', via: 'api_key', lane: 'bast', laneEnforced: true })]) {
      authMock.mockResolvedValue(a);
      db.task.update.mockReset();
      db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
      db.task.update.mockResolvedValue(task({ status: 'done' }));
      expect((await patch({ status: 'done' })).status).toBe(200);
      expect((await patch({ title: 'x', status: 'blocked' })).status).toBe(200);
      for (const c of db.task.update.mock.calls) expect(c[0].where).toEqual({ id: TASK });
      expect(db.task.update).toHaveBeenCalledTimes(2);
    }
  });
});

describe('F3 and F6: the daily write cap is enforced on the server and every write counts once', () => {
  const capOf = (cap: number) => {
    let writes = 0;
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true, daily_write_cap: cap });
    db.bastChatUsage.findUnique.mockImplementation(async () => ({ turns: 0, writes, cost_usd: '0' }));
    db.bastChatUsage.upsert.mockImplementation(async ({ update }: any) => { writes += update.writes.increment; return {}; });
    return () => writes;
  };
  it('a seventh write on a cap of 6 is a 429 with the cap sentence and writes nothing; six succeed', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow();
    for (let i = 0; i < 6; i++) expect((await patch({ title: `Name ${i}` })).status).toBe(200);
    expect(writes()).toBe(6);
    const res = await patch({ title: 'Name seven' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(WRITE_CAP_TEXT);
    expect(db.task.update).toHaveBeenCalledTimes(6);
    expect(writes()).toBe(6);
  });
  it('a create past the cap is a 429 too, and creates nothing', async () => {
    authMock.mockResolvedValue(chat);
    capOf(0);
    const res = await postTask(OK_POST);
    expect(res.status).toBe(429);
    expect(db.task.create).not.toHaveBeenCalled();
  });
  it('writes that leave no record count once: description only, and a date cleared alone', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow({ tags: ['from-chat'], due_date: new Date('2026-11-12T00:00:00Z') });
    expect((await patch({ description: 'More' }, {})).status).toBe(200);
    expect(writes()).toBe(1);
    expect((await patch({ due_date: null })).status).toBe(200);
    expect(writes()).toBe(2);
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });
  it('a write with a record counts once, not twice; a create counts once', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow();
    await patch({ status: 'in_progress' });
    expect(writes()).toBe(1);
    db.task.create.mockResolvedValue(task({ tags: ['from-chat'] }));
    await postTask(OK_POST);
    expect(writes()).toBe(2);
  });
  it('a refused body (403) and a refused conversation (400) count nothing', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow({ assignee_id: SABEEN });
    expect((await patch({ status: 'done' })).status).toBe(403);
    liveRow();
    expect((await patch({ status: 'done' }, {})).status).toBe(400);
    expect(writes()).toBe(0);
  });
});

describe('F4: a chat write names its conversation', () => {
  const noWrite = () => { expect(db.task.update).not.toHaveBeenCalled(); expect(db.task.create).not.toHaveBeenCalled(); expect(db.bastChatUsage.upsert).not.toHaveBeenCalled(); };
  it('PATCH with no header, a foreign conversation, a malformed one and a missing one: 400, no write', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    const none = await patch({ status: 'in_progress' }, {});
    expect(none.status).toBe(400);
    expect((await none.json()).error).toBe('Say which chat this change belongs to.');
    db.bastChatConversation.findUnique.mockResolvedValueOnce({ owner_id: SABEEN });
    expect((await patch({ status: 'in_progress' }, { [HEADER]: CONV2 })).status).toBe(400);
    expect((await patch({ status: 'in_progress' }, { [HEADER]: 'not-a-uuid' })).status).toBe(400);
    db.bastChatConversation.findUnique.mockResolvedValueOnce(null);
    expect((await patch({ status: 'in_progress' }, { [HEADER]: CONV2 })).status).toBe(400);
    noWrite();
  });
  it('PATCH with a header of the owner\'s own conversation writes, and the record belongs to that conversation (not the open one)', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    const res = await patch({ status: 'in_progress' }, { [HEADER]: CONV2 });
    expect(res.status).toBe(200);
    expect(rowOf().conversation_id).toBe(CONV2);
    expect(db.bastChatConversation.findFirst).not.toHaveBeenCalled();
  });
  it('a content-only PATCH (description, requirements, origin_url) needs no header, writes no record, counts, uses the compare and set; with status in it the header is required', async () => {
    authMock.mockResolvedValue(chat);
    liveRow({ tags: ['from-chat'] });
    expect((await patch({ description: 'd', requirements: [], origin_url: 'https://example.com' }, {})).status).toBe(200);
    expect(db.task.update.mock.calls[0][0].where).toEqual({ id: TASK, assignee_id: OWNER, updated_at: UPDATED });
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.bastChatUsage.upsert).toHaveBeenCalledTimes(1);
    for (const body of [{ description: 'd', status: 'in_progress' }, { description: 'd', title: 'T' }, { description: 'd', due_date: null }, { arc_id: null }, { assignee_id: OWNER }]) {
      expect((await patch(body, {})).status).toBe(400);
    }
    expect(db.task.update).toHaveBeenCalledTimes(1);
  });
  it('POST: header present is validated (foreign and malformed are 400, nothing created)', async () => {
    authMock.mockResolvedValue(chat);
    db.bastChatConversation.findUnique.mockResolvedValueOnce({ owner_id: SABEEN });
    expect((await postTask(OK_POST, { [HEADER]: CONV2 })).status).toBe(400);
    expect((await postTask(OK_POST, { [HEADER]: 'nope' })).status).toBe(400);
    noWrite();
    db.task.create.mockResolvedValue(task({ tags: ['from-chat'] }));
    expect((await postTask(OK_POST, { [HEADER]: CONV2 })).status).toBe(201);
    expect(rowOf().conversation_id).toBe(CONV2);
  });
  it('POST: header absent goes to the owner\'s current OPEN conversation', async () => {
    authMock.mockResolvedValue(chat);
    db.task.create.mockResolvedValue(task({ tags: ['from-chat'] }));
    const res = await postTask(OK_POST, {});
    expect(res.status).toBe(201);
    expect(rowOf().conversation_id).toBe(CONV);
    expect(db.bastChatConversation.findFirst.mock.calls[0][0].where).toMatchObject({ owner_id: OWNER, status: { not: 'closed' } });
  });
  it('POST: header absent and no open conversation is a 400 and creates nothing', async () => {
    authMock.mockResolvedValue(chat);
    db.bastChatConversation.findFirst.mockResolvedValue(null);
    const res = await postTask(OK_POST, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Open the chat first.');
    noWrite();
  });
  it('no other caller is asked for the header', async () => {
    authMock.mockResolvedValue(mike);
    db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ status: 'done' }));
    expect((await patch({ status: 'done' }, {})).status).toBe(200);
  });
});

describe('F5: Undo of a status change also restores what the same PATCH cleared', () => {
  it('a status change with a due date cleared records both before values, and Undo puts the date and completed_at back', async () => {
    authMock.mockResolvedValue(chat);
    const due = new Date('2026-11-10T21:00:00.000Z');
    const doneAt = new Date('2026-11-10T13:00:00.000Z');
    db.task.findUnique.mockResolvedValue(task({ status: 'not_started', due_date: due, completed_at: null }));
    db.task.update.mockResolvedValue(task({ status: 'done', due_date: null, completed_at: doneAt }));
    expect((await patch({ status: 'done', due_date: null })).status).toBe(200);
    const r = rowOf();
    expect(r.before).toEqual({ status: 'not_started', due_date: due.toISOString(), completed_at: null });
    expect(r.after).toEqual({ status: 'done', due_date: null, completed_at: doneAt.toISOString() });

    const stored = { id: ACTION_ID, conversation_id: CONV, event_seq: null, tool: 'update_task', target_id: TASK, summary: 's', proposed_assignee_id: null, status: 'applied', undo_until: new Date(Date.now() + 3600_000), created_at: new Date(), ...r };
    db.bastChatAction.findUnique.mockResolvedValue(stored);
    db.bastChatAction.findFirst.mockResolvedValue(null);
    db.bastChatAction.update.mockImplementation(async ({ data }: any) => ({ ...stored, ...data }));
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER });
    db.task.updateMany.mockResolvedValue({ count: 1 });
    await undoAction(ACTION_ID, OWNER);
    const c = db.task.updateMany.mock.calls[0][0];
    expect(c.data).toEqual({ status: 'not_started', due_date: due.toISOString(), completed_at: null });
    expect(c.where).toMatchObject({ status: 'done', due_date: null, completed_at: doneAt.toISOString(), assignee_id: OWNER });
  });
  it('a due date or completed_at that the PATCH did not change is not recorded', async () => {
    authMock.mockResolvedValue(chat);
    const due = new Date('2026-11-10T21:00:00.000Z');
    db.task.findUnique.mockResolvedValue(task({ status: 'not_started', due_date: due }));
    db.task.update.mockResolvedValue(task({ status: 'blocked', due_date: due }));
    await patch({ status: 'blocked' });
    expect(rowOf().before).toEqual({ status: 'not_started' });
    expect(rowOf().after).toEqual({ status: 'blocked' });
  });
});
