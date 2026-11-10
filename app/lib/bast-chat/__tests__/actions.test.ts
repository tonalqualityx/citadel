/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { CHANGED_SINCE_TEXT, WORKER_RECORD_REFUSED, declineAction, recordAction, releaseAction, shortTitle, undoAction } from '../actions';
import { HANDOFF_USER_IDS } from '../settings';
import { WRITE_CAP_TEXT } from '../usage';

const OWNER = '0a111111-1111-4111-8111-111111111111';
const CONV = 'c1111111-1111-4111-8111-111111111111';
const TASK = '11111111-1111-4111-8111-111111111111';
const BAST = BAST_USER_ID;
const STRANGER = '55555555-5555-4555-8555-555555555555';
const ARC = '33333333-3333-4333-8333-333333333333';
const ACTION = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-10T12:00:00Z');

function makeDb(action: Record<string, unknown> | null, o: { taskCount?: number; claimCount?: number; assignee?: unknown; task?: Record<string, unknown> | null; later?: unknown; usage?: Record<string, unknown> | null } = {}) {
  const used: Record<string, unknown> = { writes: (o.usage?.writes as number | undefined) ?? 0 };
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
      findUnique: vi.fn(async () => (o.task === null ? null : { id: TASK, title: 'Update the invoice template', status: 'done', arc_id: null, assignee_id: OWNER, tags: [], created_at: NOW, updated_at: NOW, is_deleted: false, ...o.task })),
    },
    user: { findUnique: vi.fn(async () => (o.assignee === undefined ? { id: BAST, name: 'Bast Fae', is_active: true } : o.assignee)) },
    bastChatSettings: { findUnique: vi.fn(async () => null) },
    bastChatUsage: {
      upsert: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => o.usage ?? null),
      // honors the `lt` condition like the database does; the stored count lives in `used`
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!((used.writes as number) < where.writes.lt)) return { count: 0 };
        used.writes = (used.writes as number) + data.writes.increment;
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

describe('recordAction (the worker can only propose a handoff)', () => {
  const row = (db: any) => db.bastChatAction.create.mock.calls[0][0].data;
  const rejects400 = async (input: unknown, db: any, code?: string) => {
    await expect(recordAction(input, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 400, ...(code ? { code } : {}) });
    expect(db.bastChatAction.create).not.toHaveBeenCalled();
    expect(db.bastChatUsage.upsert).not.toHaveBeenCalled();
  };

  describe('applied, filed and failed records from the worker are refused', () => {
    const rename = { conversation_id: CONV, tool: 'update_task', target_id: TASK, summary: 'ignored', before: { title: 'Old name' }, after: { title: 'New name' } };
    it('an applied record is a 400 with a plain sentence, and nothing is written or counted', async () => {
      const db = makeDb(null, { task: { title: 'New name' } });
      await expect(recordAction({ ...rename, status: 'applied' }, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 400, code: 'record_refused', message: WORKER_RECORD_REFUSED });
      await rejects400(rename, db, 'record_refused'); // status left out: not a handoff, still refused
    });
    it('a filed record (create_task) is a 400', async () => {
      await rejects400({ conversation_id: CONV, tool: 'create_task', target_id: TASK, status: 'applied' }, makeDb(null, { task: { tags: ['from-chat'] } }), 'record_refused');
    });
    it('a failed record is a 400', async () => {
      await rejects400({ ...rename, status: 'failed', error: 'it broke' }, makeDb(null), 'record_refused');
    });
    it('a handoff cannot be sent as applied, and a proposal cannot use another tool', async () => {
      await rejects400({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'applied', proposed_assignee_id: BAST }, makeDb(null), 'record_refused');
      await rejects400({ conversation_id: CONV, tool: 'update_task', target_id: TASK, status: 'proposed', proposed_assignee_id: BAST }, makeDb(null), 'record_refused');
    });
    it('N1 to N3 replays: a record on Bast, Sabeen or an unassigned task, a crafted before, a claimed take-back and a no-op are all refused', async () => {
      for (const assignee_id of [BAST, STRANGER, null]) {
        await rejects400({ ...rename, status: 'applied', before: { status: 'not_started' }, after: { status: 'blocked' } }, makeDb(null, { task: { assignee_id, status: 'blocked' } }), 'record_refused');
      }
      await rejects400({ ...rename, status: 'applied', before: { status: 'abandoned' }, after: { status: 'not_started' } }, makeDb(null, { task: { status: 'not_started' } }), 'record_refused');
      await rejects400({ ...rename, status: 'applied', before: { title: ' ' }, after: { title: 'New name' } }, makeDb(null, { task: { title: 'New name' } }), 'record_refused');
      await rejects400({ ...rename, status: 'applied', before: { assignee_id: STRANGER }, after: { assignee_id: OWNER } }, makeDb(null, { task: { assignee_id: OWNER } }), 'record_refused');
      await rejects400({ ...rename, status: 'applied', before: { title: 'New name' }, after: { title: 'New name' }, summary: '<script>' }, makeDb(null, { task: { title: 'New name' } }), 'record_refused');
    });
  });

  describe('a proposal', () => {
    const prop = { conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, summary: 'Proposed: hand task 7ec00001 to Sabeen.', status: 'proposed', proposed_assignee_id: BAST };
    it('stores a proposal for Bast with a line the server wrote, naming Bast', async () => {
      const db = makeDb(null);
      const ok = await recordAction(prop, OWNER, NOW, db);
      expect(ok.undo_until).toBeNull();
      expect(row(db).summary).toBe('Proposed: hand "Update the invoice template" to Bast. It is done.');
      expect(row(db).proposed_assignee_id).toBe(BAST);
      expect(row(db).before).toEqual({ updated_at: NOW.toISOString() });
      expect(row(db).after).toEqual({ status: 'done', title: 'Update the invoice template' });
      expect(db.bastChatUsage.upsert).toHaveBeenCalledTimes(1); // the row is ensured once
      expect(db.bastChatUsage.updateMany).toHaveBeenCalledTimes(1); // one reservation, nothing counted after
      expect(db.bastChatUsage.updateMany.mock.calls[0][0].where).toMatchObject({ owner_id: OWNER, writes: { lt: 25 } });
      expect(db.bastChatUsage.updateMany.mock.calls[0][0].data).toEqual({ writes: { increment: 1 } });
    });
    it('F1: the line says what happens for a not started task', async () => {
      const db = makeDb(null, { task: { status: 'not_started' } });
      await recordAction(prop, OWNER, NOW, db);
      expect(row(db).summary).toBe('Proposed: hand "Update the invoice template" to Bast. It is not started, so Bast starts on it.');
    });
    it('F6: a proposal counts as one write, and is refused with the cap sentence once the cap is used up', async () => {
      const used = makeDb(null, { usage: { turns: 0, writes: 25, cost_usd: '0' } });
      await expect(recordAction(prop, OWNER, NOW, used)).rejects.toMatchObject({ statusCode: 429, message: WRITE_CAP_TEXT });
      expect(used.bastChatAction.create).not.toHaveBeenCalled();
      const last = makeDb(null, { usage: { turns: 0, writes: 24, cost_usd: '0' } });
      await recordAction(prop, OWNER, NOW, last);
      expect(last.bastChatUsage.updateMany).toHaveBeenCalledTimes(1);
      expect(last.bastChatAction.create).toHaveBeenCalledTimes(1);
    });
    it('is accepted with the status left out and ignores before and after the worker sent', async () => {
      const { status: _s, ...noStatus } = prop;
      void _s;
      const db = makeDb(null);
      await recordAction({ ...noStatus, before: { assignee_id: STRANGER }, after: { assignee_id: BAST } }, OWNER, NOW, db);
      expect(row(db).status).toBe('proposed');
      expect(row(db).before).toEqual({ updated_at: NOW.toISOString() });
      expect(row(db).after).toEqual({ status: 'done', title: 'Update the invoice template' });
    });
    it('is refused for anyone who is not a fixed handoff user (Bast only)', async () => {
      await rejects400({ ...prop, proposed_assignee_id: STRANGER }, makeDb(null), 'bad_handoff_target');
      expect(HANDOFF_USER_IDS).toEqual([BAST]);
    });
    it('is refused when the task is not the owner own right now', async () => {
      await rejects400(prop, makeDb(null, { task: { assignee_id: STRANGER } }), 'bad_handoff_task');
      await rejects400(prop, makeDb(null, { task: { assignee_id: null } }), 'bad_handoff_task');
      await rejects400(prop, makeDb(null, { task: { assignee_id: BAST } }), 'bad_handoff_task');
    });
    it('is refused when the person is not available or the task is missing or deleted', async () => {
      await rejects400(prop, makeDb(null, { assignee: null }), 'bad_handoff_target');
      await rejects400(prop, makeDb(null, { task: null }), 'task_missing');
      await rejects400(prop, makeDb(null, { task: { is_deleted: true } }), 'task_missing');
    });
    it('needs a person, and an unknown key is refused', async () => {
      await rejects400({ conversation_id: CONV, tool: 'propose_handoff', target_id: TASK, status: 'proposed' }, makeDb(null), 'bad_proposal');
      await expect(recordAction({ ...prop, extra: 1 }, OWNER, NOW, makeDb(null))).rejects.toThrow();
    });
    it('404 for a conversation that is not the owner own', async () => {
      const db = makeDb(null);
      db.bastChatConversation.findUnique.mockResolvedValue({ owner_id: 'someone-else' });
      await expect(recordAction(prop, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});

describe('shortTitle', () => {
  it('leaves a short title alone and cuts a long one at a word boundary with three full stops', () => {
    expect(shortTitle('Pick six photos')).toBe('Pick six photos');
    const t = shortTitle('Pick six photos for the holiday carousel and send Mark the shortlist');
    expect(t).toBe('Pick six photos for the holiday carousel and send Mark...');
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).not.toContain(String.fromCharCode(0x2026));
  });
});

describe('undoAction', () => {
  it('restores the before values with a compare and set on the recorded after', async () => {
    const db = makeDb({ before: { status: 'in_progress', title: 'Old' }, after: { status: 'done' } });
    const v = await undoAction(ACTION, OWNER, NOW, db);
    const call = db.task.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: TASK, status: 'done', assignee_id: OWNER });
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
    expect(db.task.updateMany.mock.calls[0][0].where).toMatchObject({ assignee_id: OWNER, tags: { has: 'from-chat' }, status: 'not_started' });
  });
  it('an undo of a status, title or arc change never writes a task that is not the owner now', async () => {
    for (const rec of [
      { before: { status: 'in_progress' }, after: { status: 'done' } },
      { before: { title: 'Old' }, after: { title: 'New' } },
      { tool: 'add_to_arc', before: { arc_id: null }, after: { arc_id: ARC } },
    ]) {
      const db = makeDb(rec, { taskCount: 0 }); // the task left the owner: the compare and set matches no row
      await expect(undoAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ message: CHANGED_SINCE_TEXT });
      expect(db.task.updateMany.mock.calls[0][0].where.assignee_id).toBe(OWNER);
      expect(db.state.action.status).toBe('applied');
    }
  });
  it('the owner id in the where wins over any assignee in a stored after', async () => {
    const db = makeDb({ before: { status: 'in_progress' }, after: { status: 'done', assignee_id: BAST } });
    await undoAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].where.assignee_id).toBe(OWNER);
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
    expect(p.summary).toBe('Proposed: hand "Update the invoice template" back to Bast. It is done.');
    expect(p.before).toEqual({ updated_at: NOW.toISOString() });
    expect(p.after).toEqual({ status: 'done', title: 'Update the invoice template' });
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
  it('a take-back from nobody, or from someone not on the handoff list, says to open the task', async () => {
    const none = makeDb({ before: { assignee_id: null }, after: { assignee_id: OWNER } });
    await expect(undoAction(ACTION, OWNER, NOW, none)).rejects.toMatchObject({ statusCode: 409, message: 'Open the task to hand it back.' });
    expect(none.task.updateMany).not.toHaveBeenCalled();
  });
  it('a write that changed other fields too restores those and proposes the hand back', async () => {
    const db = makeDb({ before: { assignee_id: BAST, status: 'blocked' }, after: { assignee_id: OWNER, status: 'done' } });
    await undoAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].data).toEqual({ status: 'blocked' });
    expect(db.bastChatAction.create).toHaveBeenCalledTimes(1);
  });
});

describe('release and decline', () => {
  const snap = { before: { updated_at: NOW.toISOString() }, after: { status: 'done', title: 'Update the invoice template' } };
  const proposal = { tool: 'propose_handoff', status: 'proposed', proposed_assignee_id: BAST, undo_until: null, ...snap };
  it('release reassigns the task to the proposed person under the caller id and marks it released', async () => {
    const db = makeDb(proposal);
    const v = await releaseAction(ACTION, OWNER, NOW, db);
    expect(db.task.updateMany.mock.calls[0][0].data).toEqual({ assignee_id: BAST });
    expect(db.task.updateMany.mock.calls[0][0].where).toMatchObject({ id: TASK, assignee_id: OWNER, status: 'done', title: 'Update the invoice template', updated_at: NOW });
    expect(db.task.updateMany).toHaveBeenCalledTimes(1);
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
  it('F1: a tap on a task that changed since is a 409, the task is untouched and the proposal cannot be tapped again', async () => {
    const db = makeDb(proposal, { taskCount: 0 });
    await expect(releaseAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 409, message: CHANGED_SINCE_TEXT });
    expect(db.state.action.status).toBe('failed');
    expect(db.bastChatAction.update).toHaveBeenCalledTimes(1);
    await expect(releaseAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ code: 'not_proposed' });
    expect(db.task.updateMany).toHaveBeenCalledTimes(1);
  });
  it('F1: a proposal with no picture of the task is refused and marked dead', async () => {
    const db = makeDb({ ...proposal, before: null, after: null });
    await expect(releaseAction(ACTION, OWNER, NOW, db)).rejects.toMatchObject({ statusCode: 409, message: CHANGED_SINCE_TEXT });
    expect(db.task.updateMany).not.toHaveBeenCalled();
    expect(db.state.action.status).toBe('failed');
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
