/**
 * The "Done when" checklist of a task (Task.requirements): one item ticked or unticked, with an optional answer.
 *
 * Used by POST /api/tasks/:id/checklist. A tick writes `completed`, `completed_at` and `completed_by` on that one item and
 * leaves every other item as it was (the whole-list PATCH can race a second writer; this cannot, it holds the task row).
 * An answer is a task comment stored in the same transaction as the tick: internal, never client visible. The comment text is
 * `Answer on "<item text>": <answer>` and its chat_meta also carries the item id, so the answer still finds its item when the
 * item text is edited later.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { ANSWER_MAX, CHAT_ANSWER_PREFIX, answerContent } from './checklist-answers';

export const checklistBodySchema = z
  .object({
    item_id: z.string().min(1).max(100),
    completed: z.boolean().optional(),
    answer: z.string().max(ANSWER_MAX).optional(),
  })
  .strict()
  .refine((b) => b.completed !== undefined || (b.answer ?? '').trim() !== '', { message: 'Say what to change.' });
export type ChecklistBody = z.infer<typeof checklistBodySchema>;

interface Item extends Record<string, unknown> {
  id?: string;
  text?: string;
  completed?: boolean;
}

export interface ChecklistResult {
  item_id: string;
  completed: boolean;
  comment_id: string | null;
}

export async function writeChecklist(a: {
  taskId: string;
  body: ChecklistBody;
  authorId: string;
  lane: string | null;
  /** A machine caller (a lane key, or any key minted for a bot user): its comment says it speaks for the owner, and it may not touch a task a bot holds. */
  machine: boolean;
  botIds: readonly string[];
}): Promise<ChecklistResult> {
  const answer = (a.body.answer ?? '').replace(/\r\n?/g, '\n').trim();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${a.taskId}::uuid FOR UPDATE`;
    const task = await tx.task.findUnique({
      where: { id: a.taskId, is_deleted: false },
      select: { requirements: true, assignee_id: true },
    });
    if (!task) throw new ApiError('Task not found', 404);
    if (a.machine && task.assignee_id && a.botIds.includes(task.assignee_id)) {
      throw new ApiError('Bast holds this task. Open the task to change its list.', 409, 'task_held');
    }
    const list = Array.isArray(task.requirements) ? ([...task.requirements] as Item[]) : [];
    const idx = list.findIndex((r) => r && typeof r === 'object' && r.id === a.body.item_id);
    if (idx < 0) throw new ApiError('That item is not on this task.', 404, 'item_missing');
    const item = list[idx];
    const text = typeof item.text === 'string' ? item.text : '';
    const completed = answer ? true : (a.body.completed ?? item.completed === true);
    if ((item.completed === true) !== completed) {
      list[idx] = {
        ...item,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
        completed_by: completed ? a.authorId : null,
      };
      await tx.task.update({ where: { id: a.taskId }, data: { requirements: list as unknown as Prisma.InputJsonValue } });
    }
    let commentId: string | null = null;
    if (answer) {
      const base = answerContent(text, answer);
      const c = await tx.comment.create({
        data: {
          task_id: a.taskId,
          user_id: a.authorId,
          content: a.machine ? `${CHAT_ANSWER_PREFIX}${base}` : base,
          mentioned_user_ids: [],
          is_internal: true,
          client_visible: false,
          client_question: false,
          chat_meta: { checklist: { item_id: a.body.item_id } },
          ...(a.lane ? { actor_lane: a.lane.slice(0, 40) } : {}),
        },
        select: { id: true },
      });
      commentId = c.id;
    }
    return { item_id: a.body.item_id, completed, comment_id: commentId };
  });
}

