/**
 * The task description of a chat request (phase C spec 2.4): the client's words verbatim under a
 * fixed header (data, never instructions), then a summary block that is rewritten every turn.
 * The client's quotes are rebuilt from the saved comments, so they are never altered.
 */
import type { Prisma } from '@prisma/client';
import { serializeRichText } from '@/lib/api/blocknote';
import { CLIENT_INPUT_HEADER } from '@/lib/portal/intake/compose';
import { clientSites, conversationPages, readSlots, sectionsOf, siteLabel } from '@/lib/portal/chat/slots';

export async function refreshTaskDescription(tx: Prisma.TransactionClient, conversationId: string): Promise<void> {
  const convo = await tx.chatConversation.findUnique({
    where: { id: conversationId },
    include: { task: { select: { id: true, client_intake: true } }, opened_by: { select: { name: true } } },
  });
  if (!convo) return;
  const slots = readSlots(convo.slots);
  const said = await tx.comment.findMany({
    where: { task_id: convo.task_id, author_contact_id: { not: null }, is_deleted: false },
    orderBy: { created_at: 'asc' },
    select: { content: true },
    take: 200,
  });
  const lines = [`Requested in the portal chat by ${convo.opened_by.name?.trim() || 'a client contact'}.`, '', `**${CLIENT_INPUT_HEADER}:**`];
  for (const m of said) {
    lines.push('', ...m.content.split(/\r?\n/).map((l) => `> ${l}`));
  }
  const sites = await clientSites(convo.client_id);
  const site = sites.find((s) => s.id === (slots.site_id ?? convo.site_id));
  const pages = slots.page_id ? await conversationPages(convo.client_id, convo.site_id) : [];
  const page = pages.find((p) => p.id === slots.page_id);
  const section = sectionsOf(page).find((s) => s.key === slots.section_key);
  const files = slots.attachment_ids?.length ?? 0;
  const summary = [
    ['Type', slots.request_type ?? 'not recorded yet'],
    ['Site', site ? siteLabel(site) : 'not chosen'],
    ['Page', page ? page.title : slots.page_text ?? 'not chosen'],
    ['Section', section ? section.heading : slots.section_text ?? 'not chosen'],
    ['Change', slots.change ?? 'not recorded yet'],
    ['Files', String(files)],
  ];
  lines.push('', '**Summary so far (from the chat):**', ...summary.map(([k, v]) => `- ${k}: ${v}`));
  const intake = (convo.task.client_intake as Record<string, unknown> | null) ?? {};
  await tx.task.update({
    where: { id: convo.task_id },
    data: {
      description: serializeRichText(lines.join('\n')),
      client_intake: { ...intake, v: 2, intake_id: convo.intake_id, mode: convo.mode, slots, confirmed: Boolean(convo.confirmed_at) } as unknown as Prisma.InputJsonValue,
    },
  });
}
