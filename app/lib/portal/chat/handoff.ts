/**
 * Handoff to people (phase C spec 8). A `hand_to_person` action, the client asking for a person,
 * a second gate rejection, a spend cap or a stall all end here, deterministically:
 * state `with_person`, tags needs-mike + chat-handoff, an internal note with the draft, a high
 * priority notification to the assignee (Mike when the assignee is Bast or unset), a
 * portal.client_reply wait, and no more jobs for the conversation.
 */
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { dispatchNotification } from '@/lib/services/notification-dispatcher';
import { onChatHandoff } from '@/lib/portal/waits';
import { NOTE } from '@/lib/portal/chat/copy';
import { postAssistantComment, postInternalNote } from '@/lib/portal/chat/assistant-comment';
import { Prisma } from '@prisma/client';

export interface HandoffInput {
  reason: string;
  /** The drafted reply for the team (not sent). */
  draft: string;
  /** Whether the draft passed the copy gate. */
  draftOk?: boolean;
  /** A fixed line to show the client; omit when the assistant's own reply was already saved. */
  say?: string | null;
  now?: Date;
}

export async function handOff(conversationId: string, input: HandoffInput): Promise<{ already: boolean }> {
  const now = input.now ?? new Date();
  const res = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${conversationId}`}))`;
    const convo = await tx.chatConversation.findUnique({ where: { id: conversationId }, include: { task: true } });
    if (!convo) return null;
    if (convo.state === 'with_person') return { already: true, task: convo.task, noteId: null as string | null };
    const tags = new Set([...convo.task.tags, 'needs-mike', 'chat-handoff']);
    tags.delete('awaiting-clarification');
    await tx.task.update({ where: { id: convo.task_id }, data: { tags: [...tags] } });
    if (input.say) await postAssistantComment(tx, convo.task_id, input.say, { fixed: true, handoff: true });
    const note = await postInternalNote(tx, convo.task_id, NOTE.handoff(input.reason, input.draft, input.draftOk ?? true), { handoff: true, reason: input.reason });
    await tx.chatConversation.update({
      where: { id: conversationId },
      data: { state: 'with_person', open_ask: Prisma.DbNull },
    });
    // No more jobs for this conversation: queued ones are withdrawn without touching the mode.
    await tx.engineJob.updateMany({ where: { conversation_id: conversationId, status: 'queued' }, data: { status: 'expired', expired_at: now } });
    await onChatHandoff(
      tx,
      {
        id: convo.task.id,
        client_title: convo.task.client_title ?? convo.task.title,
        assignee_id: convo.task.assignee_id,
        client_id: convo.task.client_id,
        project_id: convo.task.project_id,
        charter_id: convo.task.charter_id,
        site_id: convo.task.site_id,
      },
      note.id,
      now
    );
    return { already: false, task: convo.task, noteId: note.id };
  });
  if (!res) return { already: false };
  if (!res.already) {
    const to = res.task.assignee_id && res.task.assignee_id !== BAST_USER_ID ? res.task.assignee_id : MIKE_USER_ID;
    try {
      await dispatchNotification({
        userId: to,
        type: 'portal_chat_handoff',
        title: `Chat needs a person: ${res.task.client_title ?? res.task.title}`,
        message: `The assistant handed a portal chat to the team (${input.reason}). The task has the drafted reply.`,
        entityType: 'task',
        entityId: res.task.id,
        priority: 'high',
      });
    } catch (error) {
      console.error('portal chat handoff notification failed', error);
    }
  }
  return { already: res.already };
}

/** "Hand back to the assistant" (staff): the conversation returns to the assistant. */
export async function handBack(taskId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const convo = await tx.chatConversation.findUnique({ where: { task_id: taskId }, include: { task: { select: { tags: true } } } });
    if (!convo || convo.state !== 'with_person') return false;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${convo.id}`}))`;
    const tags = convo.task.tags.filter((t) => t !== 'chat-handoff');
    await tx.task.update({ where: { id: taskId }, data: { tags } });
    await tx.chatConversation.update({ where: { id: convo.id }, data: { state: convo.confirmed_at ? 'filed' : 'clarifying' } });
    await postInternalNote(tx, taskId, NOTE.handback, { handback: true });
    return true;
  });
}
