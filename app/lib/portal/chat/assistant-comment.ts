import type { Prisma } from '@prisma/client';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { actorLaneField } from '@/lib/auth/actor-lane';

/** A reply the assistant (or the fixed tree) shows the client. Authored by the Bast user, source `assistant`, never internal. */
export async function postAssistantComment(
  tx: Prisma.TransactionClient,
  taskId: string,
  text: string,
  meta: Record<string, unknown> = {}
) {
  return tx.comment.create({
    data: { ...(await actorLaneField()),
      task_id: taskId,
      user_id: BAST_USER_ID,
      content: text,
      is_internal: false,
      client_visible: true,
      source: 'assistant',
      chat_meta: meta as Prisma.InputJsonValue,
    },
    select: { id: true, created_at: true },
  });
}

/** An internal note on the task: staff only, never shown to the client. */
export async function postInternalNote(tx: Prisma.TransactionClient, taskId: string, text: string, meta: Record<string, unknown> = {}) {
  return tx.comment.create({
    data: { ...(await actorLaneField()), task_id: taskId, user_id: BAST_USER_ID, content: text, is_internal: true, client_visible: false, source: 'assistant', chat_meta: meta as Prisma.InputJsonValue },
    select: { id: true },
  });
}
