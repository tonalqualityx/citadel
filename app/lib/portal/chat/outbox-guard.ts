/**
 * The two outbox hooks for chat mail (phase C spec 7.3, 7.4; slice C4): the recipient re-check at
 * claim time, and the conversation's thread bookkeeping once the drain has sent a message.
 */
import { prisma } from '@/lib/db/prisma';
import { noticeRecipients } from '@/lib/portal/notices';

/** `to` must be one address, and a person on the task's conversation who can still open it. */
export async function chatRecipientAllowed(row: { to: string; cc?: string | null; task_id: string | null }): Promise<boolean> {
  if (!row.task_id || row.cc) return false;
  const task = await prisma.task.findUnique({ where: { id: row.task_id }, select: { id: true, title: true, client_title: true, client_id: true, requested_by_contact_id: true, chat_conversation: { select: { id: true } } } });
  if (!task?.chat_conversation) return false;
  const to = row.to.trim().toLowerCase();
  if (to.includes(',')) return false;
  const people = await noticeRecipients({ id: task.id, client_title: task.client_title ?? task.title, client_id: task.client_id, requested_by_contact_id: task.requested_by_contact_id });
  return people.some((p) => p.email.toLowerCase() === to);
}

/** The newest message in the Gmail thread is what the next email replies to. */
export async function recordChatSend(taskId: string, gmailId: string | null, gmailThreadId: string | null): Promise<void> {
  const convo = await prisma.chatConversation.findUnique({ where: { task_id: taskId }, select: { id: true, gmail_thread_id: true } });
  if (!convo) return;
  await prisma.chatConversation.update({
    where: { id: convo.id },
    data: { ...(gmailId ? { last_outbound_gmail_id: gmailId } : {}), ...(gmailThreadId && !convo.gmail_thread_id ? { gmail_thread_id: gmailThreadId } : {}) },
  });
}
