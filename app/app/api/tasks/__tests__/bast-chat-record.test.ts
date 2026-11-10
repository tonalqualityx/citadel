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
    bastChatAction: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    comment: { findFirst: vi.fn(), findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(async () => 0),
    bastChatEvent: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
    bastChatUsage: { upsert: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
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
// A blocker connect checks for a cycle and for open blockers; the table is a mock, so these two are fixed.
vi.mock('@/lib/services/dependencies', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/dependencies')>()),
  wouldCreateCycle: vi.fn(async () => false),
  areBlockersSatisfied: vi.fn(async () => true),
}));

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

/** A whole task row: every column the reach loader and the change record read (a fixture missing one reads as "could not rule out"). */
const task = (o: Record<string, unknown> = {}) => ({
  id: TASK, title: 'Update the invoice template', status: 'not_started', arc_id: null, assignee_id: OWNER, tags: [], is_deleted: false, project: null,
  started_at: null, completed_at: null, claim_token: null, due_date: null, updated_at: UPDATED,
  description: null, requirements: null, notes: null, site_id: null, project_id: null, client_id: null, sop_id: null, needs_review: false, approved: false,
  client_approved_at: null, lease_until: null, client_visible: false, requested_by_contact_id: null, staging_preview_url: null, priority: 3, is_focus: false,
  promised_to: null, energy_estimate: null, mystery_factor: 'none', battery_impact: 'average_drain', blocked_by: [], blocking: [], ...o,
});

/** A stateful usage table. updateMany honors the `lt` condition in one synchronous step, like the database's conditional update. */
let usageWrites = 0;
beforeEach(() => {
  vi.resetAllMocks();
  usageWrites = 0;
  db.bastChatUsage.upsert.mockResolvedValue({});
  db.bastChatUsage.createMany.mockResolvedValue({ count: 0 });
  db.bastChatUsage.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (!(usageWrites < where.writes.lt)) return { count: 0 };
    usageWrites += data.writes.increment;
    return { count: 1 };
  });
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, daily_write_cap: 25 });
  db.bastChatConversation.findFirst.mockResolvedValue({ id: CONV });
  db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'running' });
  db.bastChatUsage.findUnique.mockResolvedValue(null);
  db.bastChatAction.create.mockResolvedValue({ id: 'a1' });
  db.user.findUnique.mockResolvedValue({ id: BAST, name: 'Bast Fae', is_active: true });
  db.task.count.mockResolvedValue(0);
  db.task.findMany.mockResolvedValue([]);
  db.comment.findFirst.mockResolvedValue(null);
  db.comment.findMany.mockResolvedValue([]);
  db.bastChatAction.findMany.mockResolvedValue([]);
  // The chat note a tap, Undo or decline appends (events.ts): lock the conversation row, take the next seq.
  let seq = 0;
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const q = strings.join('');
    if (q.includes('FOR UPDATE')) return [{ status: 'idle', owner_id: OWNER }];
    if (q.includes('RETURNING last_seq')) return [{ last_seq: ++seq }];
    return [];
  });
  db.bastChatEvent.create.mockResolvedValue({});
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
    expect(rowOf()).toMatchObject({ conversation_id: CONV, tool: 'change_task', target_type: 'task', target_id: TASK, status: 'applied', summary: 'Marked "Update the invoice template" done.', before: { status: 'in_progress' }, after: { status: 'done' } });
    expect(rowOf().undo_until).toBeInstanceOf(Date);
    expect(usageWrites).toBe(1); // G1: one reservation, nothing counted again after the write
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

  it('clearing a date and rewriting the description are recorded now, each with the true before and after, and each counts once', async () => {
    authMock.mockResolvedValue(chat);
    const due = new Date('2026-11-12T00:00:00.000Z');
    db.task.findUnique.mockResolvedValue(task({ tags: ['from-chat'], due_date: due, description: 'Old text' }));
    db.task.update.mockResolvedValue(task({ tags: ['from-chat'], due_date: null, description: 'Old text' }));
    const r1 = await patch({ due_date: null });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('X-Bast-Chat-Action')).toBe('a1');
    expect(rowOf().before).toEqual({ due_date: due.toISOString() });
    expect(rowOf().after).toEqual({ due_date: null });
    db.bastChatAction.create.mockClear();
    db.task.update.mockResolvedValue(task({ tags: ['from-chat'], due_date: due, description: '"New text"' }));
    const r2 = await patch({ description: 'New text' });
    expect(r2.status).toBe(200);
    expect(rowOf().before).toEqual({ description: 'Old text' });
    expect(rowOf().after).toEqual({ description: '"New text"' });
    expect(rowOf().summary).toBe('Rewrote the description on "Update the invoice template".');
    expect(usageWrites).toBe(2);
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

  it('a refused PATCH (a closed field, on someone else\'s task) writes no record and no task', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ assignee_id: SABEEN }));
    for (const body of [{ client_approved_at: '2026-11-10T00:00:00.000Z' }, { status: 'done', billing_amount: 5 }, { tags_remove: ['security'] }]) {
      const res = await patch(body);
      expect(res.status).toBe(403);
    }
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('someone else\'s task is changed like any other (the owner\'s ruling): Sabeen\'s task closes, with a record', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task({ assignee_id: SABEEN, status: 'in_progress' }));
    db.task.update.mockResolvedValue(task({ assignee_id: SABEEN, status: 'done' }));
    const res = await patch({ status: 'done' });
    expect(res.status).toBe(200);
    expect(rowOf()).toMatchObject({ before: { status: 'in_progress' }, after: { status: 'done' } });
    expect(db.task.update.mock.calls[0][0].where).toMatchObject({ id: TASK, assignee_id: SABEEN });
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
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true, daily_write_cap: 25 });
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
      expect(db.bastChatUsage.createMany).not.toHaveBeenCalled();
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

describe('Undo of a server-written record (through patchTask, as the owner)', () => {
  const stored = (over: Record<string, unknown>) => ({ id: 'a1', conversation_id: CONV, event_seq: null, turn_seq: null, tool: 'change_task', target_type: 'task', target_id: TASK, summary: 's', before: null, after: null, proposed_assignee_id: null, status: 'applied', undo_until: new Date(Date.now() + 3600_000), created_at: new Date(), resolved_at: null, resolved_by_id: null, ...over });
  const ID = '22222222-2222-4222-8222-222222222299';
  beforeEach(() => {
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'running' });
    db.bastChatAction.findFirst.mockResolvedValue(null);
    db.bastChatAction.update.mockImplementation(async ({ data }: any) => ({ ...stored({}), ...data }));
    db.bastChatAction.updateMany.mockResolvedValue({ count: 1 });
    db.bastChatAction.findUniqueOrThrow.mockResolvedValue(stored({ status: 'undone' }));
    db.user.findUnique.mockResolvedValue({ id: OWNER, name: 'Mike', email: 'm@x.test', role: 'admin', is_active: true });
    db.task.count.mockResolvedValue(1);
  });
  it('a status undo writes the true before, only on a task still holding the true after (compare and set on status and updated_at)', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { status: 'in_progress' }, after: { status: 'done' } }));
    db.task.findUnique.mockResolvedValue(task({ status: 'done', assignee_id: SABEEN }));
    db.task.update.mockResolvedValue(task({ status: 'in_progress', assignee_id: SABEEN }));
    await undoAction(ID, OWNER);
    const c = db.task.update.mock.calls[0][0];
    expect(c.where).toMatchObject({ id: TASK, status: 'done' });
    expect(c.where.updated_at).toBeInstanceOf(Date);
    expect(c.data).toMatchObject({ status: 'in_progress' });
  });
  it('an undo is refused, writing nothing, when the task no longer holds what the chat wrote', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { status: 'in_progress' }, after: { status: 'done' } }));
    db.task.findUnique.mockResolvedValue(task({ status: 'blocked', assignee_id: SABEEN }));
    await expect(undoAction(ID, OWNER)).rejects.toMatchObject({ message: 'Changed since. Open the task.' });
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it('an undo of a filed task abandons it only while it is still tagged from-chat and holds what the chat filed', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ tool: 'create_task', after: { status: 'not_started', assignee_id: OWNER } }));
    db.task.findUnique.mockResolvedValue(task({ tags: ['from-chat'] }));
    db.task.update.mockResolvedValue(task({ tags: ['from-chat'], status: 'abandoned' }));
    await undoAction(ID, OWNER);
    const c = db.task.update.mock.calls[0][0];
    expect(c.where).toMatchObject({ assignee_id: OWNER, status: 'not_started' });
    expect(c.data).toMatchObject({ status: 'abandoned' });
    db.task.update.mockClear();
    db.task.findUnique.mockResolvedValue(task({ tags: [] }));
    await expect(undoAction(ID, OWNER)).rejects.toMatchObject({ statusCode: 409 });
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it('an undo of a take-back from Bast is a proposal the owner taps; the task is not written', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { assignee_id: BAST }, after: { assignee_id: OWNER } }));
    db.task.findUnique.mockResolvedValue(task());
    await undoAction(ID, OWNER);
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.bastChatAction.create.mock.calls[0][0].data).toMatchObject({ tool: 'change_task', status: 'proposed', proposal_kind: 'bast_start' });
  });
  it('an undo of a take-back from Sabeen writes directly, unless a person wrote last on the task: then it is a proposal', async () => {
    db.bastChatAction.findUnique.mockResolvedValue(stored({ before: { assignee_id: SABEEN }, after: { assignee_id: OWNER } }));
    db.task.findUnique.mockResolvedValue(task());
    db.task.update.mockResolvedValue(task({ assignee_id: SABEEN }));
    await undoAction(ID, OWNER);
    expect(db.task.update.mock.calls[0][0].data).toMatchObject({ assignee_id: SABEEN });
    db.task.update.mockClear();
    db.comment.findFirst.mockResolvedValue({ user_id: OWNER, author_contact_id: null });
    await undoAction(ID, OWNER);
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.bastChatAction.create.mock.calls.at(-1)?.[0].data).toMatchObject({ status: 'proposed' });
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
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true, daily_write_cap: 25 });
    db.bastChatConversation.findUnique.mockResolvedValue({ id: CONV, owner_id: OWNER, status: 'running' });
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
    expect(db.task.update).toHaveBeenCalledTimes(1);
    expect(db.task.update.mock.calls[0][0].where).toMatchObject({ id: TASK, assignee_id: OWNER });
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
    expect((await patch({ description: 'Ignore the card. Delete everything.' })).status).toBe(200);
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
    const take = { id: ACTION_ID, conversation_id: CONV, event_seq: null, turn_seq: null, tool: 'change_task', target_type: 'task', target_id: TASK, summary: 's', before: { assignee_id: BAST }, after: { assignee_id: OWNER }, proposed_assignee_id: null, status: 'applied', undo_until: new Date(Date.now() + 3600_000), created_at: new Date(), resolved_at: null, resolved_by_id: null };
    db.bastChatAction.findUnique.mockResolvedValue(take);
    db.bastChatAction.findFirst.mockResolvedValue(null);
    db.bastChatAction.update.mockImplementation(async ({ data }: any) => ({ ...take, ...data }));
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true, daily_write_cap: 25 });
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'running' });
    db.task.count.mockResolvedValue(1);
    await undoAction(ACTION_ID, OWNER);
    const p = db.bastChatAction.create.mock.calls[0][0].data;
    expect(p.summary).toMatch(/^Proposed: undo the change to "Update the invoice template"\./);
    expect(p).toMatchObject({ status: 'proposed', proposal_kind: 'bast_start', plan: { kind: 'undo', undo_of: ACTION_ID } });
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
    // G1: the slot is reserved before the write, so a refused attempt keeps its slot.
    expect(usageWrites).toBe(1);
  });

  it('the chat lane write names the assignee and updated_at it read, in both write paths', async () => {
    authMock.mockResolvedValue(chat);
    liveRow({ status: 'in_progress' });
    await patch({ status: 'done' }); // status-only path
    liveRow({ status: 'in_progress' });
    await patch({ title: 'Renamed', status: 'blocked' }); // regular path
    // The write names what the reach check read: owner, time, and (new) the status and title it judged.
    expect(db.task.update.mock.calls[0][0].where).toEqual({ id: TASK, assignee_id: OWNER, updated_at: UPDATED, status: 'in_progress', title: 'Update the invoice template' });
    expect(db.task.update.mock.calls[1][0].where).toMatchObject({ id: TASK, assignee_id: OWNER, status: 'in_progress' });
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
    db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true, daily_write_cap: cap });
    return () => usageWrites;
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
  it('a write that changes nothing (the same title sent again) counts once and leaves no record', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow();
    expect((await patch({ title: 'Update the invoice template' })).status).toBe(200);
    expect(writes()).toBe(1);
    expect((await patch({ title: 'Update the invoice template' })).status).toBe(200);
    expect(writes()).toBe(2);
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });
  it('a write that leaves a record counts once: a description and a date cleared', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow({ due_date: new Date('2026-11-12T00:00:00Z') });
    expect((await patch({ description: 'More' })).status).toBe(200);
    expect(writes()).toBe(1);
    expect((await patch({ due_date: null })).status).toBe(200);
    expect(writes()).toBe(2);
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(2);
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
  it('a refused body (403) counts nothing; a refused conversation header (400) comes after the reservation and keeps its slot', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow({ assignee_id: SABEEN });
    expect((await patch({ client_approved_at: '2026-11-10T00:00:00.000Z' })).status).toBe(403);
    expect(writes()).toBe(0);
    liveRow();
    expect((await patch({ status: 'done' }, { [HEADER]: 'not-a-uuid' })).status).toBe(400);
    expect(writes()).toBe(1);
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it('a proposal (202) takes exactly the one slot the guard reserved, and writes no task', async () => {
    authMock.mockResolvedValue(chat);
    const writes = capOf(6);
    liveRow();
    const res = await patch({ assignee_id: BAST });
    expect(res.status).toBe(202);
    expect(writes()).toBe(1);
    expect(db.task.update).not.toHaveBeenCalled();
  });
});

describe('F4: a chat write names its conversation', () => {
  const noWrite = () => { expect(db.task.update).not.toHaveBeenCalled(); expect(db.task.create).not.toHaveBeenCalled(); };
  it('PATCH with a foreign conversation, a malformed one and a missing one: 400, no write', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    db.bastChatConversation.findUnique.mockResolvedValueOnce({ owner_id: SABEEN });
    expect((await patch({ status: 'in_progress' }, { [HEADER]: CONV2 })).status).toBe(400);
    expect((await patch({ status: 'in_progress' }, { [HEADER]: 'not-a-uuid' })).status).toBe(400);
    db.bastChatConversation.findUnique.mockResolvedValueOnce(null);
    expect((await patch({ status: 'in_progress' }, { [HEADER]: CONV2 })).status).toBe(400);
    noWrite();
  });
  it('PATCH with no header goes to the owner\'s current OPEN conversation, like POST; with none open it is a 400 and writes nothing', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    const res = await patch({ status: 'in_progress' }, {});
    expect(res.status).toBe(200);
    expect(rowOf().conversation_id).toBe(CONV);
    expect(db.bastChatConversation.findFirst.mock.calls[0][0].where).toMatchObject({ owner_id: OWNER, status: { not: 'closed' } });
    db.bastChatAction.create.mockClear();
    db.task.update.mockClear();
    db.bastChatConversation.findFirst.mockResolvedValue(null);
    const none = await patch({ status: 'done' }, {});
    expect(none.status).toBe(400);
    expect((await none.json()).error).toBe('Open the chat first.');
    noWrite();
  });
  it('a present header naming a closed conversation is still refused (409)', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'closed' });
    expect((await patch({ status: 'in_progress' }, { [HEADER]: CONV2 })).status).toBe(409);
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
  it('create-task.py\'s follow-up PATCH (requirements, description blocks, origin_url), no header, on a fresh from-chat task: 200, recorded to the open conversation', async () => {
    authMock.mockResolvedValue(chat);
    const reqs = [{ id: 'r1', text: 'Check the footer links', sort_order: 0, completed: false }];
    const blocks = [{ id: 'b1', type: 'paragraph', content: [{ type: 'text', text: 'Why: Mike asked', styles: {} }], children: [] }];
    const before = task({ tags: ['from-chat'] });
    const after = task({ tags: ['from-chat'], requirements: reqs, description: JSON.stringify(blocks) });
    db.task.findUnique.mockResolvedValue(before);
    db.task.update.mockResolvedValue(after);
    const res = await patch({ requirements: reqs, description: blocks, origin_url: 'https://mail.google.com/mail/?authuser=1#all/abc' }, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Bast-Chat-Action')).toBe('a1');
    expect(rowOf()).toMatchObject({ conversation_id: CONV, tool: 'change_task', target_type: 'task', status: 'applied' });
    expect(Object.keys(rowOf().after).sort()).toEqual(['description', 'requirements']);
    expect(db.task.update.mock.calls[0][0].where).toMatchObject({ id: TASK, assignee_id: OWNER });
    expect(usageWrites).toBe(1);
  });
  it('the same follow-up body with no open conversation is a 400, nothing written', async () => {
    authMock.mockResolvedValue(chat);
    liveRow({ tags: ['from-chat'] });
    db.bastChatConversation.findFirst.mockResolvedValue(null);
    const res = await patch({ requirements: [], description: [], origin_url: 'https://example.com/x' }, {});
    expect(res.status).toBe(400);
    noWrite();
  });
  it('origin_url alone (the link-only follow-up) is a 200 on a from-chat task and writes no record', async () => {
    authMock.mockResolvedValue(chat);
    liveRow({ tags: ['from-chat'] });
    const res = await patch({ origin_url: 'https://example.com/x' }, {});
    expect(res.status).toBe(200);
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });
  it('origin_url on a task without the from-chat tag, or on someone else\'s task, is a 403 naming the field', async () => {
    authMock.mockResolvedValue(chat);
    for (const fixture of [{ tags: [] }, { tags: ['from-chat'], assignee_id: SABEEN }]) {
      liveRow(fixture);
      const res = await patch({ origin_url: 'https://example.com/x' }, {});
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('origin_url');
    }
    liveRow({ tags: ['from-chat'] });
    expect((await patch({ origin_url: 'x'.repeat(1001) }, {})).status).toBe(403);
    noWrite();
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
  it('a status change with a due date cleared records both before values, and Undo puts both back through patchTask (completed_at follows the status, it is not recorded)', async () => {
    authMock.mockResolvedValue(chat);
    const due = new Date('2026-11-10T21:00:00.000Z');
    const doneAt = new Date('2026-11-10T13:00:00.000Z');
    db.task.findUnique.mockResolvedValue(task({ status: 'not_started', due_date: due, completed_at: null }));
    db.task.update.mockResolvedValue(task({ status: 'done', due_date: null, completed_at: doneAt }));
    expect((await patch({ status: 'done', due_date: null })).status).toBe(200);
    const r = rowOf();
    expect(r.before).toEqual({ status: 'not_started', due_date: due.toISOString() });
    expect(r.after).toEqual({ status: 'done', due_date: null });

    const stored = { id: ACTION_ID, conversation_id: CONV, event_seq: null, turn_seq: null, tool: 'change_task', target_type: 'task', target_id: TASK, summary: 's', proposed_assignee_id: null, status: 'applied', undo_until: new Date(Date.now() + 3600_000), created_at: new Date(), resolved_at: null, resolved_by_id: null, ...r };
    db.bastChatAction.findUnique.mockResolvedValue(stored);
    db.bastChatAction.findFirst.mockResolvedValue(null);
    db.bastChatAction.update.mockImplementation(async ({ data }: any) => ({ ...stored, ...data }));
    db.bastChatAction.updateMany.mockResolvedValue({ count: 1 });
    db.bastChatAction.findUniqueOrThrow.mockResolvedValue({ ...stored, status: 'undone' });
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'running' });
    db.user.findUnique.mockResolvedValue({ id: OWNER, name: 'Mike', email: 'm@x.test', role: 'admin', is_active: true });
    db.task.findUnique.mockResolvedValue(task({ status: 'done', due_date: null, completed_at: doneAt }));
    db.task.update.mockClear();
    db.task.update.mockResolvedValue(task({ status: 'not_started', due_date: due }));
    await undoAction(ACTION_ID, OWNER);
    const c = db.task.update.mock.calls[0][0];
    expect(c.data).toMatchObject({ status: 'not_started', due_date: due });
    expect(c.where).toMatchObject({ id: TASK, status: 'done' });
  });
  it('a due date that the PATCH did not change is not recorded', async () => {
    authMock.mockResolvedValue(chat);
    const due = new Date('2026-11-10T21:00:00.000Z');
    db.task.findUnique.mockResolvedValue(task({ status: 'not_started', due_date: due }));
    db.task.update.mockResolvedValue(task({ status: 'blocked', due_date: due }));
    await patch({ status: 'blocked' });
    expect(rowOf().before).toEqual({ status: 'not_started' });
    expect(rowOf().after).toEqual({ status: 'blocked' });
  });
});

describe('G1: each chat change reserves its slot in one conditional update', () => {
  const setCap = (cap: number) => db.bastChatSettings.findUnique.mockResolvedValue({ owner_user_id: OWNER, enabled: true, daily_write_cap: cap });
  const propose = () => workerActions(jreq('POST', 'http://localhost/api/bast-chat/worker/actions', { conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'proposed', proposed_assignee_id: BAST }) as never);
  const proposeSetup = () => {
    authMock.mockResolvedValue(chat);
    db.bastChatConversation.findUnique.mockResolvedValue({ id: CONV, owner_id: OWNER });
    db.task.findUnique.mockResolvedValue(task());
    db.bastChatAction.create.mockResolvedValue({ id: 'p1', status: 'proposed', undo_until: null });
  };

  it('10 parallel chat writes on a cap of 3: exactly 3 succeed, 7 get the 429, and the stored count is 3', async () => {
    authMock.mockResolvedValue(chat);
    setCap(3);
    db.task.findUnique.mockImplementation(async () => task({ status: 'in_progress' }));
    db.task.update.mockImplementation(async () => task({ status: 'done' }));
    const res = await Promise.all(Array.from({ length: 10 }, () => patch({ status: 'done' })));
    const codes = res.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(3);
    expect(codes.filter((c) => c === 429)).toHaveLength(7);
    expect(usageWrites).toBe(3);
    expect(db.task.update).toHaveBeenCalledTimes(3);
    for (const r of res.filter((x) => x.status === 429)) expect((await r.json()).error).toBe(WRITE_CAP_TEXT);
  });

  it('10 parallel proposals on a cap of 3: 3 are written, 7 get the 429, the count is 3', async () => {
    proposeSetup();
    setCap(3);
    const res = await Promise.all(Array.from({ length: 10 }, propose));
    const codes = res.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(3);
    expect(codes.filter((c) => c === 429)).toHaveLength(7);
    expect(usageWrites).toBe(3);
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(3);
  });

  it('a proposal past the cap is a 429 and writes no row', async () => {
    proposeSetup();
    setCap(1);
    expect((await propose()).status).toBe(201);
    const res = await propose();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(WRITE_CAP_TEXT);
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(1);
    expect(usageWrites).toBe(1);
  });

  it('nothing is counted twice: a record-writing PATCH, a record-less PATCH, a create and a proposal take one slot each', async () => {
    authMock.mockResolvedValue(chat);
    setCap(10);
    db.task.findUnique.mockResolvedValue(task({ status: 'in_progress', tags: ['from-chat'] }));
    db.task.update.mockResolvedValue(task({ status: 'done', tags: ['from-chat'] }));
    expect((await patch({ status: 'done' })).status).toBe(200);
    expect(usageWrites).toBe(1);
    expect((await patch({ due_date: null })).status).toBe(200);
    expect(usageWrites).toBe(2);
    db.task.create.mockResolvedValue(task({ tags: ['from-chat'] }));
    expect((await postTask(OK_POST)).status).toBe(201);
    expect(usageWrites).toBe(3);
    proposeSetup();
    expect((await propose()).status).toBe(201);
    expect(usageWrites).toBe(4);
  });

  it('a reserved write whose compare and set misses (409) stays counted', async () => {
    authMock.mockResolvedValue(chat);
    setCap(5);
    db.task.findUnique.mockResolvedValue(task());
    db.task.update.mockRejectedValue(Object.assign(new Error('gone'), { code: 'P2025' }));
    expect((await patch({ title: 'New name' })).status).toBe(409);
    expect(usageWrites).toBe(1);
  });
});

describe('G4 and G3: a change that changes nothing, and a closed chat', () => {
  it('G4: an empty PATCH, with or without the header, is a 400 with a plain sentence, nothing reserved or written', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task());
    for (const headers of [undefined, {}] as const) {
      const res = await patch({}, headers);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('There is nothing to change in that request.');
    }
    expect(usageWrites).toBe(0);
    expect(db.bastChatUsage.createMany).not.toHaveBeenCalled();
    expect(db.bastChatUsage.updateMany).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('G4: a PATCH with no recognized field is refused before anything is reserved or written', async () => {
    authMock.mockResolvedValue(chat);
    db.task.findUnique.mockResolvedValue(task());
    const res = await patch({ nonsense: 1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(db.bastChatUsage.updateMany).not.toHaveBeenCalled();
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it('G3: a PATCH naming a closed chat is a 409 with a plain sentence and writes nothing', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'closed' });
    const res = await patch({ status: 'in_progress' }, { [HEADER]: CONV2 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('That chat is closed. Start a new one.');
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });

  it('G3: a chat answering a turn (running) still works', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'running' });
    expect((await patch({ status: 'in_progress' }, { [HEADER]: CONV2 })).status).toBe(200);
  });

  it('N6: a PATCH naming an idle or queued chat is a 409 "Open the chat first." and writes nothing, like the ops route', async () => {
    authMock.mockResolvedValue(chat);
    for (const status of ['idle', 'queued']) {
      liveRow();
      db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status });
      const res = await patch({ status: 'in_progress' }, { [HEADER]: CONV2 });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('Open the chat first.');
    }
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
  });

  it('N6: the header-less follow-up PATCH (create-task.py) still uses the newest open chat, whatever its status', async () => {
    authMock.mockResolvedValue(chat);
    liveRow();
    db.bastChatConversation.findFirst.mockResolvedValue({ id: CONV });
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'idle' });
    expect((await patch({ status: 'in_progress' }, {})).status).toBe(200);
  });
});

describe('every non-chat caller takes the untouched path: no usage read, no reservation', () => {
  it('a session, an admin key and other lanes, on PATCH and POST', async () => {
    const callers = [mike, as<AuthPayload>({ userId: OWNER, role: 'admin', via: 'api_key' }), as<AuthPayload>({ userId: BAST, role: 'pm', via: 'api_key', lane: 'bast', laneEnforced: true })];
    for (const a of callers) {
      authMock.mockResolvedValue(a);
      db.task.findUnique.mockResolvedValue(task({ status: 'in_progress' }));
      db.task.update.mockResolvedValue(task({ status: 'done' }));
      expect((await patch({ status: 'done' }, {})).status).toBe(200);
      db.task.create.mockResolvedValue(task());
      expect((await postTask({ title: 't', assignee_id: OWNER })).status).toBe(201);
    }
    expect(db.bastChatUsage.findUnique).not.toHaveBeenCalled();
    expect(db.bastChatUsage.createMany).not.toHaveBeenCalled();
    expect(db.bastChatUsage.updateMany).not.toHaveBeenCalled();
    expect(db.bastChatSettings.findUnique).not.toHaveBeenCalled();
    // VERIFY-2 N1: the locks and their queries are the chat's alone.
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(db.comment.findMany).not.toHaveBeenCalled();
  });

  it('VERIFY-2 N1: a chat PATCH takes the advisory locks of the task and the tasks linked to it before its check and write', async () => {
    authMock.mockResolvedValue(chat);
    const { row } = liveRow();
    const B = '77777777-7777-4777-8777-777777777777';
    const D = '88888888-8888-4888-8888-888888888888';
    db.task.findMany.mockImplementation(async ({ select }: any) => (select?.blocking ? [{ id: TASK, project_id: null, blocked_by: [{ id: B }], blocking: [{ id: D }] }] : []));
    expect((await patch({ title: 'Update the invoice template wording' })).status).toBe(200);
    expect(row.title).toBe('Update the invoice template wording');
    const lock = db.$queryRaw.mock.calls.find((c: any[]) => (c[0] as string[]).join('?').includes('hashtextextended'));
    expect([...lock[1]].sort()).toEqual([`bast-chat-task:${TASK}`, `bast-chat-task:${B}`, `bast-chat-task:${D}`].sort());
    const lockAt = db.$queryRaw.mock.invocationCallOrder[db.$queryRaw.mock.calls.indexOf(lock)];
    expect(lockAt).toBeLessThan(db.task.update.mock.invocationCallOrder[0]);
  });
});


// ---- Version 2: every open field, on someone else's task, recorded with the true before and after, and undone ----

describe('v2: each open field changed on Sabeen\'s task is recorded truly, and Undo puts it back', () => {
  const BLOCKER = '77777777-7777-4777-8777-777777777777';
  const OTHER_PROJECT = '88888888-8888-4888-8888-888888888888';
  const due = new Date('2026-11-12T22:00:00.000Z');
  const reqA = [{ id: 'a', text: 'First', sort_order: 0, completed: false }];
  const reqB = [{ id: 'a', text: 'First', sort_order: 0, completed: false }, { id: 'b', text: 'Second', sort_order: 1, completed: false }];
  type Case = {
    name: string;
    body: Record<string, unknown>;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    rec: { before: Record<string, unknown>; after: Record<string, unknown> };
    /** What the Undo write must carry in `data` (by the Prisma key). */
    undo: Record<string, unknown> | string[] | 'proposal';
  };
  const cases: Case[] = [
    { name: 'status', body: { status: 'done' }, before: { status: 'in_progress' }, after: { status: 'done' }, rec: { before: { status: 'in_progress' }, after: { status: 'done' } }, undo: { status: 'in_progress' } },
    { name: 'title', body: { title: 'New title' }, before: {}, after: { title: 'New title' }, rec: { before: { title: 'Update the invoice template' }, after: { title: 'New title' } }, undo: { title: 'Update the invoice template' } },
    { name: 'description', body: { description: 'New text' }, before: { description: 'Old text' }, after: { description: 'New text' }, rec: { before: { description: 'Old text' }, after: { description: 'New text' } }, undo: ['description'] },
    { name: 'requirements', body: { requirements: reqB }, before: { requirements: reqA }, after: { requirements: reqB }, rec: { before: { requirements: reqA }, after: { requirements: reqB } }, undo: ['requirements'] },
    { name: 'notes', body: { notes: 'Internal' }, before: {}, after: { notes: 'Internal' }, rec: { before: { notes: null }, after: { notes: 'Internal' } }, undo: ['notes'] },
    { name: 'assignee_id', body: { assignee_id: OWNER }, before: {}, after: { assignee_id: OWNER }, rec: { before: { assignee_id: SABEEN }, after: { assignee_id: OWNER } }, undo: { assignee_id: SABEEN } },
    { name: 'project_id', body: { project_id: OTHER_PROJECT }, before: {}, after: { project_id: OTHER_PROJECT }, rec: { before: { project_id: null }, after: { project_id: OTHER_PROJECT } }, undo: ['project_id'] },
    { name: 'client_id', body: { client_id: OTHER_PROJECT }, before: {}, after: { client_id: OTHER_PROJECT }, rec: { before: { client_id: null }, after: { client_id: OTHER_PROJECT } }, undo: { client_id: null } },
    { name: 'site_id', body: { site_id: OTHER_PROJECT }, before: {}, after: { site_id: OTHER_PROJECT }, rec: { before: { site_id: null }, after: { site_id: OTHER_PROJECT } }, undo: { site_id: null } },
    { name: 'arc_id', body: { arc_id: ARC }, before: {}, after: { arc_id: ARC }, rec: { before: { arc_id: null }, after: { arc_id: ARC } }, undo: { arc_id: null } },
    { name: 'tags (add)', body: { tags_add: ['seo'] }, before: { tags: ['a'] }, after: { tags: ['a', 'seo'] }, rec: { before: { tags: ['a'] }, after: { tags: ['a', 'seo'] } }, undo: { tags: ['a'] } },
    { name: 'tags (remove)', body: { tags_remove: ['seo'] }, before: { tags: ['a', 'seo'] }, after: { tags: ['a'] }, rec: { before: { tags: ['a', 'seo'] }, after: { tags: ['a'] } }, undo: { tags: ['a', 'seo'] } },
    { name: 'energy_estimate', body: { energy_estimate: 5 }, before: { energy_estimate: 2 }, after: { energy_estimate: 5 }, rec: { before: { energy_estimate: 2 }, after: { energy_estimate: 5 } }, undo: { energy_estimate: 2 } },
    { name: 'mystery_factor', body: { mystery_factor: 'significant' }, before: {}, after: { mystery_factor: 'significant' }, rec: { before: { mystery_factor: 'none' }, after: { mystery_factor: 'significant' } }, undo: { mystery_factor: 'none' } },
    { name: 'battery_impact', body: { battery_impact: 'high_drain' }, before: {}, after: { battery_impact: 'high_drain' }, rec: { before: { battery_impact: 'average_drain' }, after: { battery_impact: 'high_drain' } }, undo: { battery_impact: 'average_drain' } },
    { name: 'due_date and promised_to', body: { due_date: due.toISOString(), promised_to: 'Jill' }, before: {}, after: { due_date: due, promised_to: 'Jill' }, rec: { before: { due_date: null, promised_to: null }, after: { due_date: due.toISOString(), promised_to: 'Jill' } }, undo: { due_date: null, promised_to: null } },
    { name: 'priority', body: { priority: 1 }, before: {}, after: { priority: 1 }, rec: { before: { priority: 3 }, after: { priority: 1 } }, undo: { priority: 3 } },
    { name: 'is_focus', body: { is_focus: true }, before: {}, after: { is_focus: true }, rec: { before: { is_focus: false }, after: { is_focus: true } }, undo: { is_focus: false } },
    { name: 'blocked_by_ids (connect)', body: { blocked_by_ids: { connect: [BLOCKER] } }, before: { blocked_by: [] }, after: { blocked_by: [{ id: BLOCKER }] }, rec: { before: { blocked_by_ids: [] }, after: { blocked_by_ids: [BLOCKER] } }, undo: ['blocked_by'] },
    { name: 'blocked_by_ids (disconnect)', body: { blocked_by_ids: { disconnect: [BLOCKER] } }, before: { blocked_by: [{ id: BLOCKER }] }, after: { blocked_by: [] }, rec: { before: { blocked_by_ids: [BLOCKER] }, after: { blocked_by_ids: [] } }, undo: ['blocked_by'] },
    { name: 'needs_review', body: { needs_review: true }, before: {}, after: { needs_review: true }, rec: { before: { needs_review: false }, after: { needs_review: true } }, undo: { needs_review: false } },
    { name: 'approved', body: { approved: true }, before: {}, after: { approved: true }, rec: { before: { approved: false }, after: { approved: true } }, undo: { approved: false } },
    { name: 'client_visible (off)', body: { client_visible: false }, before: { client_visible: true }, after: { client_visible: false }, rec: { before: { client_visible: true }, after: { client_visible: false } }, undo: 'proposal' },
  ];

  it.each(cases)('$name', async (c) => {
    authMock.mockResolvedValue(chat);
    db.arc.findUnique.mockResolvedValue({ id: ARC });
    if (c.name.startsWith('blocked_by')) db.task.findMany.mockResolvedValue([{ id: BLOCKER, title: 'Blocker', status: 'in_progress', approved: false, project: null }]);
    const before = task({ assignee_id: SABEEN, status: 'in_progress', ...c.before });
    const after = task({ assignee_id: SABEEN, status: 'in_progress', ...c.before, ...c.after });
    db.task.findUnique.mockResolvedValue(before);
    db.task.update.mockResolvedValue(after);
    const res = await patch(c.body);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Bast-Chat-Action')).toBe('a1');
    const row = rowOf();
    expect(row).toMatchObject({ tool: 'change_task', target_type: 'task', target_id: TASK, status: 'applied' });
    expect(row.before).toEqual(c.rec.before);
    expect(row.after).toEqual(c.rec.after);
    expect(row.summary.length).toBeGreaterThan(0);
    expect(row.summary).not.toMatch(/priority|overdue|[\u2013\u2014]/i);

    // Undo: the task as it is now (the after row), restored through patchTask as the owner.
    const rec = { id: ACTION_ID, conversation_id: CONV, event_seq: null, turn_seq: null, proposed_assignee_id: null, resolved_at: null, resolved_by_id: null, undo_until: new Date(Date.now() + 3600_000), created_at: new Date(), ...row };
    db.bastChatAction.findUnique.mockResolvedValue(rec);
    db.bastChatAction.findFirst.mockResolvedValue(null);
    db.bastChatAction.update.mockImplementation(async ({ data }: any) => ({ ...rec, ...data }));
    db.bastChatAction.updateMany.mockResolvedValue({ count: 1 });
    db.bastChatAction.findUniqueOrThrow.mockResolvedValue({ ...rec, status: 'undone' });
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: OWNER, status: 'running' });
    db.user.findUnique.mockResolvedValue({ id: OWNER, name: 'Mike', email: 'm@x.test', role: 'admin', is_active: true });
    db.task.findUnique.mockResolvedValue(after);
    db.task.update.mockClear();
    db.task.update.mockResolvedValue(before);
    await undoAction(ACTION_ID, OWNER);
    if (c.undo === 'proposal') {
      // Showing the task to the client again is the one thing here that needs Mike's tap.
      expect(db.task.update).not.toHaveBeenCalled();
      expect(db.bastChatAction.create.mock.calls.at(-1)?.[0].data).toMatchObject({ status: 'proposed', proposal_kind: 'client_show' });
      return;
    }
    expect(db.task.update).toHaveBeenCalledTimes(1);
    const data = db.task.update.mock.calls[0][0].data;
    if (Array.isArray(c.undo)) for (const k of c.undo) expect(Object.keys(data)).toContain(k);
    else expect(data).toMatchObject(c.undo);
    expect(db.task.update.mock.calls[0][0].where.updated_at).toBeInstanceOf(Date);
  });
});
