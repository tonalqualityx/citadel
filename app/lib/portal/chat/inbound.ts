/**
 * A parsed email reply coming back into a chat (phase C spec 7.4; slice C4).
 *
 * The machine (ingest_replies.py) has already stripped quoted history and signatures, checked the
 * DKIM/DMARC result and fetched attachments. Citadel still decides everything with a consequence:
 * which conversation, whether the sender is a person on it, the stored message, the waits, and the
 * `chat_email_reply` job. A reply from anyone else never reaches the client's thread.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { createNotification } from '@/lib/services/notifications';
import { alertTaskOwner } from '@/lib/portal/staff-alert';
import { noticeRecipients } from '@/lib/portal/notices';
import { onChatClientAnswered, onClientMessage } from '@/lib/portal/waits';
import { enqueueJob } from '@/lib/engine/queue';
import { bindAttachments } from '@/lib/portal/chat/attachments';
import { refreshTaskDescription } from '@/lib/portal/chat/description';
import { handOff } from '@/lib/portal/chat/handoff';
import { chatAvailability } from '@/lib/portal/chat/switches';
import { CANNED_LINE } from '@/lib/portal/chat/copy';
import { emailFixedLine } from '@/lib/portal/chat/mailer';
import { readSlots } from '@/lib/portal/chat/slots';
import { actorLaneField } from '@/lib/auth/actor-lane';

/** Google delivers mail inside the Workspace domain without Authentication-Results (spec 7.4, C4 ruling). */
export const INTERNAL_DOMAIN = 'becomeindelible.com';
export function senderVerified(input: { auth_pass: boolean; auth_basis?: string; from_email: string }): boolean {
  if (!input.auth_pass) return false;
  if (input.auth_basis !== 'google_internal') return true;
  // The internal path is only ever valid for our own domain, whatever the machine says.
  return input.from_email.trim().toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`);
}

export const REPLY_MAX_CHARS = 4000;
export const RAW_MAX_CHARS = 20000;

export const inboundSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{8,24}$/).optional(),
    task_id: z.string().uuid().optional(),
    from_email: z.string().min(3).max(320),
    text: z.string().max(60000),
    raw: z.string().max(400000).default(''),
    gmail_id: z.string().min(1).max(64),
    rfc_message_id: z.string().min(1).max(255),
    gmail_thread_id: z.string().max(64).nullish(),
    auth_pass: z.boolean(),
    /** How the machine verified the sender: the receiving server's Authentication-Results, or Google's own same-domain delivery. */
    auth_basis: z.enum(['authentication_results', 'google_internal']).optional(),
    attachment_ids: z.array(z.string().uuid()).max(10).default([]),
  })
  .refine((v) => v.token || v.task_id, { message: 'token or task_id required' });
export type InboundInput = z.infer<typeof inboundSchema>;

export type InboundOutcome =
  | { status: 'no_conversation' }
  | { status: 'repeat'; conversation_id: string; comment_id: string }
  | { status: 'quarantined'; conversation_id: string; comment_id: string; reason: 'sender' | 'auth' }
  | { status: 'ingested'; conversation_id: string; comment_id: string; route: 'job' | 'person'; job_id: string | null };

/** `email:` + a short hash of the RFC Message-ID: the comment's `client_ref` column holds 64 characters. */
export const emailRef = (rfcId: string) => `email:${crypto.createHash('sha256').update(rfcId.trim().replace(/^<|>$/g, '')).digest('hex').slice(0, 40)}`;
const quarantineRef = (rfcId: string) => `emailq:${emailRef(rfcId).slice(6, 46)}`;

export async function findConversation(input: { token?: string; task_id?: string }) {
  if (input.token) {
    const c = await prisma.chatConversation.findUnique({ where: { email_token: input.token } });
    if (c) return c;
  }
  if (input.task_id) return prisma.chatConversation.findUnique({ where: { task_id: input.task_id } });
  return null;
}

/** The person on this conversation whose address this is, with access to the task; null otherwise. */
export async function senderContact(convo: { task_id: string }, fromEmail: string) {
  const task = await prisma.task.findUnique({ where: { id: convo.task_id }, select: { id: true, title: true, client_title: true, client_id: true, requested_by_contact_id: true } });
  if (!task) return null;
  const want = fromEmail.trim().toLowerCase();
  const people = await noticeRecipients({ id: task.id, client_title: task.client_title ?? task.title, client_id: task.client_id, requested_by_contact_id: task.requested_by_contact_id });
  return people.find((p) => p.email.toLowerCase() === want) ?? null;
}

export async function ingestEmailReply(raw: InboundInput, opts: { now?: Date } = {}): Promise<InboundOutcome> {
  const now = opts.now ?? new Date();
  const input = inboundSchema.parse(raw);
  const convo = await findConversation(input);
  if (!convo) return { status: 'no_conversation' };

  const ref = emailRef(input.rfc_message_id);
  const seen = await prisma.comment.findFirst({ where: { client_ref: { in: [ref, quarantineRef(input.rfc_message_id)] } }, select: { id: true, task_id: true } });
  if (seen && seen.task_id === convo.task_id) return { status: 'repeat', conversation_id: convo.id, comment_id: seen.id };

  const text = input.text.trim().slice(0, REPLY_MAX_CHARS);
  const verified = senderVerified(input);
  const contact = verified ? await senderContact(convo, input.from_email) : null;

  if (!contact) {
    const reason = verified ? 'sender' : 'auth';
    // Files staged for a message that is not shown are withdrawn with it (soft delete; nothing is ever removed from disk by code).
    if (input.attachment_ids.length > 0) {
      await prisma.portalAttachment.updateMany({ where: { id: { in: input.attachment_ids }, client_id: convo.client_id, comment_id: null }, data: { is_deleted: true } });
    }
    const note = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUniqueOrThrow({ where: { id: convo.task_id }, select: { tags: true } });
      const created = await tx.comment.create({
        data: { ...(await actorLaneField()),
          task_id: convo.task_id,
          user_id: BAST_USER_ID,
          content: `Reply from ${input.from_email.slice(0, 200)} on a client chat, not shown to the client (${reason === 'auth' ? 'the sender could not be verified' : 'the address is not a person on this request'}).\n${text.slice(0, 1500) || '(no text)'}`,
          is_internal: true,
          client_visible: false,
          source: 'email',
          client_ref: quarantineRef(input.rfc_message_id),
          chat_meta: { quarantined: reason, rfc_message_id: input.rfc_message_id, gmail_id: input.gmail_id } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await tx.task.update({ where: { id: convo.task_id }, data: { tags: [...new Set([...task.tags, 'needs-mike'])] } });
      return created;
    });
    await alertTaskOwner(convo.task_id, 'Email on a client chat from an unverified sender', `A reply from ${input.from_email.slice(0, 120)} arrived on a client chat. It was kept as an internal note and not shown to the client.`);
    return { status: 'quarantined', conversation_id: convo.id, comment_id: note.id, reason };
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${convo.id}`}))`;
    const dup = await tx.comment.findUnique({ where: { client_ref: ref }, select: { id: true } });
    if (dup) return { repeat: true as const, commentId: dup.id };
    const fresh = await tx.chatConversation.findUniqueOrThrow({ where: { id: convo.id } });
    const task = await tx.task.findUniqueOrThrow({
      where: { id: convo.task_id },
      select: { id: true, title: true, client_title: true, assignee_id: true, client_id: true, project_id: true, charter_id: true, site_id: true, tags: true },
    });
    const comment = await tx.comment.create({
      data: { ...(await actorLaneField()),
        task_id: convo.task_id,
        user_id: null,
        content: text || '(attachment)',
        is_internal: false,
        client_visible: true,
        author_contact_id: contact.id,
        client_ref: ref,
        source: 'email',
        chat_meta: { via: 'email', gmail_id: input.gmail_id, rfc_message_id: input.rfc_message_id, raw_email: input.raw.slice(0, RAW_MAX_CHARS) } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await bindAttachments(tx, { clientId: fresh.client_id, ids: input.attachment_ids, taskId: convo.task_id, commentId: comment.id, conversationId: convo.id, contactIds: [contact.id], now });
    const tags = task.tags.filter((t) => t !== 'awaiting-clarification' && t !== 'chat-question');
    await tx.task.update({ where: { id: task.id }, data: { tags } });
    // State, slots and the open ask stay: the reply job reads them (a "send" answers the summary).
    await tx.chatConversation.update({
      where: { id: convo.id },
      data: {
        slots: { ...readSlots(fresh.slots), question_closed_at: null } as Prisma.InputJsonValue,
        ...(input.gmail_thread_id && !fresh.gmail_thread_id ? { gmail_thread_id: input.gmail_thread_id } : {}),
      },
    });
    await refreshTaskDescription(tx, convo.id);
    await onChatClientAnswered(tx, task.id, now);
    if (fresh.state === 'filed' || fresh.state === 'with_person' || fresh.state === 'closed') {
      await onClientMessage(
        tx,
        { id: task.id, client_title: task.client_title ?? task.title, assignee_id: task.assignee_id, client_id: task.client_id, project_id: task.project_id, charter_id: task.charter_id, site_id: task.site_id },
        { contact_ids: [contact.id], comment_id: comment.id },
        now
      );
    }
    return { repeat: false as const, commentId: comment.id, state: fresh.state, siteId: fresh.site_id, task };
  });

  if (result.repeat) return { status: 'repeat', conversation_id: convo.id, comment_id: result.commentId };

  if (['filed', 'with_person', 'closed'].includes(result.state) && result.task.assignee_id && result.task.assignee_id !== BAST_USER_ID) {
    try {
      await createNotification({
        userId: result.task.assignee_id,
        type: 'comment_added',
        title: `New message on "${result.task.client_title ?? result.task.title}"`,
        message: 'A client contact replied by email on a portal chat.',
        entityType: 'task',
        entityId: result.task.id,
      });
    } catch (error) {
      console.error('portal chat email notification failed', error);
    }
  }

  if (result.state === 'with_person' || result.state === 'closed') {
    return { status: 'ingested', conversation_id: convo.id, comment_id: result.commentId, route: 'person', job_id: null };
  }
  const avail = await chatAvailability({ contactId: contact.id, clientId: convo.client_id, siteId: result.siteId, conversationId: convo.id, now });
  if (avail.available) {
    const { job } = await enqueueJob({ type: 'chat_email_reply', conversationId: convo.id, taskId: convo.task_id, clientId: convo.client_id, contactId: contact.id, upToCommentId: result.commentId, now });
    return { status: 'ingested', conversation_id: convo.id, comment_id: result.commentId, route: 'job', job_id: job.id };
  }
  // The assistant is off, capped or the runner is down: a person reads it, and the client is told so.
  await handOff(convo.id, { reason: 'other', draft: '', say: CANNED_LINE, now });
  await emailFixedLine({ conversationId: convo.id, contactId: contact.id, text: CANNED_LINE, key: `ingest:${result.commentId}`, now });
  return { status: 'ingested', conversation_id: convo.id, comment_id: result.commentId, route: 'person', job_id: null };
}
