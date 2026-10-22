/**
 * Filing early (phase C spec 2.4). On the client's first message, in one transaction holding
 * `pg_advisory_xact_lock(hashtext('portal-chat:' || intake_id))`, the words are saved verbatim and
 * the task is filed (type `other`, tags portal-chat + chat-clarifying), so the request exists even
 * if the page is closed before the assistant answers. A repeat returns the same task. No
 * first_response wait yet: the client is present and the assistant is answering.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { serializeRichText } from '@/lib/api/blocknote';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import type { PortalAccess } from '@/lib/portal/access';
import { composeTitle, TITLE_MAX, CLIENT_INPUT_HEADER } from '@/lib/portal/intake/compose';
import { LIMITS, requestLimitName, WORDPRESS_ASSIGNEE_EMAIL } from '@/lib/portal/intake/file-request';
import { NO_PERMISSION_MESSAGE, RATE_LIMIT_MESSAGE } from '@/lib/portal/intake/tree';
import { messageLimitName, MESSAGE_MAX_CHARS, MESSAGE_RATE_LIMIT_MESSAGE } from '@/lib/portal/thread';
import { bindAttachments, FILES_ONLY_TEXT } from '@/lib/portal/chat/attachments';
import { isUrgentText } from '@/lib/portal/chat/urgent';
import { refreshTaskDescription } from '@/lib/portal/chat/description';
import { clientSites, type Slots } from '@/lib/portal/chat/slots';
import { placeFor } from '@/lib/portal/chat/place';
import { routeTurn, type TurnRoute } from '@/lib/portal/chat/jobs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** 12 characters of base32 from crypto.randomBytes. */
export function newEmailToken(): string {
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => B32[b % 32]).join('');
}

export function firstLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** "Request: {first message}" cut at a word so the whole title fits 80 characters. */
export function provisionalTitle(text: string): string {
  const full = `Request: ${firstLine(text)}`;
  if (full.length <= TITLE_MAX) return full;
  const cut = full.slice(0, TITLE_MAX);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > 9 ? at : TITLE_MAX - 1).replace(/[\s,.;:!?-]+$/, '')}…`;
}

export interface StartBody {
  intake_id: string;
  client_ref: string;
  text: string;
  site_id?: string | null;
  attachment_ids?: string[];
}

export interface Started {
  created: boolean;
  conversation_id: string;
  task_id: string;
  comment_id: string;
  mode: 'model' | 'tree';
  route: TurnRoute | 'repeat';
}

export async function startChat(
  access: PortalAccess,
  contact: { id: string; name: string | null },
  body: StartBody,
  opts: { now?: Date } = {}
): Promise<Started> {
  const now = opts.now ?? new Date();
  if (access.revoked || access.role === 'none') throw new ApiError(NO_PERMISSION_MESSAGE, 403, 'no_permission');
  const said = body.text.trim().length > 0;
  const hasFiles = (body.attachment_ids?.length ?? 0) > 0;
  // A photo with no words is a real first message (phase C: photos first); it is saved as the files-only text.
  const text = said ? body.text : FILES_ONLY_TEXT;
  if ((!said && !hasFiles) || text.length > MESSAGE_MAX_CHARS) {
    throw new ApiError(`Messages are 1 to ${MESSAGE_MAX_CHARS} characters.`, 400, 'bad_message');
  }
  const sourceRef = `portal-chat:${body.intake_id}`;
  const ids = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceRef}))`;
    const existing = await tx.chatConversation.findUnique({ where: { intake_id: body.intake_id } });
    if (existing) {
      if (existing.client_id !== access.clientId) throw new ApiError('Not found', 404);
      const first = await tx.comment.findFirst({ where: { task_id: existing.task_id, author_contact_id: { not: null } }, orderBy: { created_at: 'asc' }, select: { id: true } });
      return { created: false as const, convo: existing, commentId: first?.id ?? '' };
    }

    for (const id of [...new Set(ids)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-intake-person:${id}`}))`;
    const mine = { source: 'portal' as const, requested_by_contact_id: { in: ids }, source_ref: { startsWith: 'portal-' } };
    const [lastHour, lastDay, recent, today] = await Promise.all([
      tx.task.count({ where: { ...mine, created_at: { gte: new Date(now.getTime() - HOUR) } } }),
      tx.task.count({ where: { ...mine, created_at: { gte: new Date(now.getTime() - DAY) } } }),
      tx.comment.count({ where: { author_contact_id: { in: ids }, created_at: { gte: new Date(now.getTime() - HOUR) } } }),
      tx.comment.count({ where: { author_contact_id: { in: ids }, created_at: { gte: new Date(now.getTime() - DAY) } } }),
    ]);
    const requestLimit = requestLimitName(lastHour, lastDay);
    if (requestLimit) throw new ApiError(RATE_LIMIT_MESSAGE, 429, 'rate_limited', requestLimit);
    const messageLimit = messageLimitName(recent, today);
    if (messageLimit) throw new ApiError(MESSAGE_RATE_LIMIT_MESSAGE, 429, 'rate_limited', messageLimit);

    const sites = await tx.site.findMany({
      where: { client_id: access.clientId, is_deleted: false },
      select: { id: true, name: true, site_type: true, platform: true },
    });
    let siteId = body.site_id ?? null;
    if (siteId && !sites.some((s) => s.id === siteId)) throw new ApiError('Not found', 404);
    if (!siteId && sites.length === 1) siteId = sites[0].id;

    const placed = await placeFor(tx, access, { type: 'other', siteId, chosenProjectId: null, now });
    if (!placed.placement.ok) throw new ApiError('Please choose which project this is for.', 422, 'choose_project');
    const placement = placed.placement;
    const sabeen = placed.isWordpress
      ? await tx.user.findFirst({ where: { email: WORDPRESS_ASSIGNEE_EMAIL, is_active: true }, select: { id: true } })
      : null;
    let assignee = BAST_USER_ID;
    if (placed.isWordpress) assignee = sabeen?.id ?? MIKE_USER_ID;
    if (placement.owner_mike) assignee = MIKE_USER_ID;

    const title = said ? provisionalTitle(text) : 'Request: a photo or file';
    const task = await tx.task.create({
      data: {
        title,
        client_title: title,
        description: serializeRichText(
          said
            ? `Requested in the portal chat by ${contact.name?.trim() || 'a client contact'}.\n\n**${CLIENT_INPUT_HEADER}:**\n\n${text.split(/\r?\n/).map((l) => `> ${l}`).join('\n')}`
            : `Requested in the portal chat by ${contact.name?.trim() || 'a client contact'}, who sent files and no words yet.`
        ),
        priority: 3,
        tags: ['portal-chat', 'chat-clarifying'],
        assignee_id: assignee,
        client_id: access.clientId,
        site_id: placement.site_id,
        project_id: placement.project_id,
        charter_id: placement.charter_id,
        is_retainer_work: placement.chain === 'charter',
        is_support: placement.is_support,
        is_billable: false,
        source: 'portal',
        source_ref: sourceRef,
        requested_by_contact_id: access.contactId,
        status: 'not_started',
        needs_review: false,
        promised_to: null,
        client_intake: { v: 2, intake_id: body.intake_id, mode: 'model', slots: {}, confirmed: false },
        created_by_id: BAST_USER_ID,
      },
      select: { id: true },
    });

    const slots: Slots = { site_id: siteId, attachment_ids: [], urgent_offered: said && isUrgentText(text) };
    const convo = await tx.chatConversation.create({
      data: {
        task_id: task.id,
        client_id: access.clientId,
        site_id: siteId,
        opened_by_contact_id: access.contactId,
        intake_id: body.intake_id,
        slots: slots as Prisma.InputJsonValue,
        email_token: newEmailToken(),
      },
    });
    const comment = await tx.comment.create({
      data: {
        task_id: task.id,
        user_id: null,
        content: text,
        is_internal: false,
        client_visible: true,
        author_contact_id: contact.id,
        client_ref: body.client_ref,
        source: 'portal',
      },
      select: { id: true },
    });
    const bound = await bindAttachments(tx, {
      clientId: access.clientId,
      ids: body.attachment_ids ?? [],
      taskId: task.id,
      commentId: comment.id,
      conversationId: convo.id,
      intakeId: body.intake_id,
      contactIds: ids,
      now,
    });
    if (bound.length) await tx.chatConversation.update({ where: { id: convo.id }, data: { slots: { ...slots, attachment_ids: bound } as Prisma.InputJsonValue } });
    await refreshTaskDescription(tx, convo.id);
    return { created: true as const, convo, commentId: comment.id };
  });

  if (!result.created) {
    return { created: false, conversation_id: result.convo.id, task_id: result.convo.task_id, comment_id: result.commentId, mode: result.convo.mode, route: 'repeat' };
  }
  const route = await routeTurn({ conversationId: result.convo.id, contactId: access.contactId, commentId: result.commentId, now });
  const fresh = await prisma.chatConversation.findUnique({ where: { id: result.convo.id }, select: { mode: true } });
  return { created: true, conversation_id: result.convo.id, task_id: result.convo.task_id, comment_id: result.commentId, mode: fresh?.mode ?? 'model', route };
}

export { clientSites, composeTitle };
