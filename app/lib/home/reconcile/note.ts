/**
 * Home Slice 9a: the internal note on his own task (the one automatic change in this slice).
 *
 * Built from the helpers of ops/comment.ts: written by the Bast user, always internal, never client visible, never a client
 * question, no mentions, so the portal never shows it and no client mail is queued. It takes the task's advisory locks inside
 * the caller's transaction, then runs the reach check again on what is committed now: a note that would wake Bast or reach a
 * client is refused and becomes a card. Undo hides the comment (is_deleted true). Nothing is deleted from the database.
 * No team notice is sent: the Handled line is the notice.
 */
import type { PrismaClient } from '@prisma/client';
import { actorLaneField } from '@/lib/auth/actor-lane';
import { loadReachTask } from '@/lib/bast-chat/actions';
import { BAST_USER_ID } from '@/lib/bast-chat/gate-mirror';
import { lockScope, scopeFor } from '@/lib/bast-chat/task-locks';
import { checkComment } from '@/lib/bast-chat/worker-reach';
import { OPEN_TASK_STATUSES } from './load';

export const NOTE_MAX = 2000;

export type NoteResult = { ok: true; comment_id: string } | { ok: false; reason: 'changed' | 'reach' };

/** `db` is a transaction client. */
export async function writeNote(
  db: PrismaClient,
  ownerId: string,
  taskId: string,
  text: string,
  now: Date,
  opts: { tap?: boolean } = {}
): Promise<NoteResult> {
  await lockScope(db, await scopeFor(db, [taskId]));
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, assignee_id: true, status: true, is_deleted: true } });
  // His own tap may note any open task (the card said whose it is); the automatic path only his own.
  if (!task || task.is_deleted || (!opts.tap && task.assignee_id !== ownerId) || !(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return { ok: false, reason: 'changed' };
  }
  if (!opts.tap) {
    const loaded = await loadReachTask(db, taskId);
    if (!loaded) return { ok: false, reason: 'changed' };
    if (checkComment({ task: loaded.reach, action: 'add', added_author: 'bot', now, origin: 'chat' }).needs_tap) return { ok: false, reason: 'reach' };
  }
  const lane = await actorLaneField();
  const c = await db.comment.create({
    data: {
      ...lane,
      task_id: taskId,
      user_id: BAST_USER_ID,
      content: text.slice(0, NOTE_MAX),
      mentioned_user_ids: [],
      is_internal: true,
      client_visible: false,
      client_question: false,
    },
    select: { id: true },
  });
  return { ok: true, comment_id: c.id };
}

/** Hide one note (Undo). True when this call hid it. */
export async function hideNote(db: PrismaClient, commentId: string, taskId: string): Promise<boolean> {
  const r = await db.comment.updateMany({ where: { id: commentId, task_id: taskId, is_deleted: false }, data: { is_deleted: true } });
  return r.count === 1;
}
