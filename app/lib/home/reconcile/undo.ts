/**
 * Home Slice 9a: Undo of a reconcile record. Compare-and-set throughout; nothing is ever deleted.
 *
 *   note      the comment is hidden (is_deleted true).
 *   done      the task goes back to its old status only while it is still done (patchTask, expect status done); its time entry is
 *             soft deleted only while duration and started_at are unchanged.
 *   wait      cancelled only while it is still waiting.
 *   track     each task it made goes to abandoned only while still as it was left (the done task still done, the others still not
 *             started or blocked and his); the project it made goes to cancelled only while still in_progress with no other task;
 *             its time entry is soft deleted only while unchanged. What he changed since is left alone and the answer says so.
 *   log_time  the entry is soft deleted only while unchanged.
 *   session   is undone by the home screen's own clear_session record (this row carries none).
 * After every Undo: a 30 day hold on the target and the card row's state 'undone'. "This was wrong" adds a 90 day hold and stamps the
 * message's wrong_at. Called inside runHomeUndo's transaction (db is a transaction client).
 */
import type { PrismaClient } from '@prisma/client';
import { patchTask } from '@/lib/services/task-patch';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { resolveByPerson } from '@/lib/waits/actions';
import { ownerActor } from './actor';
import { CHANGED_SINCE } from './copy';
import { ReconcileError } from './errors';
import { hideNote } from './note';
import { readRecord, recordTaskId, type ReconcileRecord } from './records';

export const HOLD_DAYS_UNDO = 30;
export const HOLD_DAYS_WRONG = 90;
const DAY_MS = 24 * 3600 * 1000;

export async function putHold(db: PrismaClient, userId: string, targetKey: string, days: number, reason: 'undo' | 'wrong' | 'no', now: Date): Promise<void> {
  const until = new Date(now.getTime() + days * DAY_MS);
  const cur = await db.homeReconcileHold.findUnique({ where: { user_id_target_key: { user_id: userId, target_key: targetKey } }, select: { until: true } });
  if (cur && cur.until.getTime() >= until.getTime()) return;
  await db.homeReconcileHold.upsert({
    where: { user_id_target_key: { user_id: userId, target_key: targetKey } },
    create: { user_id: userId, target_key: targetKey, until, reason },
    update: { until, reason },
  });
}

async function softDeleteEntry(db: PrismaClient, userId: string, id: string, startedAt: string, duration: number): Promise<boolean> {
  const r = await db.timeEntry.updateMany({ where: { id, user_id: userId, is_deleted: false, duration, started_at: new Date(startedAt) }, data: { is_deleted: true } });
  return r.count === 1;
}

export interface UndoOutcome {
  message: string | null;
}

export async function undoReconcileRecord(db: PrismaClient, userId: string, rec: ReconcileRecord, now: Date): Promise<UndoOutcome> {
  let message: string | null = null;
  switch (rec.kind) {
    case 'note': {
      await hideNote(db, rec.comment_id, rec.task_id);
      break;
    }
    case 'log_time': {
      if (!(await softDeleteEntry(db, userId, rec.time_entry_id, rec.started_at, rec.duration))) throw new ReconcileError('changed_since');
      break;
    }
    case 'wait': {
      const w = await db.wait.findUnique({ where: { id: rec.wait_id } });
      if (!w || w.state !== 'waiting') throw new ReconcileError('changed_since');
      const store = prismaSweepStore(db);
      await resolveByPerson(store, w as never, 'cancelled', { now, source: 'api', actor_user_id: userId, reason: 'Undone from the home screen.' });
      break;
    }
    case 'done': {
      if (rec.time_entry_id && rec.time_started_at && rec.time_duration !== null) await softDeleteEntry(db, userId, rec.time_entry_id, rec.time_started_at, rec.time_duration);
      const actor = await ownerActor(db, userId);
      const res = await patchTask({ actor, id: rec.task_id, body: { status: rec.status_before }, expect: { assignee_id: userId, status: 'done' } });
      if (!res.ok) throw new ReconcileError('changed_since');
      break;
    }
    case 'track': {
      let left = 0;
      const [doneId, ...rest] = rec.task_ids;
      if (doneId) {
        const r = await db.task.updateMany({ where: { id: doneId, assignee_id: userId, status: 'done', is_deleted: false }, data: { status: 'abandoned' } });
        if (r.count !== 1) left += 1;
      }
      for (const id of rest) {
        const r = await db.task.updateMany({ where: { id, assignee_id: userId, status: { in: ['not_started', 'blocked'] }, is_deleted: false }, data: { status: 'abandoned' } });
        if (r.count !== 1) left += 1;
      }
      if (rec.project_made && rec.project_id) {
        // Cancelled only when nothing in it is still alive: a task he started since (left alone above) keeps the project.
        const alive = await db.task.count({ where: { project_id: rec.project_id, is_deleted: false, status: { not: 'abandoned' } } });
        if (alive === 0) await db.project.updateMany({ where: { id: rec.project_id, status: 'in_progress', is_deleted: false }, data: { status: 'cancelled' } });
        else left += 1;
      }
      if (rec.time_entry_id && rec.time_started_at && rec.time_duration !== null) {
        if (!(await softDeleteEntry(db, userId, rec.time_entry_id, rec.time_started_at, rec.time_duration))) left += 1;
      }
      if (left > 0) message = CHANGED_SINCE;
      break;
    }
    case 'session':
    case 'no':
      break;
  }
  return { message };
}

/** After an Undo (or "This was wrong"): the card row, the hold and the message mark. */
export async function afterUndo(db: PrismaClient, userId: string, rec: ReconcileRecord, now: Date, wrong: boolean): Promise<void> {
  const changeId = 'change_id' in rec ? rec.change_id : null;
  const taskId = recordTaskId(rec);
  let messageId: string | null = rec.kind === 'note' ? rec.message_id : null;
  if (changeId) {
    const ch = await db.homeReconcileChange.findUnique({ where: { id: changeId }, select: { id: true, message_id: true } });
    if (ch) {
      await db.homeReconcileChange.update({ where: { id: ch.id }, data: { state: 'undone', resolved_at: now } });
      messageId = messageId ?? ch.message_id;
    }
  }
  if (taskId) {
    await putHold(db, userId, `task:${taskId}`, HOLD_DAYS_UNDO, 'undo', now);
    if (wrong) await putHold(db, userId, `task:${taskId}`, HOLD_DAYS_WRONG, 'wrong', now);
  }
  if (wrong && messageId) await db.homeReconcileMessage.updateMany({ where: { id: messageId, user_id: userId, wrong_at: null }, data: { wrong_at: now } });
}

export { readRecord };
