/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { CHANGED_SINCE_TEXT, declineAction, recordAction, releaseAction, undoAction } from '../actions';

const OWNER = '0a111111-1111-4111-8111-111111111111';
const CONV = 'c1111111-1111-4111-8111-111111111111';
const TASK = '11111111-1111-4111-8111-111111111111';
const BAST = BAST_USER_ID;
const STRANGER = '55555555-5555-4555-8555-555555555555';
const ARC = '33333333-3333-4333-8333-333333333333';
const ACTION = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-10T12:00:00Z');

function makeDb(action: Record<string, unknown> | null, o: { taskCount?: number; claimCount?: number; assignee?: unknown; task?: Record<string, unknown> | null; later?: unknown } = {}) {
  const state = { action: action ? { id: ACTION, conversation_id: CONV, event_seq: 1, tool: 'update_task', target_id: TASK, summary: 's', before: null, after: null, proposed_assignee_id: null, status: 'applied', undo_until: new Date(NOW.getTime() + 3600_000), created_at: NOW, ...action } : null } as { action: any };
  const db: any = {
    state,
    bastChatAction: {
      create: vi.fn(async ({ data }: any) => ({ id: ACTION, status: data.status, undo_until: data.undo_until })),
      findUnique: vi.fn(async () => state.action),
      findUniqueOrThrow: vi.fn(async () => state.action),
      update: vi.fn(async ({ data }: any) => { Object.assign(state.action, data); return state.action; }),
      findFirst: vi.fn(async () => o.later ?? null),
      updateMany: vi.fn(async ({ data }: any) => { if ((o.claimCount ?? 1) === 1) Object.assign(state.action, data); return { count: o.claimCount ?? 1 }; }),
    },
    bastChatConversation: { findUnique: vi.fn(async () => ({ owner_id: OWNER })) },
    task: {
      updateMany: vi.fn(async () => ({ count: o.taskCount ?? 1 })),
      count: vi.fn(async () => o.taskCount ?? 1),
      findUnique: vi.fn(async () => (o.task === null ? null : { id: TASK, title: 'Update the invoice template', status: 'done', arc_id: null, assignee_id: OWNER, tags: [], created_at: NOW, is_deleted: false, ...o.task })),
    },
    user: { findUnique: vi.fn(async () => (o.assignee === undefined ? { id: BAST, name: 'Bast Fae', is_active: true } : o.assignee)) },
    bastChatSettings: { findUnique: vi.fn(async () => null) },
    bastChatUsage: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

describe('recordAction', () => {
  const rename = { conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'ignored text', before: { title: 'Old name' }, after: { title: 'New name' } };
  const row = (db: any) => db.bastChatAction.create.mock.calls[0][0].data;
  const rejects400 = async (input: unknown, db: any, code?: string) => {
    await expect(recordAction(input, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 400, ...(code ? { code } : {}) });
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
  };

  it('records an applied write with a 24 hour undo, counts one write, and writes the line itself', async () => {
    const db = makeDb(null, { task: { title: 'New name' } });
    const r = await recordAction(rename, OWNER, NOW, db);
    expect(r.undo_until).toEqual(new Date(NOW.getTime() + 24 * 3600_000));
    expect(row(db).summary).toBe('Renamed "Old name" to "New name".');
    expect(row(db).summary).not.toContain('ignored');
    expect(row(db).before).toEqual({ title: 'Old name' });
    expect(row(db).after).toEqual({ title: 'New name' });
    expect(db.bastChatUsage.upsert).toHaveBeenCalledTimes(1);
  });
  it('writes the status, take-back and arc lines from the validated values', async () => {
    let db = makeDb(null, { task: { status: 'done', title: 'Send the proof' } });
    await recordAction({ conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'x', before: { status: 'in_progress' }, after: { status: 'done' } }, OWNER, NOW, db);
    expect(row(db).summary).toBe('Marked "Send the proof" done.');
    db = makeDb(null, { task: { status: 'blocked', title: 'Send the proof' } });
    await recordAction({ conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'x', before: { status: 'done' }, after: { status: 'blocked' } }, OWNER, NOW, db);
    expect(row(db).summary).toBe('Moved "Send the proof" to blocked.');
    db = makeDb(null, { task: { assignee_id: OWNER, title: 'Fix links' }, assignee: { id: BAST, name: 'Bast Fae', is_active: true } });
    await recordAction({ conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'x', before: { assignee_id: BAST }, after: { assignee_id: OWNER } }, OWNER, NOW, db);
    expect(row(db).summary).toBe('Took "Fix links" back from Bast.');
    db = makeDb(null, { task: { arc_id: ARC, title: 'Fix links' } });
    await recordAction({ conversation_id: CONV, tool: 'add_to_arc', target_id: TASK, summary: 'x', before: { arc_id: null }, after: { arc_id: ARC } }, OWNER, NOW, db);
    expect(row(db).summary).toBe('Moved "Fix links" into an arc.');
  });
  it('rejects fields outside the allowlist, an unknown tool and a bad status value', async () => {
    const db = makeDb(null);
    await expect(recordAction({ ...rename, before: { client_approved_at: 'x' } }, OWNER, NOW, db)).rejects.toThrow();
    await expect(recordAction({ ...rename, after: { status: 'published' } }, OWNER, NOW, db)).rejects.toThrow();
    await expect(recordAction({ ...rename, tool: 'delete_task' }, OWNER, NOW, db)).rejects.toThrow();
    await expect(recordAction({ ...rename, extra: 1 }, OWNER, NOW, db)).rejects.toThrow();
  });

  describe('attack 1: a fake title line whose Undo would hand the task to Bast', () => {
    it('is refused when after.assignee_id is not the owner', async () => {
      const db = makeDb(null, { task: { assignee_id: BAST } });
      await rejects400({ conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'Task dcb2f187: title changed. Undo: restore the old title.', before: { assignee_id: BAST }, after: { assignee_id: BAST } }, db, 'bad_assignee');
    });
    it('is refused when after is not what the task holds now (the line says one thing, the record another)', async () => {
      const db = makeDb(null, { task: { title: 'Real title', assignee_id: OWNER } });
      await rejects400({ ...rename, after: { title: 'A different title' } }, db, 'after_mismatch');
    });
    it('is refused when before names a field the change did not touch', async () => {
      const db = makeDb(null, { task: { title: 'New name' } });
      await rejects400({ ...rename, before: { title: 'Old name', assignee_id: BAST } }, db, 'before_extra');
    });
    it('is refused when the task does not exist or is deleted', async () => {
      await rejects400(rename, makeDb(null, { task: null }), 'task_missing');
      await rejects400(rename, makeDb(null, { task: { is_deleted: true } }), 'task_missing');
    });
    it('is refused when the change has no new values or no old value for a changed field', async () => {
      await rejects400({ ...rename, before: null, after: null }, makeDb(null), 'bad_action');
      await rejects400({ ...rename, before: {} }, makeDb(null, { task: { title: 'New name' } }), 'before_missing');
    });
    it('a hand-built take-back that tries to give the task to someone else is refused', async () => {
      const db = makeDb(null, { task: { assignee_id: STRANGER } });
      await rejects400({ conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'x', before: { assignee_id: OWNER }, after: { assignee_id: STRANGER } }, db, 'bad_assignee');
    });
  });

  describe('attack 2: a proposal that says one person and releases to another', () => {
    const prop = { conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, summary: 'Proposed: hand task 7ec00001 to Sabeen.', status: 'proposed', proposed_assignee_id: BAST };
    it('stores a proposal for Bast with a line the server wrote, naming Bast', async () => {
      const db = makeDb(null);
      const ok = await recordAction(prop, OWNER, NOW, db);
      expect(ok.undo_until).toBeNull();
      expect(row(db).summary).toBe('Proposed: hand "Update the invoice template" to Bast.');
      expect(row(db).proposed_assignee_id).toBe(BAST);
      expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
    });
    it('is refused for anyone who is not a fixed handoff user', async () => {
      await rejects400({ ...prop, proposed_assignee_id: STRANGER }, makeDb(null), 'bad_handoff_target');
    });
    it('is refused when the task is not the owner own right now', async () => {
      await rejects400(prop, makeDb(null, { task: { assignee_id: STRANGER } }), 'bad_handoff_task');
      await rejects400(prop, makeDb(null, { task: { assignee_id: null } }), 'bad_handoff_task');
    });
    it('is refused when the person is not available, or the tool is not a handoff', async () => {
      await rejects400(prop, makeDb(null, { assignee: null }), 'bad_handoff_target');
      await rejects400({ ...prop, tool: 'update_task' }, makeDb(null), 'bad_proposal');
    });
    it('a proposal needs a person and cannot be applied; a handoff is never applied', async () => {
      const db = makeDb(null);
      await rejects400({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'proposed' }, db, 'bad_proposal');
      await rejects400({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'applied' }, db, 'bad_proposal');
    });
  });

  describe('attack 3: a fake filed-task line whose Undo would abandon someone else task', () => {
    const filed = { conversation_id: CONV, tool: 'create_task', target_id: TASK, summary: 'Filed "Junk".' };
    it('accepts the owner own from-chat task made in the last 10 minutes and says so itself', async () => {
      const db = makeDb(null, { task: { status: 'not_started', tags: ['from-chat'], created_at: new Date(NOW.getTime() - 2 * 60_000), title: 'Pick six photos' } });
      await recordAction(filed, OWNER, NOW, db);
      expect(row(db).summary).toBe('Filed "Pick six photos".');
      expect(row(db).after).toEqual({ status: 'not_started', assignee_id: OWNER });
      expect(row(db).before).toBeUndefined();
    });
    it('is refused for a task assigned to someone else', async () => {
      await rejects400(filed, makeDb(null, { task: { assignee_id: STRANGER, tags: ['from-chat'] } }), 'bad_create');
    });
    it('is refused without the from-chat tag, or when the task is older than 10 minutes', async () => {
      await rejects400(filed, makeDb(null, { task: { tags: [] } }), 'bad_create');
      await rejects400(filed, makeDb(null, { task: { tags: ['from-chat'], created_at: new Date(NOW.getTime() - 11 * 60_000) } }), 'bad_create');
    });
    it('ignores any before or after the worker sent for a filed task', async () => {
      const db = makeDb(null, { task: { status: 'not_started', tags: ['from-chat'] } });
      await recordAction({ ...filed, after: { assignee_id: BAST }, before: { assignee_id: OWNER } }, OWNER, NOW, db);
      expect(row(db).after).toEqual({ status: 'not_started', assignee_id: OWNER });
    });
  });

  it('a failed record stores a plain line and never the worker text', async () => {
    const db = makeDb(null);
    await recordAction({ ...rename, status: 'failed', before: undefined, after: undefined, error: 'it broke' }, OWNER, NOW, db);
    expect(row(db).summary).toBe("That didn't go through.");
    expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
  });
  it('404 for a conversation that is not the owner own', async () => {
    const db = makeDb(null);
    db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: 'someone-else' });
    await expect(recordAction(rename, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 404 });
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

describe('undo of a take-back', () => {
  const takeBack = { before: { assignee_id: BAST }, after: { assignee_id: OWNER } };
  it('never assigns to Bast: it writes a new proposal the owner must tap, and leaves the assignee alone', async () => {
    const db = makeDb(takeBack);
    const v = await undoAction(ACTION, OWNER, NOW, db);
    expect(v.status).toBe('undone');
    expect(db.task.updateMany).not.toHaveBeenCalled();
    const p = db.bastChatAction.create.mock.calls[0][0].data;
    expect(p).toMatchObject({ tool: 'propose_handoff', status: 'proposed', proposed_assignee_id: BAST, target_id: TASK });
    expect(p.summary).toBe('Proposed: hand "Update the invoice template" back to Bast.');
  });
  it('is refused with Changed since while a later chat action on the task is still applied', async () => {
    const db = makeDb(takeBack, { later: { id: 'later' } });
    await expect(undoAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 409, message: CHANGED_SINCE_TEXT });
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.state.action.status).toBe('applied');
  });
  it('is refused when the task no longer sits with the owner', async () => {
    const db = makeDb(takeBack, { taskCount: 0 });
    await expect(undoAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ message: CHANGED_SINCE_TEXT });
  });
  it('is refused when the old assignee is not a fixed handoff user', async () => {
    const db = makeDb({ before: { assignee_id: STRANGER }, after: { assignee_id: OWNER } });
    await expect(undoAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ code: 'handback_unavailable' });
    expect(db.task.updateMany).not.toHaveBeenCalled();
  });
  it('a write that changed other fields too restores those and proposes the hand back', async () => {
    const db = makeDb({ before: { assignee_id: BAST, status: 'blocked' }, after: { assignee_id: OWNER, status: 'done' } });
    await undoAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].data).toEqual({ status: 'blocked' });
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(1);
  });
});

describe('release and decline', () => {
  const proposal = { tool: 'propose_handoff', status: 'proposed', proposed_assignee_id: BAST, undo_until: null };
  it('release reassigns the task to the proposed person under the caller id and marks it released', async () => {
    const db = makeDb(proposal);
    const v = await releaseAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].data).toEqual({ assignee_id: BAST });
    expect(db.task.updateMany.mock.calls[0][0].where).toMatchObject({ id: TASK, assignee_id: OWNER });
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
    await expect(releaseAction(ACTION, OWNER, NOW, makeDb(proposal, { taskCount: 0 }))).rejects.toMatchObject({ code: 'changed_since' });
    await expect(releaseAction(ACTION, OWNER, NOW, makeDb({ ...proposal, proposed_assignee_id: STRANGER }))).rejects.toMatchObject({ code: 'assignee_unavailable' });
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
