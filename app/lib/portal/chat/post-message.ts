/**
 * A client message on an existing conversation (phase C spec 2.3 steps 1 and 2, 11.2). The words
 * are saved first, verbatim, under the contact (immutable, `client_ref` dedupe). A choice is
 * validated against the real options and its label comes from the database. Slots fill
 * deterministically from choices; free text fills them only in tree mode (model mode leaves words
 * to the model's `record`). Then the turn is routed: a job when the model is available, the fixed
 * tree otherwise.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { PortalAccess } from '@/lib/portal/access';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { createNotification } from '@/lib/services/notifications';
import { MESSAGE_LIMITS, MESSAGE_MAX_CHARS, MESSAGE_RATE_LIMIT_MESSAGE, threadTaskWhere } from '@/lib/portal/thread';
import { onClientMessage } from '@/lib/portal/waits';
import { bindAttachments, FILES_ONLY_TEXT } from '@/lib/portal/chat/attachments';
import { applyUrgentChoice, isUrgentText, type UrgentChoice, type UrgentOutcome } from '@/lib/portal/chat/urgent';
import { refreshTaskDescription } from '@/lib/portal/chat/description';
import { postAssistantComment } from '@/lib/portal/chat/assistant-comment';
import { CHANGE_PROMPT, CHOICE_LABELS, URGENT_CHOICES, URGENT_DISMISSED, URGENT_DOWNGRADED, URGENT_MARKED } from '@/lib/portal/chat/copy';
import { foldAnswer, typeFromUrgent } from '@/lib/portal/chat/tree-mode';
import { conversationPages, readAsk, readSlots, resolveChoices, type Slots } from '@/lib/portal/chat/slots';
import { syncProvisionalPlacement } from '@/lib/portal/chat/place';
import { routeTurn, type TurnRoute } from '@/lib/portal/chat/jobs';
import { newEmailToken } from '@/lib/portal/chat/file-early';
import { chatAvailability } from '@/lib/portal/chat/switches';

const TEN_MINUTES = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export interface MessageBody {
  client_ref: string;
  text?: string | null;
  choice?: { slot: string; id: string } | null;
  attachment_ids?: string[];
}

export interface PostedChat {
  created: boolean;
  comment_id: string;
  route: TurnRoute | 'repeat';
  urgent?: UrgentOutcome & { line: string };
}

/**
 * Open the conversation for a task that already exists (the work page, spec decision 2), when chat
 * is available for the contact. Returns the conversation id, or null when chat is not available.
 */
export async function ensureConversation(access: PortalAccess, taskId: string, now: Date = new Date()): Promise<string | null> {
  const existing = await prisma.chatConversation.findUnique({ where: { task_id: taskId }, select: { id: true, client_id: true } });
  if (existing) return existing.client_id === access.clientId ? existing.id : null;
  const task = await prisma.task.findFirst({ where: threadTaskWhere(access, taskId), select: { id: true, site_id: true, requested_by_contact_id: true, client_id: true } });
  if (!task?.client_id) return null;
  const avail = await chatAvailability({ contactId: access.contactId, clientId: access.clientId, siteId: task.site_id, now });
  if (!avail.available) return null;
  try {
    const created = await prisma.chatConversation.create({
      data: {
        task_id: task.id,
        client_id: task.client_id,
        site_id: task.site_id,
        opened_by_contact_id: task.requested_by_contact_id ?? access.contactId,
        state: 'filed',
        confirmed_at: now,
        slots: { site_id: task.site_id, attachment_ids: [], lazy: true } as Prisma.InputJsonValue,
        email_token: newEmailToken(),
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    const again = await prisma.chatConversation.findUnique({ where: { task_id: taskId }, select: { id: true } });
    return again?.id ?? null;
  }
}

async function labelFor(
  convo: { id: string; client_id: string; site_id: string | null },
  slots: Slots,
  slot: string,
  id: string
): Promise<string | null> {
  if (slot === 'urgent') return URGENT_CHOICES.find((c) => c.id === id)?.label ?? null;
  if (slot === 'summary') return id === 'change' ? 'Change something' : null;
  if (!['site', 'page', 'section', 'asset', 'other'].includes(slot)) return null;
  if (id === 'not_sure' && (slot === 'page' || slot === 'section')) return CHOICE_LABELS.not_sure;
  if (id === 'another_page' && slot === 'page') return CHOICE_LABELS.another_page;
  if (id === 'no_file' && slot === 'asset') return CHOICE_LABELS.no_file;
  const { choices } = await resolveChoices(convo, slots, slot as 'site', [id]);
  return choices.find((c) => c.id === id)?.label ?? null;
}

export async function postChatMessage(
  access: PortalAccess,
  contact: { id: string; name: string | null },
  conversationId: string,
  body: MessageBody,
  opts: { now?: Date } = {}
): Promise<PostedChat> {
  const now = opts.now ?? new Date();
  if (access.revoked) throw new ApiError('Not found', 404);
  const rawText = (body.text ?? '').trim();
  if (rawText.length > MESSAGE_MAX_CHARS) throw new ApiError(`Messages are 1 to ${MESSAGE_MAX_CHARS} characters.`, 400, 'bad_message');
  if (!rawText && !body.choice && !(body.attachment_ids?.length)) throw new ApiError(`Messages are 1 to ${MESSAGE_MAX_CHARS} characters.`, 400, 'bad_message');
  const ids = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${conversationId}`}))`;
    const convo = await tx.chatConversation.findUnique({ where: { id: conversationId } });
    if (!convo || convo.client_id !== access.clientId) throw new ApiError('Not found', 404);
    const task = await tx.task.findFirst({
      where: threadTaskWhere(access, convo.task_id),
      select: { id: true, title: true, client_title: true, assignee_id: true, client_id: true, project_id: true, charter_id: true, site_id: true, tags: true, client: { select: { name: true } } },
    });
    if (!task) throw new ApiError('Not found', 404);

    const dup = await tx.comment.findUnique({ where: { client_ref: body.client_ref }, select: { id: true, task_id: true, author_contact_id: true } });
    if (dup) {
      if (dup.task_id !== convo.task_id || !dup.author_contact_id || !ids.includes(dup.author_contact_id)) throw new ApiError('Not found', 404);
      return { repeat: true as const, commentId: dup.id, convo, task, urgentChoice: null as UrgentChoice | null, state: convo.state };
    }

    const [recent, today] = await Promise.all([
      tx.comment.count({ where: { author_contact_id: { in: ids }, created_at: { gte: new Date(now.getTime() - TEN_MINUTES) } } }),
      tx.comment.count({ where: { author_contact_id: { in: ids }, created_at: { gte: new Date(now.getTime() - DAY) } } }),
    ]);
    if (recent >= MESSAGE_LIMITS.per_ten_minutes || today >= MESSAGE_LIMITS.per_day) throw new ApiError(MESSAGE_RATE_LIMIT_MESSAGE, 429, 'rate_limited');

    let slots = readSlots(convo.slots);
    const ask = readAsk(convo.open_ask);
    let label: string | null = null;
    let urgentChoice: UrgentChoice | null = null;
    if (body.choice) {
      const { slot, id } = body.choice;
      if (slot === 'urgent') {
        if (!slots.urgent_offered) throw new ApiError('That choice is not available.', 400, 'bad_choice');
      } else if (slot === 'summary') {
        if (convo.state !== 'confirming') throw new ApiError('That choice is not available.', 400, 'bad_choice');
      } else {
        if (!ask || ask.slot !== slot) throw new ApiError('That choice is not available.', 400, 'bad_choice');
        const offered = new Set([...ask.choice_ids, 'not_sure', 'another_page', 'no_file']);
        if (!offered.has(id) && slot !== 'page') throw new ApiError('That choice is not available.', 400, 'bad_choice');
      }
      label = await labelFor(convo, slots, slot, id);
      if (!label) throw new ApiError('That choice is not available.', 400, 'bad_choice');
      if (slot === 'urgent') urgentChoice = id as UrgentChoice;
    }

    const content = rawText || label || FILES_ONLY_TEXT;
    const comment = await tx.comment.create({
      data: {
        task_id: convo.task_id,
        user_id: null,
        content,
        is_internal: false,
        client_visible: true,
        author_contact_id: contact.id,
        client_ref: body.client_ref,
        source: 'portal',
        chat_meta: body.choice && label ? ({ choice: { slot: body.choice.slot, id: body.choice.id, label } } as Prisma.InputJsonValue) : Prisma.DbNull,
      },
      select: { id: true },
    });
    const bound = await bindAttachments(tx, {
      clientId: access.clientId, ids: body.attachment_ids ?? [], taskId: convo.task_id, commentId: comment.id, conversationId: convo.id, contactIds: ids, now,
    });

    // Slots: choices always; words only in tree mode.
    const pages = await conversationPages(convo.client_id, convo.site_id ?? slots.site_id);
    const choiceForSlots = body.choice && !['urgent', 'summary'].includes(body.choice.slot) ? body.choice : null;
    slots = foldAnswer(slots, ask, { text: rawText, choice: choiceForSlots, attachment_ids: bound }, { pages, textFills: convo.mode === 'tree' });
    if (urgentChoice) {
      const forced = typeFromUrgent(urgentChoice);
      if (forced && !slots.request_type) slots = { ...slots, request_type: forced };
    }
    if (rawText && isUrgentText(rawText) && !slots.urgent_answered) slots = { ...slots, urgent_offered: true };
    slots = { ...slots, question_closed_at: null };

    let state = convo.state;
    if (body.choice?.slot === 'summary') state = 'clarifying';
    else if (state === 'confirming' && rawText) state = 'clarifying';

    const tags = new Set(task.tags);
    tags.delete('awaiting-clarification');
    tags.delete('chat-question');
    await tx.task.update({ where: { id: task.id }, data: { tags: [...tags] } });

    const siteChanged = slots.site_id && slots.site_id !== convo.site_id;
    await tx.chatConversation.update({
      where: { id: convo.id },
      data: { slots: slots as Prisma.InputJsonValue, open_ask: Prisma.DbNull, state, ...(siteChanged ? { site_id: slots.site_id } : {}) },
    });
    if (siteChanged || (choiceForSlots?.slot === 'other')) {
      await syncProvisionalPlacement(tx, access, task.id, { type: slots.request_type ?? 'other', siteId: slots.site_id ?? convo.site_id, now });
    }
    if (body.choice?.slot === 'summary') {
      const q = await postAssistantComment(tx, convo.task_id, CHANGE_PROMPT, { fixed: true });
      await tx.chatConversation.update({
        where: { id: convo.id },
        data: { open_ask: { slot: 'change', question: CHANGE_PROMPT, choice_ids: [], allow_free_text: true, allow_upload: true, comment_id: q.id } as unknown as Prisma.InputJsonValue },
      });
    }
    await refreshTaskDescription(tx, convo.id);

    // Once the request is with the team, a client message must reach a person.
    if (state === 'filed' || state === 'with_person') {
      await onClientMessage(
        tx,
        { id: task.id, client_title: task.client_title ?? task.title, assignee_id: task.assignee_id, client_id: task.client_id, project_id: task.project_id, charter_id: task.charter_id, site_id: task.site_id },
        { contact_ids: ids, comment_id: comment.id },
        now
      );
    }
    return { repeat: false as const, commentId: comment.id, convo, task, urgentChoice, state };
  });

  if (result.repeat) return { created: false, comment_id: result.commentId, route: 'repeat' };

  let urgent: PostedChat['urgent'];
  if (result.urgentChoice) {
    const out = await applyUrgentChoice(result.convo.id, result.urgentChoice, { now });
    const line = out.dismissed ? URGENT_DISMISSED : out.alerted ? URGENT_MARKED : URGENT_DOWNGRADED;
    await prisma.$transaction(async (tx) => {
      await postAssistantComment(tx, result.convo.task_id, line, { fixed: true, urgent: result.urgentChoice });
    });
    urgent = { ...out, line };
  }

  if ((result.state === 'filed' || result.state === 'with_person') && result.task.assignee_id && result.task.assignee_id !== BAST_USER_ID) {
    try {
      await createNotification({
        userId: result.task.assignee_id,
        type: 'comment_added',
        title: `New message on "${result.task.client_title ?? result.task.title}"`,
        message: `${contact.name?.trim() || 'A client contact'} wrote in the portal chat.`,
        entityType: 'task',
        entityId: result.task.id,
      });
    } catch (error) {
      console.error('portal chat message notification failed', error);
    }
  }

  // An urgent click or a "not urgent" answer does not itself need a reply job; the clarifying carries on.
  const route: TurnRoute = body.choice?.slot === 'summary' ? 'none' : await routeTurn({ conversationId: result.convo.id, contactId: access.contactId, commentId: result.commentId, now });
  return { created: true, comment_id: result.commentId, route, ...(urgent ? { urgent } : {}) };
}

