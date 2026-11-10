/**
 * Bast chat v2, op `comment`: an internal note on a task from the owner (plan 1.4).
 *
 * Can it reach a client? No. The row is always written with is_internal true, client_visible false and
 * client_question false, and no mentions. The portal thread shows a comment only when a client wrote it, it is
 * client_visible, or it is a client question (lib/portal/thread.ts), and the client's email notice is queued only
 * from the comment route when client_visible is true (never here). The input schema is strict, so none of those
 * flags can be sent. The assignee gets the normal team notice, exactly as the comment route sends it.
 *
 * It is written by the Bast user, with the text prefixed "From Mike, through the chat: ", so the worker's gate
 * counts it as a bot comment and it never wakes a card. A comment on a task Bast holds, or whose last comment
 * decides a wake, is a tap by the reach check (`checkComment`, amendment 10 c): the thread is read by a session.
 *
 * Undo hides the comment (is_deleted true). Nothing is deleted from the database. Hiding is itself reach checked.
 *
 * The race with the owner's tap (VERIFY-2 N1): when the chat writes (no `ctx.actor`), `run` takes the advisory locks of
 * the task, the tasks it waits on and the tasks that wait on it (task-locks.ts) in the ops route's transaction, then
 * runs the reach check again on what is committed now, and only then inserts. A tap that handed the task (or a task
 * waiting on it) to Bast before the lock makes the check say "tap", and the write is refused with 409 changed since.
 * The tap holds the same locks from its re-check to its write. When the tap itself applies this op (`ctx.actor` is
 * set), the tap already holds the locks and has re-checked the fingerprint, so `run` does neither.
 * Record: target_id is the comment id; before is `{task_id, comment: null}`, after is `{task_id, comment_id}`.
 */
import { z } from 'zod';
import type { BastChatAction } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { actorLaneField } from '@/lib/auth/actor-lane';
import { createNotification } from '@/lib/services/notifications';
import { loadReachTask, opSummary, shortTitle, type OpContext, type PreparedOp } from '../actions';
import { BAST_USER_ID, BOT_USER_IDS } from '../gate-mirror';
import { checkComment, type CommentAuthorKind, type ReachOrigin } from '../worker-reach';
import { isChatUuid } from '../worker-kit';
import { CHAT_COMMENT_PREFIX } from '../worker-reads';
import { lockScope, scopeFor } from '../task-locks';
import type { OpDef, OpDb, OpRun } from './index';

export const COMMENT_PREFIX = CHAT_COMMENT_PREFIX;
export const COMMENT_MAX = 2000;

const inputSchema = z.object({ task_id: z.string().uuid(), text: z.string().trim().min(1).max(COMMENT_MAX) }).strict();
export type CommentInput = z.infer<typeof inputSchema>;

const expectSchema = z.object({ task_updated_at: z.string(), last_comment_id: z.string().nullable() }).strict();

const kindOf = (c: { user_id: string | null; author_contact_id: string | null } | null): CommentAuthorKind => {
  if (!c) return 'none';
  if (c.author_contact_id) return 'client';
  if (c.user_id && BOT_USER_IDS.includes(c.user_id)) return 'bot';
  return 'human';
};

async function latestComment(db: OpDb, taskId: string, exceptId?: string) {
  return db.comment.findFirst({
    where: { task_id: taskId, is_deleted: false, ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { created_at: 'desc' },
    select: { id: true, user_id: true, author_contact_id: true },
  });
}

async function prepare(ctx: OpContext, input: CommentInput, origin: ReachOrigin): Promise<PreparedOp> {
  const db = ctx.db as OpDb;
  const last = await latestComment(db, input.task_id);
  const loaded = await loadReachTask(db, input.task_id);
  if (!loaded) throw new ApiError('That task does not exist.', 404, 'task_missing');
  const reach = checkComment({ task: loaded.reach, action: 'add', added_author: 'bot', now: ctx.now, origin });
  return {
    reach,
    expect: { task_updated_at: loaded.row.updated_at.toISOString(), last_comment_id: last?.id ?? null },
    copy: { clause: `add a note to "${shortTitle(loaded.row.title)}"` },
  };
}

async function run(ctx: OpContext, input: CommentInput, expect: unknown): Promise<OpRun> {
  const e = expectSchema.safeParse(expect);
  if (!e.success) throw new ApiError('That changed. Ask again.', 409, 'changed_since');
  const db = ctx.db as OpDb;
  if (!ctx.actor) {
    // The chat's own write: lock, then judge again on what is committed now (the route's check ran before the lock).
    await lockScope(db, await scopeFor(db, [input.task_id]));
    const again = await prepare(ctx, input, 'chat');
    if (again.reach.needs_tap) throw new ApiError('Changed since. Open the task.', 409, 'changed_since');
  }
  const task = await db.task.findUnique({ where: { id: input.task_id }, select: { id: true, title: true, assignee_id: true, is_deleted: true, updated_at: true } });
  if (!task || task.is_deleted) throw new ApiError('That task does not exist.', 404, 'task_missing');
  const last = await latestComment(db, input.task_id);
  if (task.updated_at.toISOString() !== e.data.task_updated_at || (last?.id ?? null) !== e.data.last_comment_id) {
    throw new ApiError('Changed since. Open the task.', 409, 'changed_since');
  }
  const content = `${COMMENT_PREFIX}${input.text}`;
  const lane = await actorLaneField();
  const c = await db.comment.create({
    data: {
      ...lane,
      task_id: input.task_id,
      user_id: BAST_USER_ID,
      content,
      mentioned_user_ids: [],
      is_internal: true,
      client_visible: false,
      client_question: false,
    },
    select: { id: true },
  });
  const assignee = task.assignee_id;
  const snippet = `${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
  return {
    target_id: c.id,
    before: { task_id: input.task_id, comment: null },
    after: { task_id: input.task_id, comment_id: c.id },
    summary: opSummary({ op: 'task_comment', task_title: task.title }, ctx.now),
    result: { comment_id: c.id, task_id: input.task_id, internal: true },
    undoable: true,
    afterCommit:
      assignee && assignee !== BAST_USER_ID
        ? async () => {
            await createNotification({
              userId: assignee,
              type: 'comment_added',
              title: `New comment on "${task.title}"`,
              message: `Bast commented: "${snippet}"`,
              entityType: 'task',
              entityId: input.task_id,
            });
          }
        : undefined,
  };
}

function ids(a: BastChatAction): { comment_id: string; task_id: string } {
  const v = a.after as { comment_id?: unknown; task_id?: unknown } | null;
  if (!v || !isChatUuid(v.comment_id) || !isChatUuid(v.task_id)) throw new ApiError("That can't be undone from here. Open it in Citadel.", 409, 'not_undoable');
  return { comment_id: v.comment_id, task_id: v.task_id };
}

export const commentOp: OpDef<CommentInput> = {
  name: 'comment',
  target_type: 'comment',
  tool: 'comment_on_task',
  validate: (raw) => inputSchema.parse(raw),
  targetId: (input) => input.task_id,
  prepare,
  run,
  async prepareUndo(ctx, record) {
    const { comment_id, task_id } = ids(record);
    const db = ctx.db as OpDb;
    const c = await db.comment.findUnique({ where: { id: comment_id }, select: { id: true, is_deleted: true, task_id: true } });
    if (!c || c.is_deleted || c.task_id !== task_id) throw new ApiError('Changed since. Open the task.', 409, 'changed_since');
    const loaded = await loadReachTask(db, task_id);
    if (!loaded) throw new ApiError('Changed since. Open the task.', 409, 'changed_since');
    const after = await latestComment(db, task_id, comment_id);
    const reach = checkComment({ task: loaded.reach, action: 'hide', last_comment_author_after: kindOf(after), last_comment_id_after: after?.id ?? null, now: ctx.now, origin: 'undo' });
    return { reach, expect: { comment_id }, copy: { clause: `hide the note on "${shortTitle(loaded.row.title)}"` } };
  },
  async undo(ctx, record) {
    const { comment_id, task_id } = ids(record);
    const r = await (ctx.db as OpDb).comment.updateMany({ where: { id: comment_id, task_id, is_deleted: false }, data: { is_deleted: true } });
    return r.count === 1 ? { ok: true } : { ok: false, reason: 'changed_since' };
  },
};
