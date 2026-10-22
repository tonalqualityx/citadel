/**
 * What the client's chat page polls (phase C spec 11.2 `GET /api/portal/chat/:id`): the thread,
 * whether the assistant is writing, and the one thing the client can do next (an ask with real
 * choices, the summary card, or the urgent choices). Expires a stale job first (spec 2.3 step 6),
 * so the fallback works when the machine is down. Everything is an allow-list; labels come from the
 * database; no tags, staff names or ids beyond the ones the client needs to answer.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { PortalAccess } from '@/lib/portal/access';
import { threadCommentWhere, threadTaskWhere } from '@/lib/portal/thread';
import { destinationLine, EMERGENCY_LINE, QUOTE_LINE, type IntakeType } from '@/lib/portal/intake/tree';
import { planLabel } from '@/lib/portal/engagement';
import { ASSISTANT_NAME, BUTTONS, HANDOFF_BANNER, SENT_LINES, SUMMARY_LABELS, URGENT_CHOICES, URGENT_PROMPT, WRITING_LABELS } from '@/lib/portal/chat/copy';
import { expireAndAdvance } from '@/lib/portal/chat/jobs';
import { placeFor } from '@/lib/portal/chat/place';
import { clientSites, conversationPages, pageLabel, readAsk, readSlots, resolveChoices, sectionsOf, siteLabel } from '@/lib/portal/chat/slots';

export const STILL_WRITING_MS = 15_000;
export const CHECKING_WINDOW_MS = 12_000;
const MAX_MESSAGES = 500;

export const STAFF_REPLIED_LINE = (firstName: string | null) => `${firstName ?? 'A person'} from Indelible replied.`;

/** First word of a staff user's name, or null when there is none. */
export function firstNameOf(name: string | null | undefined): string | null {
  return (name ?? '').trim().split(/\s+/)[0] || null;
}

export interface ViewMessage {
  id: string;
  who: 'client' | 'assistant' | 'team';
  mine: boolean;
  name: string;
  text: string;
  created_at: string;
  sources: Array<{ label: string; range: string }>;
  attachments: Array<{ id: string; name: string; type: string; size: number; url: string }>;
}

export async function loadChatView(access: PortalAccess, conversationId: string, opts: { after?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const convoRow = await prisma.chatConversation.findUnique({ where: { id: conversationId }, select: { id: true, client_id: true, task_id: true } });
  if (!convoRow || convoRow.client_id !== access.clientId) throw new ApiError('Not found', 404);
  const task0 = await prisma.task.findFirst({ where: threadTaskWhere(access, convoRow.task_id), select: { id: true } });
  if (!task0) throw new ApiError('Not found', 404);

  await expireAndAdvance(conversationId, now);

  const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const slots = readSlots(convo.slots);
  const ids = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];

  let afterDate: Date | null = null;
  if (opts.after) {
    const a = await prisma.comment.findFirst({ where: { id: opts.after, task_id: convo.task_id }, select: { created_at: true } });
    afterDate = a?.created_at ?? null;
  }
  const rows = await prisma.comment.findMany({
    where: { task_id: convo.task_id, AND: [threadCommentWhere(), afterDate ? { created_at: { gt: afterDate } } : {}] },
    orderBy: { created_at: 'asc' },
    take: MAX_MESSAGES,
    select: { id: true, content: true, created_at: true, source: true, chat_meta: true, author_contact_id: true, author_contact: { select: { name: true } } },
  });
  const atts = rows.length
    ? await prisma.portalAttachment.findMany({
        where: { comment_id: { in: rows.map((r) => r.id) }, is_deleted: false },
        select: { id: true, comment_id: true, filename: true, content_type: true, size_bytes: true },
      })
    : [];
  const messages: ViewMessage[] = rows.map((r) => {
    const who = r.author_contact_id ? 'client' : r.source === 'assistant' ? 'assistant' : 'team';
    const meta = (r.chat_meta ?? {}) as { sources?: Array<{ label?: string; range?: string }> };
    return {
      id: r.id,
      who,
      mine: Boolean(r.author_contact_id && ids.includes(r.author_contact_id)),
      name: who === 'client' ? r.author_contact?.name?.trim() || 'A member of your team' : who === 'assistant' ? ASSISTANT_NAME : 'Indelible team',
      text: r.content,
      created_at: r.created_at.toISOString(),
      sources: who === 'assistant' ? (meta.sources ?? []).filter((s) => s.label).map((s) => ({ label: String(s.label), range: String(s.range ?? '') })) : [],
      attachments: atts
        .filter((a) => a.comment_id === r.id)
        .map((a) => ({ id: a.id, name: a.filename, type: a.content_type, size: a.size_bytes, url: `/api/portal/attachments/${a.id}` })),
    };
  });

  const open = await prisma.engineJob.findMany({
    where: { conversation_id: convo.id, status: { in: ['queued', 'claimed'] } },
    orderBy: { queued_at: 'asc' },
    select: { id: true, queued_at: true },
  });
  const writing = open.length > 0;
  let writing_note: 'writing' | 'still_writing' | 'checking_numbers' | null = null;
  if (writing) {
    writing_note = now.getTime() - open[0].queued_at.getTime() >= STILL_WRITING_MS ? 'still_writing' : 'writing';
    const recentCall = await prisma.engineToolCall.findFirst({
      where: { job_id: { in: open.map((j) => j.id) }, created_at: { gte: new Date(now.getTime() - CHECKING_WINDOW_MS) } },
      select: { id: true },
    });
    if (recentCall) writing_note = 'checking_numbers';
  }

  const withPerson = convo.state === 'with_person';
  // Has a person on the team answered since the handoff? Read apart from `after`, so a poll that
  // carries no new messages still knows. Staff replies are signed "Indelible"; only this callout names the person.
  let staffReply: { first_name: string | null; at: string } | null = null;
  if (withPerson) {
    const note = await prisma.comment.findFirst({
      where: { task_id: convo.task_id, is_internal: true, chat_meta: { path: ['handoff'], equals: true } },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });
    const reply = await prisma.comment.findFirst({
      where: {
        task_id: convo.task_id,
        AND: [threadCommentWhere(), { author_contact_id: null }, { OR: [{ source: null }, { source: { not: 'assistant' } }] }, note ? { created_at: { gt: note.created_at } } : {}],
      },
      orderBy: { created_at: 'desc' },
      select: { created_at: true, user: { select: { name: true } } },
    });
    if (reply) staffReply = { first_name: firstNameOf(reply.user?.name), at: reply.created_at.toISOString() };
  }
  const urgent = !writing && slots.urgent_offered && !slots.urgent_answered ? { prompt: URGENT_PROMPT, choices: URGENT_CHOICES.map((c) => ({ id: c.id, label: c.label })) } : null;

  let pending: unknown = null;
  if (!writing && !withPerson && convo.state !== 'closed') {
    if (convo.state === 'confirming' && slots.summary) pending = await summaryCard(access, convo, slots);
    else {
      const ask = readAsk(convo.open_ask);
      if (ask) {
        const { choices } = await resolveChoices(convo, slots, ask.slot, ask.choice_ids);
        pending = {
          kind: 'ask',
          slot: ask.slot,
          question: ask.question,
          choices,
          allow_free_text: ask.allow_free_text,
          allow_upload: ask.allow_upload,
          search_pages: ask.slot === 'page',
        };
      }
    }
  }

  return {
    conversation_id: convo.id,
    task_id: convo.task_id,
    // The conversation's site (or the one the client chose), so "Another page" can search its pages.
    site_id: convo.site_id ?? slots.site_id ?? null,
    state: convo.state,
    mode: convo.mode,
    messages,
    writing,
    writing_note,
    writing_label: writing_note ? WRITING_LABELS[writing_note] : null,
    pending,
    urgent,
    staff_reply: staffReply,
    banner: withPerson ? (staffReply ? STAFF_REPLIED_LINE(staffReply.first_name) : HANDOFF_BANNER) : convo.state === 'filed' ? `${SENT_LINES.heading} ${SENT_LINES.more}` : null,
    poll_seconds: writing ? 3 : withPerson ? 8 : 30,
  };
}

async function summaryCard(
  access: PortalAccess,
  convo: { id: string; client_id: string; site_id: string | null; summary_version: number; task_id: string },
  slots: ReturnType<typeof readSlots>
) {
  const snap = slots.summary!;
  const sites = await clientSites(convo.client_id);
  const site = sites.find((s) => s.id === snap.site_id);
  const pages = await conversationPages(convo.client_id, snap.site_id ?? convo.site_id);
  const page = pages.find((p) => p.id === snap.page_id);
  const section = snap.section ? sectionsOf(page).find((s) => s.key === snap.section)?.heading ?? snap.section : null;
  const files = snap.attachment_ids.length
    ? await prisma.portalAttachment.findMany({ where: { id: { in: snap.attachment_ids }, client_id: convo.client_id }, select: { id: true, filename: true, content_type: true } })
    : [];
  const task = await prisma.task.findUnique({ where: { id: convo.task_id }, select: { tags: true } });

  const placed = await placeFor(prisma as unknown as Prisma.TransactionClient, access, {
    type: snap.request_type as IntakeType,
    siteId: snap.site_id ?? null,
    chosenProjectId: null,
    now: new Date(),
  });
  let destination: string | null = null;
  let quote = false;
  let choose: Array<{ id: string; name: string }> | null = null;
  if (placed.placement.ok) {
    const p = placed.placement;
    quote = p.quote;
    let projectName: string | null = null;
    let plan: string | null = null;
    if (p.chain === 'project' && p.project_id) projectName = (await prisma.project.findUnique({ where: { id: p.project_id }, select: { name: true } }))?.name ?? null;
    if (p.chain === 'charter' && p.charter_id) {
      const ch = await prisma.charter.findUnique({ where: { id: p.charter_id }, select: { charter_wares: { where: { is_active: true }, select: { ware: { select: { name: true } } } } } });
      plan = planLabel((ch?.charter_wares ?? []).map((w) => w.ware?.name ?? ''));
    }
    destination = destinationLine({ chain: p.chain, project_name: projectName, plan_name: plan, site_name: site ? siteLabel(site) : null });
  } else {
    choose = placed.candidates;
  }
  return {
    kind: 'summary',
    version: convo.summary_version,
    text: snap.text,
    rows: [
      { label: SUMMARY_LABELS.site, value: site ? siteLabel(site) : 'Not chosen' },
      { label: SUMMARY_LABELS.page, value: page ? pageLabel(page) : snap.page_text ?? 'Not sure' },
      { label: SUMMARY_LABELS.section, value: section ?? 'Not sure' },
      { label: SUMMARY_LABELS.change, value: snap.change },
    ],
    files: files.map((f) => ({ id: f.id, name: f.filename, type: f.content_type, url: `/api/portal/attachments/${f.id}` })),
    destination,
    quote_line: quote ? QUOTE_LINE : null,
    urgent_line: task?.tags.includes('emergency') ? EMERGENCY_LINE : null,
    choose_project: choose,
    buttons: { send: BUTTONS.send, change: BUTTONS.change },
  };
}
