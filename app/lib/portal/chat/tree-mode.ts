/**
 * Tree mode (phase C spec 1.7, 2.3 step 6): the phase B questions mapped to slots. Used when the
 * model is not available or a job expired. Deterministic and fixed-copy; no model, no job. The
 * conversation stays in tree mode until a later job succeeds. At most one question per turn.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { OPENING_CHOICES, type IntakeType } from '@/lib/portal/intake/tree';
import { CHOICE_LABELS, CANNED_LINE, TREE, URGENT_PROMPT } from '@/lib/portal/chat/copy';
import { postAssistantComment } from '@/lib/portal/chat/assistant-comment';
import { refreshTaskDescription } from '@/lib/portal/chat/description';
import { clientSites, conversationPages, rankPages, readAsk, readSlots, sectionsOf, type AskSlot, type OpenAsk, type Slots } from '@/lib/portal/chat/slots';

const FILE_WORDS = /\b(photo|picture|image|logo|file|pdf|document|attach(?:ed|ment)?|headshot|banner|graphic|brochure|menu)\b/i;
export const MAX_PAGE_CHOICES = 8;

export type TreeStep = { kind: 'ask'; ask: OpenAsk } | { kind: 'summary' };

export interface TreeInput {
  slots: Slots;
  siteCount: number;
  pages: Array<{ id: string; title: string; path: string; depth?: number; sections: unknown }>;
  siteId: string | null;
}

/** Pure: the next step given what is known. A slot already asked twice is skipped ("not sure" moves on). */
export function nextTreeStep(input: TreeInput): TreeStep {
  const { slots } = input;
  const asked = slots.asked ?? [];
  const times = (s: string) => asked.filter((a) => a === s).length;
  const skip = (s: string) => times(s) >= 2;
  const change = slots.change ?? '';
  const type = slots.request_type ?? null;

  if (!type && !skip('other')) {
    return { kind: 'ask', ask: { slot: 'other', question: TREE.type, choice_ids: OPENING_CHOICES.map((o) => o.key), allow_free_text: false, allow_upload: false } };
  }
  if (!slots.site_id && !input.siteId && input.siteCount > 1 && !skip('site')) {
    return { kind: 'ask', ask: { slot: 'site', question: TREE.site, choice_ids: [], allow_free_text: false, allow_upload: false } };
  }
  const wantsPage = type === 'site_change' || type === 'new_page_feature' || type === 'content_article' || type === 'other' || type === null;
  if (wantsPage && !slots.page_id && !slots.page_text && !skip('page')) {
    const ranked = rankPages(input.pages, change).slice(0, MAX_PAGE_CHOICES).map((p) => p.id);
    return { kind: 'ask', ask: { slot: 'page', question: TREE.page, choice_ids: ranked, allow_free_text: true, allow_upload: false } };
  }
  if (type === 'site_change' && slots.page_id && !slots.section_key && !slots.section_text && !skip('section')) {
    const page = input.pages.find((p) => p.id === slots.page_id);
    const secs = sectionsOf(page).slice(0, MAX_PAGE_CHOICES).map((s) => s.key);
    return { kind: 'ask', ask: { slot: 'section', question: TREE.section, choice_ids: secs, allow_free_text: true, allow_upload: false } };
  }
  if (FILE_WORDS.test(change) && !(slots.attachment_ids?.length) && !slots.asset_none && !skip('asset')) {
    return { kind: 'ask', ask: { slot: 'asset', question: TREE.asset, choice_ids: [], allow_free_text: false, allow_upload: true } };
  }
  return { kind: 'summary' };
}

export interface Answer {
  text?: string | null;
  choice?: { slot: string; id: string } | null;
  attachment_ids?: string[];
}

/**
 * Fold one answer into the slots. A choice always counts; free text counts only for the slots that
 * take it (`textFills`: tree mode fills the open ask's slot from words, model mode leaves words to
 * the model's `record`). Pure.
 */
export function foldAnswer(
  slots: Slots,
  ask: OpenAsk | null,
  answer: Answer,
  ctx: { pages: Array<{ id: string; title: string }>; textFills: boolean }
): Slots {
  const next: Slots = { ...slots, attachment_ids: [...new Set([...(slots.attachment_ids ?? []), ...(answer.attachment_ids ?? [])])] };
  const choice = answer.choice;
  const text = (answer.text ?? '').trim();
  if (choice) {
    const id = choice.id;
    switch (choice.slot) {
      case 'site':
        next.site_id = id;
        next.page_id = null;
        next.page_text = null;
        next.section_key = null;
        next.section_text = null;
        break;
      case 'page':
        if (id === 'not_sure') next.page_text = CHOICE_LABELS.not_sure;
        else if (id !== 'another_page') {
          next.page_id = id;
          next.page_text = null;
          next.section_key = null;
          next.section_text = null;
        }
        break;
      case 'section':
        if (id === 'not_sure') next.section_text = CHOICE_LABELS.not_sure;
        else next.section_key = id;
        break;
      case 'asset':
        if (id === 'no_file') next.asset_none = true;
        else next.attachment_ids = [...new Set([...(next.attachment_ids ?? []), id])];
        break;
      case 'other':
        next.request_type = id as IntakeType;
        break;
    }
    return next;
  }
  if (ctx.textFills && ask && text) {
    switch (ask.slot) {
      case 'page': {
        const hit = ctx.pages.find((p) => p.title.trim().toLowerCase() === text.toLowerCase());
        if (hit) next.page_id = hit.id;
        else next.page_text = text.slice(0, 300);
        break;
      }
      case 'section':
        next.section_text = text.slice(0, 300);
        break;
      case 'change':
        next.change = text.slice(0, 2000);
        break;
      default:
        break;
    }
  }
  return next;
}

/** Keywords that settle a request type without asking, for tree mode only. */
export function typeFromUrgent(answered: string | null | undefined): IntakeType | null {
  return answered === 'site_down' || answered === 'form_checkout' ? 'broken' : null;
}

export type AdvanceResult = 'asked' | 'summary' | 'urgent' | 'handoff' | 'noop';

/**
 * Post the next deterministic step when the client's last message has not been answered and no
 * job is open for it. Idempotent: it does nothing when the thread already ends with a reply.
 */
export async function advanceTree(conversationId: string, opts: { now?: Date } = {}): Promise<AdvanceResult> {
  const now = opts.now ?? new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${conversationId}`}))`;
    const convo = await tx.chatConversation.findUnique({ where: { id: conversationId } });
    if (!convo || convo.state === 'with_person' || convo.state === 'closed') return 'noop' as const;
    const open = await tx.engineJob.count({ where: { conversation_id: conversationId, status: { in: ['queued', 'claimed'] } } });
    if (open > 0) return 'noop' as const;
    const recentRows = await tx.comment.findMany({
      where: { task_id: convo.task_id, is_deleted: false, is_internal: false, OR: [{ author_contact_id: { not: null } }, { source: 'assistant' }, { client_visible: true }] },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { author_contact_id: true, content: true, chat_meta: true },
    });
    // A fixed urgent line is an acknowledgement, not an answer: the clarifying still owes a step.
    const last = recentRows.find((r) => !((r.chat_meta as { urgent?: unknown } | null)?.urgent));
    if (!last || !last.author_contact_id) return 'noop' as const;

    if (convo.state === 'filed') return 'handoff' as const;

    let slots = readSlots(convo.slots);
    if (!slots.change) {
      const first = await tx.comment.findFirst({ where: { task_id: convo.task_id, author_contact_id: { not: null } }, orderBy: { created_at: 'asc' }, select: { content: true } });
      if (first) slots = { ...slots, change: first.content.slice(0, 2000) };
    }
    const forced = typeFromUrgent(slots.urgent_answered);
    if (forced && !slots.request_type) slots = { ...slots, request_type: forced };

    if (slots.urgent_offered) {
      await postAssistantComment(tx, convo.task_id, URGENT_PROMPT, { tree: true, urgent_prompt: true });
      await tx.chatConversation.update({ where: { id: conversationId }, data: { slots: slots as Prisma.InputJsonValue } });
      return 'urgent' as const;
    }

    const sites = await clientSites(convo.client_id);
    const siteId = slots.site_id ?? convo.site_id ?? (sites.length === 1 ? sites[0].id : null);
    const pages = await conversationPages(convo.client_id, siteId);
    const step = nextTreeStep({ slots, siteCount: sites.length, pages, siteId });
    if (siteId && !slots.site_id) slots = { ...slots, site_id: siteId };

    const task = await tx.task.findUnique({ where: { id: convo.task_id }, select: { tags: true } });
    const tags = new Set(task?.tags ?? []);
    if (step.kind === 'ask') {
      const ask = step.ask;
      if (ask.slot === 'site') ask.choice_ids = sites.map((s) => s.id);
      slots = { ...slots, asked: [...(slots.asked ?? []), ask.slot] };
      const posted = await postAssistantComment(tx, convo.task_id, ask.question, { tree: true, ask_slot: ask.slot });
      tags.add('awaiting-clarification');
      await tx.task.update({ where: { id: convo.task_id }, data: { tags: [...tags] } });
      await tx.chatConversation.update({
        where: { id: conversationId },
        data: { slots: slots as Prisma.InputJsonValue, open_ask: { ...ask, comment_id: posted.id } as unknown as Prisma.InputJsonValue, mode: 'tree' },
      });
      await refreshTaskDescription(tx, conversationId);
      return 'asked' as const;
    }
    // Summary: the snapshot the confirm step reads.
    const version = convo.summary_version + 1;
    const snap = {
      request_type: (slots.request_type ?? 'other') as IntakeType,
      site_id: slots.site_id ?? null,
      page_id: slots.page_id ?? null,
      page_text: slots.page_text ?? null,
      section: slots.section_text ?? (slots.section_key ?? null),
      change: slots.change ?? '',
      attachment_ids: slots.attachment_ids ?? [],
      text: null,
    };
    slots = { ...slots, summary: snap };
    await postAssistantComment(tx, convo.task_id, TREE.summaryIntro, { tree: true, summary_version: version });
    tags.delete('awaiting-clarification');
    await tx.task.update({ where: { id: convo.task_id }, data: { tags: [...tags] } });
    await tx.chatConversation.update({
      where: { id: conversationId },
      data: { slots: slots as Prisma.InputJsonValue, open_ask: Prisma.DbNull, summary_version: version, summary_text: null, state: 'confirming', mode: 'tree' },
    });
    await refreshTaskDescription(tx, conversationId);
    return 'summary' as const;
  });
  if (outcome === 'handoff') {
    const { handOff } = await import('@/lib/portal/chat/handoff');
    await handOff(conversationId, { reason: 'other', draft: '', say: CANNED_LINE, now });
    return 'handoff';
  }
  return outcome;
}

export { readAsk };
export type { AskSlot };
