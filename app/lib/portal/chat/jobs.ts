/**
 * Queueing a reply job for a conversation (phase C spec 2.3 step 2) and the expiry that runs on the
 * client's own poll (step 6). When the switches say chat is unavailable (a dead runner, a cap), the
 * turn runs in tree mode at once.
 */
import { prisma } from '@/lib/db/prisma';
import { chatAvailability } from '@/lib/portal/chat/switches';
import { enqueueJob, expireStaleJobs } from '@/lib/engine/queue';
import { advanceTree } from '@/lib/portal/chat/tree-mode';
import { handOff } from '@/lib/portal/chat/handoff';
import { CANNED_LINE } from '@/lib/portal/chat/copy';

export type TurnRoute = 'queued' | 'tree' | 'person' | 'none';

/** Route a saved client message: a job when the model is available, the fixed tree otherwise. */
export async function routeTurn(input: {
  conversationId: string;
  contactId: string;
  commentId: string;
  now?: Date;
}): Promise<TurnRoute> {
  const now = input.now ?? new Date();
  const convo = await prisma.chatConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, task_id: true, client_id: true, site_id: true, state: true },
  });
  if (!convo || convo.state === 'closed' || convo.state === 'with_person') return 'none';

  const avail = await chatAvailability({ contactId: input.contactId, clientId: convo.client_id, siteId: convo.site_id, conversationId: convo.id, now });
  if (avail.available) {
    await enqueueJob({
      type: 'chat_reply',
      conversationId: convo.id,
      taskId: convo.task_id,
      clientId: convo.client_id,
      contactId: input.contactId,
      upToCommentId: input.commentId,
      now,
    });
    return 'queued';
  }
  // A conversation past its job cap goes to a person; every other reason runs the tree.
  if (avail.reason === 'conversation_jobs') {
    await handOff(convo.id, { reason: 'other', draft: '', say: CANNED_LINE, now });
    return 'person';
  }
  await prisma.chatConversation.update({ where: { id: convo.id }, data: { mode: 'tree' } });
  await advanceTree(convo.id, { now });
  return 'tree';
}

/** Expire this conversation's stale jobs and answer the unanswered turn from the tree. Returns the expired job ids. */
export async function expireAndAdvance(conversationId: string, now: Date = new Date()): Promise<string[]> {
  const expired = await expireStaleJobs(now, { conversationId });
  if (expired.length > 0) await advanceTree(conversationId, { now });
  return expired;
}
