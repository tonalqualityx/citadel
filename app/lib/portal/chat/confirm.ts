/**
 * Confirm (phase C spec 2.5). "Send to the team" re-runs placement with the confirmed type, site
 * and project choice, moves the task if it changed, applies the scope gate and tags, removes
 * chat-clarifying and awaiting-clarification, retitles from the summary, links the attachments,
 * and runs phase B `onRequestFiled`. All of it deterministic; the model has no part in it.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { PortalAccess } from '@/lib/portal/access';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { composeTitle } from '@/lib/portal/intake/compose';
import { KIND_TAGS, type IntakeType } from '@/lib/portal/intake/tree';
import { WORDPRESS_ASSIGNEE_EMAIL } from '@/lib/portal/intake/file-request';
import { onRequestFiled } from '@/lib/portal/waits';
import { notifyNewPortalRequest } from '@/lib/portal/staff-notify';
import { refreshTaskDescription } from '@/lib/portal/chat/description';
import { postAssistantComment } from '@/lib/portal/chat/assistant-comment';
import { placeFor } from '@/lib/portal/chat/place';
import { SENT_LINES } from '@/lib/portal/chat/copy';
import { readSlots } from '@/lib/portal/chat/slots';

export interface Confirmed {
  already: boolean;
  quote: boolean;
  urgent: boolean;
  lines: string[];
}

export async function confirmConversation(
  access: PortalAccess,
  conversationId: string,
  input: { summary_version: number; project_id?: string | null },
  opts: { now?: Date; viaEmail?: boolean } = {}
): Promise<Confirmed> {
  const now = opts.now ?? new Date();
  if (access.revoked || access.role === 'none') throw new ApiError('Your account can look at requests but not send them. Please ask the account owner.', 403, 'no_permission');

  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${conversationId}`}))`;
    const convo = await tx.chatConversation.findUnique({ where: { id: conversationId }, include: { task: true } });
    if (!convo || convo.client_id !== access.clientId) throw new ApiError('Not found', 404);
    if (convo.state === 'filed' && convo.confirmed_at) return { already: true as const, quote: convo.task.tags.includes('quote'), urgent: convo.task.tags.includes('emergency'), task: convo.task, notify: false };
    if (convo.state !== 'confirming') throw new ApiError('There is nothing to send yet.', 409, 'not_confirming');
    if (convo.summary_version !== input.summary_version) throw new ApiError('That summary changed. Please check it again.', 409, 'stale_summary');
    const slots = readSlots(convo.slots);
    const snap = slots.summary;
    if (!snap) throw new ApiError('There is nothing to send yet.', 409, 'not_confirming');

    const type = snap.request_type as IntakeType;
    const siteId = snap.site_id ?? convo.site_id ?? null;
    if (siteId) {
      const ok = await tx.site.count({ where: { id: siteId, client_id: access.clientId, is_deleted: false } });
      if (!ok) throw new ApiError('Not found', 404);
    }
    const placed = await placeFor(tx, access, { type, siteId, chosenProjectId: input.project_id ?? null, now });
    if (!placed.placement.ok) {
      throw new ApiError('Please choose which project this is for.', 422, 'choose_project');
    }
    const placement = placed.placement;
    const sabeen = placed.isWordpress ? await tx.user.findFirst({ where: { email: WORDPRESS_ASSIGNEE_EMAIL, is_active: true }, select: { id: true } }) : null;
    let assignee = BAST_USER_ID;
    if (placed.isWordpress) assignee = sabeen?.id ?? MIKE_USER_ID;
    if (placement.owner_mike) assignee = MIKE_USER_ID;

    const emergency = convo.task.tags.includes('emergency');
    const tags = new Set(convo.task.tags.filter((t) => !['chat-clarifying', 'awaiting-clarification', 'chat-question'].includes(t)));
    for (const k of Object.values(KIND_TAGS)) tags.delete(k);
    tags.add(KIND_TAGS[type]);
    if (placement.quote) {
      tags.add('quote');
      tags.add('needs-mike');
    }
    if (placement.needs_mike) tags.add('needs-mike');
    const priority = emergency ? 1 : type === 'broken' ? 2 : 3;
    const title = composeTitle(type, snap.change || convo.task.title);

    const task = await tx.task.update({
      where: { id: convo.task_id },
      data: {
        tags: [...tags],
        title,
        client_title: title,
        priority,
        assignee_id: assignee,
        site_id: placement.site_id,
        project_id: placement.project_id,
        charter_id: placement.charter_id,
        is_retainer_work: placement.chain === 'charter',
        is_support: placement.is_support,
      },
    });
    if (snap.attachment_ids.length) {
      await tx.portalAttachment.updateMany({
        where: { id: { in: snap.attachment_ids }, client_id: access.clientId },
        data: { task_id: task.id, conversation_id: convo.id },
      });
    }
    await tx.chatConversation.update({
      where: { id: convo.id },
      data: { state: 'filed', confirmed_at: now, open_ask: Prisma.DbNull, site_id: placement.site_id ?? convo.site_id },
    });
    await postAssistantComment(tx, task.id, `${SENT_LINES.heading} ${SENT_LINES.more}`, { fixed: true, confirmed: true });
    await refreshTaskDescription(tx, convo.id);
    await tx.task.update({
      where: { id: task.id },
      data: { client_intake: { ...((await tx.task.findUnique({ where: { id: task.id }, select: { client_intake: true } }))?.client_intake as object), confirmed: true, type, placement: { chain: placement.chain, rule: placement.rule } } as Prisma.InputJsonValue },
    });
    await onRequestFiled(
      tx,
      {
        id: task.id,
        client_title: title,
        assignee_id: assignee,
        client_id: task.client_id,
        project_id: placement.project_id,
        charter_id: placement.charter_id,
        site_id: placement.site_id,
      },
      { intake_id: convo.intake_id ?? convo.id, quote: placement.quote, emergency },
      now
    );
    return { already: false as const, quote: placement.quote, urgent: emergency, task, notify: true };
  });

  if (out.notify) await notifyNewPortalRequest(out.task.id);
  return { already: out.already, quote: out.quote, urgent: out.urgent, lines: [SENT_LINES.heading, SENT_LINES.more] };
}
