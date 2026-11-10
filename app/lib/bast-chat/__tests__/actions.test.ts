/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { CHANGED_SINCE_TEXT, declineAction, recordAction, releaseAction, undoAction } from '../actions';

const OWNER = 'o1111111-1111-4111-8111-111111111111';
const CONV = 'c1111111-1111-4111-8111-111111111111';
const TASK = '11111111-1111-4111-8111-111111111111';
const BAST = '22222222-2222-4222-8222-222222222222';
const ARC = '33333333-3333-4333-8333-333333333333';
const ACTION = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-10T12:00:00Z');

function makeDb(action: Record<string, unknown> | null, o: { taskCount?: number; claimCount?: number; assignee?: unknown } = {}) {
  const state = { action: action ? { id: ACTION, conversation_id: CONV, event_seq: 1, tool: 'update_task', target_id: TASK, summary: 's', before: null, after: null, proposed_assignee_id: null, status: 'applied', undo_until: new Date(NOW.getTime() + 3600_000), created_at: NOW, ...action } : null } as { action: any };
  const db: any = {
    state,
    bastChatAction: {
      create: vi.fn(async ({ data }: any) => ({ id: ACTION, status: data.status, undo_until: data.undo_until })),
      findUnique: vi.fn(async () => state.action),
      findUniqueOrThrow: vi.fn(async () => state.action),
      update: vi.fn(async ({ data }: any) => { Object.assign(state.action, data); return state.action; }),
      updateMany: vi.fn(async ({ data }: any) => { if ((o.claimCount ?? 1) === 1) Object.assign(state.action, data); return { count: o.claimCount ?? 1 }; }),
    },
    bastChatConversation: { findUnique: vi.fn(async () => ({ owner_id: OWNER })) },
    task: { updateMany: vi.fn(async () => ({ count: o.taskCount ?? 1 })) },
    user: { findUnique: vi.fn(async () => (o.assignee === undefined ? { id: BAST, is_active: true } : o.assignee)) },
    bastChatUsage: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

describe('recordAction', () => {
  const valid = { conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'Closed it — done', before: { status: 'in_progress' }, after: { status: 'done' } };
  it('records an applied write with a 24 hour undo and counts one write', async () => {
    const db = makeDb(null);
    const r = await recordAction(valid, OWNER, NOW, db);
    expect(r.undo_until).toEqual(new Date(NOW.getTime() + 24 * 3600_000));
    const data = db.bastChatAction.create.mock.calls[0][0].data;
    expect(data.summary).toBe('Closed it, done');
    expect(data.before).toEqual({ status: 'in_progress' });
    expect(db.bastChatUsage.upsert).toHaveBeenCalledTimes(1);
  });
  it('rejects fields outside the allowlist, an unknown tool and a bad status value', async () => {
    const db = makeDb(null);
    await expect(recordAction({ ...valid, before: { client_approved_at: 'x' } }, OWNER, NOW, db)).rejects.toThrow();
    await expect(recordAction({ ...valid, after: { status: 'published' } }, OWNER, NOW, db)).rejects.toThrow();
    await expect(recordAction({ ...valid, tool: 'delete_task' }, OWNER, NOW, db)).rejects.toThrow();
    await expect(recordAction({ ...valid, extra: 1 }, OWNER, NOW, db)).rejects.toThrow();
  });
  it('a proposal needs a person and cannot be applied; a handoff is never applied', async () => {
    const db = makeDb(null);
    await expect(recordAction({ ...valid, tool: 'propose_handoff', status: 'proposed' }, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 400 });
    await expect(recordAction({ ...valid, tool: 'propose_handoff', status: 'applied' }, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 400 });
    const ok = await recordAction({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, summary: 'Hand to Bast?', status: 'proposed', proposed_assignee_id: BAST }, OWNER, NOW, db);
    expect(ok.undo_until).toBeNull();
    expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
  });
  it('404 for a conversation that is not the owner own', async () => {
    const db = makeDb(null);
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: 'someone-else' });
    await expect(recordAction(valid, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('undoAction', () => {
  it('restores the before values with a compare and set on the recorded after', async () => {
    const db = makeDb({ before: { status: 'in_progress', title: 'Old' }, after: { status: 'done' } });
    const v = await undoAction(ACTION, OWNER, NOW, db);
    const call = db.task.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: TASK, status: 'done' });
    expect(call.data).toEqual({ status: 'in_progress' });
    expect(v.status).toBe('undone');
  });
  it('refuses with Changed since when the task no longer holds the recorded value', async () => {
    const db = makeDb({ before: { status: 'in_progress' }, after: { status: 'done' } }, { taskCount: 0 });
    await expect(undoAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 409, message: CHANGED_SINCE_TEXT });
    expect(db.state.action.status).toBe('applied');
  });
  it('refuses after the window, twice, and for a proposal', async () => {
    await expect(undoAction(ACTION, OWNER, NOW, makeDb({ before: { status: 'a' }, after: { status: 'done' }, undo_until: new Date(NOW.getTime() - 1) }))).rejects.toMatchObject({ code: 'undo_expired' });
    await expect(undoAction(ACTION, OWNER, NOW, makeDb({ status: 'undone' }))).rejects.toMatchObject({ code: 'undo_used' });
    await expect(undoAction(ACTION, OWNER, NOW, makeDb({ status: 'proposed' }))).rejects.toMatchObject({ code: 'not_undoable' });
  });
  it('undoes a created task by marking it abandoned, not by deleting it', async () => {
    const db = makeDb({ tool: 'create_task', before: null, after: { status: 'not_started', assignee_id: OWNER } });
    await undoAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].data).toEqual({ status: 'abandoned' });
    expect(db.task.delete).toBeUndefined();
  });
  it('undoes an arc change by restoring the arc', async () => {
    const db = makeDb({ tool: 'add_to_arc', before: { arc_id: null }, after: { arc_id: ARC } });
    await undoAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].data).toEqual({ arc_id: null });
  });
  it('404 for another owner chat', async () => {
    const db = makeDb({ before: { status: 'a' }, after: { status: 'done' } });
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: 'x' });
    await expect(undoAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('release and decline', () => {
  const proposal = { tool: 'propose_handoff', status: 'proposed', proposed_assignee_id: BAST, undo_until: null };
  it('release reassigns the task to the proposed person under the caller id and marks it released', async () => {
    const db = makeDb(proposal);
    const v = await releaseAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].data).toEqual({ assignee_id: BAST });
    expect(v.status).toBe('released');
    expect(db.state.action.resolved_by_id).toBe(OWNER);
  });
  it('release refuses an action that is not a waiting proposal, and a double tap has one winner', async () => {
    await expect(releaseAction(ACTION, OWNER, NOW, makeDb({ status: 'applied' }))).rejects.toMatchObject({ code: 'not_proposed' });
    await expect(releaseAction(ACTION, OWNER, NOW, makeDb({ status: 'released', proposed_assignee_id: BAST }))).rejects.toMatchObject({ code: 'not_proposed' });
    const db = makeDb(proposal, { claimCount: 0 });
    await expect(releaseAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ code: 'not_proposed' });
    expect(db.task.updateMany).not.toHaveBeenCalled();
  });
  it('release refuses an inactive or missing person and a missing task', async () => {
    await expect(releaseAction(ACTION, OWNER, NOW, makeDb(proposal, { assignee: { id: BAST, is_active: false } }))).rejects.toMatchObject({ code: 'assignee_unavailable' });
    await expect(releaseAction(ACTION, OWNER, NOW, makeDb(proposal, { assignee: null }))).rejects.toMatchObject({ code: 'assignee_unavailable' });
    await expect(releaseAction(ACTION, OWNER, NOW, makeDb(proposal, { taskCount: 0 }))).rejects.toMatchObject({ code: 'task_missing' });
  });
  it('decline leaves the task alone', async () => {
    const db = makeDb(proposal);
    const v = await declineAction(ACTION, OWNER, NOW, db);
    expect(v.status).toBe('declined');
    expect(db.task.updateMany).not.toHaveBeenCalled();
    await expect(declineAction(ACTION, OWNER, NOW, makeDb({ status: 'applied' }))).rejects.toMatchObject({ code: 'not_proposed' });
  });
  it('another owner chat is a 404 for both', async () => {
    const db = makeDb(proposal);
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: 'x' });
    await expect(releaseAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 404 });
    await expect(declineAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 404 });
  });
});
