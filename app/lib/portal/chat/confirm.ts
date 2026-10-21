/**
 * Confirm (phase C spec 2.5). "Send to the team" re-runs placement with the confirmed type, site
 * and project choice, moves the task if it changed, applies the scope gate and tags, removes
 * chat-clarifying and awaiting-clarification, retitles from the summary, links the attachments,
 * and runs phase B `onRequestFiled`. All of it deterministic; the model has no part in it.
 */
import { Prisma } from '@prisma/client';
import type { ChatConversation, Task } from '@prisma/client';
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
import { readSlots, type SummarySnap } from '@/lib/portal/chat/slots';
import { accessForJob } from '@/lib/engine/reads';
import { postInternalNote } from '@/lib/portal/chat/assistant-comment';
import { handOff } from '@/lib/portal/chat/handoff';

export interface Confirmed {
  already: boolean;
  quote: boolean;
  urgent: boolean;
  lines: string[];
}

type Tx = Prisma.TransactionClient;

/**
 * The deterministic filing both paths share: re-run placement, apply the scope gate and tags, retitle
 * from the summary, link the attachments, run phase B `onRequestFiled`. `confirmed` is the client's
 * "Send to the team"; `unconfirmed` is the sweep filing what is known after the client walked away
 * (no "Request sent." line to the client, and a person is asked to read it: needs-mike).
 */
async function fileFromSnapshot(
  tx: Tx,
  access: PortalAccess,
  convo: ChatConversation & { task: Task },
  snap: SummarySnap,
  opts: { projectId?: string | null; now: Date; unconfirmed: boolean }
) {
  const { now } = opts;
  const type = snap.request_type as IntakeType;
  const siteId = snap.site_id ?? convo.site_id ?? null;
  if (siteId) {
    const ok = await tx.site.count({ where: { id: siteId, client_id: access.clientId, is_deleted: false } });
    if (!ok) throw new ApiError('Not found', 404);
  }
  const placed = await placeFor(tx, access, { type, siteId, chosenProjectId: opts.projectId ?? null, now });
  if (!placed.placement.ok) {
    if (!opts.unconfirmed) throw new ApiError('Please choose which project this is for.', 422, 'choose_project');
    // The sweep cannot ask which of two builds: file on the site and let a person place it.
    const fallback = await placeFor(tx, access, { type: 'other', siteId: null, chosenProjectId: null, now });
    if (!fallback.placement.ok) throw new ApiError('Please choose which project this is for.', 422, 'choose_project');
    placed.placement = fallback.placement;
  }
  const placement = placed.placement as Extract<typeof placed.placement, { ok: true }>;
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
  if (opts.unconfirmed) {
    tags.add('needs-mike');
    tags.add('unconfirmed-chat');
  }
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
    // Only files of THIS conversation: never another conversation's, never another client's.
    await tx.portalAttachment.updateMany({
      where: { id: { in: snap.attachment_ids }, client_id: access.clientId, conversation_id: convo.id },
      data: { task_id: task.id },
    });
  }
  await tx.chatConversation.update({
    where: { id: convo.id },
    data: { state: 'filed', open_ask: Prisma.DbNull, site_id: placement.site_id ?? convo.site_id, ...(opts.unconfirmed ? {} : { confirmed_at: now }) },
  });
  if (!opts.unconfirmed) await postAssistantComment(tx, task.id, `${SENT_LINES.heading} ${SENT_LINES.more}`, { fixed: true, confirmed: true });
  await refreshTaskDescription(tx, convo.id);
  const intake = ((await tx.task.findUnique({ where: { id: task.id }, select: { client_intake: true } }))?.client_intake ?? {}) as object;
  await tx.task.update({
    where: { id: task.id },
    data: { client_intake: { ...intake, confirmed: !opts.unconfirmed, unconfirmed: opts.unconfirmed, type, placement: { chain: placement.chain, rule: placement.rule } } as Prisma.InputJsonValue },
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
  return { quote: placement.quote, urgent: emergency, task };
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
    const snap = readSlots(convo.slots).summary;
    if (!snap) throw new ApiError('There is nothing to send yet.', 409, 'not_confirming');
    const filed = await fileFromSnapshot(tx, access, convo, snap, { projectId: input.project_id, now, unconfirmed: false });
    return { already: false as const, ...filed, notify: true };
  });

  if (out.notify) await notifyNewPortalRequest(out.task.id);
  return { already: out.already, quote: out.quote, urgent: out.urgent, lines: [SENT_LINES.heading, SENT_LINES.more] };
}

// ---- Walk-away: what the sweep (slice C4) calls --------------------------------------------------

/** A question-only chat that was answered closes after this long without a new message (spec 2.5). */
export const QUESTION_CLOSE_HOURS = 24;
/** A request the client never confirmed is filed, with what is known, after this long (spec 7.2 walk-away). */
export const UNCONFIRMED_FILE_HOURS = 48;
const HOUR = 60 * 60 * 1000;

export type UnconfirmedOutcome = 'skipped' | 'closed_question' | 'filed_unconfirmed' | 'handed_off';

function describeKnown(snap: SummarySnap, extras: { page: string | null }): string {
  return [
    `Type: ${snap.request_type}`,
    `Page: ${extras.page ?? snap.page_text ?? 'not chosen'}`,
    `Section: ${snap.section ?? 'not chosen'}`,
    `Change: ${snap.change || 'not recorded'}`,
    `Files: ${snap.attachment_ids.length}`,
  ].join('. ');
}

/**
 * The hook C4's sweep calls for a conversation the client left before confirming. Idempotent and
 * safe to call early: it re-checks, under the conversation lock, that the conversation is still
 * clarifying or confirming, has no job in flight and has been quiet long enough.
 *
 *  - A question the assistant answered (close_question) closes the task as done, tagged chat-question,
 *    after 24 hours, so question chats never sit in anyone's queue.
 *  - A request is filed after 48 hours with what is known (the recorded summary, or the slots, or at
 *    least the client's first words): on the chain, tagged `unconfirmed-chat` and `needs-mike`, with
 *    an internal note. The client is not sent "Request sent." because they never sent it.
 */
export async function closeUnconfirmed(conversationId: string, opts: { now?: Date } = {}): Promise<UnconfirmedOutcome> {
  const now = opts.now ?? new Date();
  const pre = await prisma.chatConversation.findUnique({ where: { id: conversationId }, select: { client_id: true, opened_by_contact_id: true } });
  if (!pre) return 'skipped';
  const access = await accessForJob({ client_id: pre.client_id, contact_id: pre.opened_by_contact_id });

  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${conversationId}`}))`;
    const convo = await tx.chatConversation.findUnique({ where: { id: conversationId }, include: { task: true } });
    if (!convo || (convo.state !== 'clarifying' && convo.state !== 'confirming')) return { outcome: 'skipped' as UnconfirmedOutcome };
    const open = await tx.engineJob.count({ where: { conversation_id: convo.id, status: { in: ['queued', 'claimed'] } } });
    if (open > 0) return { outcome: 'skipped' as UnconfirmedOutcome };
    const slots = readSlots(convo.slots);
    const lastClient = await tx.comment.findFirst({ where: { task_id: convo.task_id, author_contact_id: { not: null }, is_deleted: false }, orderBy: { created_at: 'desc' }, select: { created_at: true, content: true } });
    const firstClient = await tx.comment.findFirst({ where: { task_id: convo.task_id, author_contact_id: { not: null }, is_deleted: false }, orderBy: { created_at: 'asc' }, select: { content: true } });
    const lastAssistant = await tx.comment.findFirst({ where: { task_id: convo.task_id, source: 'assistant', is_deleted: false, is_internal: false }, orderBy: { created_at: 'desc' }, select: { created_at: true } });
    const quietSince = new Date(Math.max((lastClient?.created_at ?? convo.created_at).getTime(), (lastAssistant?.created_at ?? new Date(0)).getTime()));

    // A question the assistant answered: close it.
    if (slots.question_closed_at) {
      const closedAt = new Date(slots.question_closed_at);
      if (now.getTime() - Math.max(closedAt.getTime(), (lastClient?.created_at ?? closedAt).getTime()) < QUESTION_CLOSE_HOURS * HOUR) return { outcome: 'skipped' as UnconfirmedOutcome };
      const tags = new Set(convo.task.tags.filter((t) => !['chat-clarifying', 'awaiting-clarification'].includes(t)));
      tags.add('chat-question');
      await tx.task.update({ where: { id: convo.task_id }, data: { tags: [...tags], status: 'done' } });
      await tx.chatConversation.update({ where: { id: convo.id }, data: { state: 'closed', open_ask: Prisma.DbNull } });
      await postInternalNote(tx, convo.task_id, 'Question chat closed after a day with no new message. Nothing was filed.', { unconfirmed: 'closed_question' });
      return { outcome: 'closed_question' as UnconfirmedOutcome };
    }

    if (now.getTime() - quietSince.getTime() < UNCONFIRMED_FILE_HOURS * HOUR) return { outcome: 'skipped' as UnconfirmedOutcome };
    if (!access || access.role === 'none') return { outcome: 'handed_off' as UnconfirmedOutcome };

    const snap: SummarySnap = slots.summary ?? {
      request_type: slots.request_type ?? 'other',
      site_id: slots.site_id ?? convo.site_id ?? null,
      page_id: slots.page_id ?? null,
      page_text: slots.page_text ?? null,
      section: slots.section_text ?? slots.section_key ?? null,
      change: slots.change ?? firstClient?.content ?? convo.task.title,
      attachment_ids: slots.attachment_ids ?? [],
      text: null,
    };
    const filed = await fileFromSnapshot(tx, access, convo, { ...snap, change: (snap.change || firstClient?.content || '').slice(0, 2000) }, { now, unconfirmed: true });
    await postInternalNote(
      tx,
      convo.task_id,
      `The client left the chat before sending this. Filed with what is known so a person can ask for the rest. ${describeKnown(snap, { page: null })}. Read the thread before acting.`,
      { unconfirmed: 'filed' }
    );
    return { outcome: 'filed_unconfirmed' as UnconfirmedOutcome, taskId: filed.task.id };
  });

  if (out.outcome === 'handed_off') {
    await handOff(conversationId, { reason: 'other', draft: '', say: null, now });
  }
  if (out.outcome === 'filed_unconfirmed' && 'taskId' in out && out.taskId) await notifyNewPortalRequest(out.taskId);
  return out.outcome;
}

/** Conversations that might be due, oldest first. C4's sweep calls this, then closeUnconfirmed for each. */
export async function listUnconfirmedCandidates(now: Date = new Date(), limit = 50): Promise<string[]> {
  const before = new Date(now.getTime() - Math.min(QUESTION_CLOSE_HOURS, UNCONFIRMED_FILE_HOURS) * HOUR);
  const rows = await prisma.chatConversation.findMany({
    where: { state: { in: ['clarifying', 'confirming'] }, updated_at: { lt: before } },
    orderBy: { updated_at: 'asc' },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** The whole sweep step: returns what it did, per outcome. */
export async function sweepUnconfirmed(now: Date = new Date()): Promise<Record<UnconfirmedOutcome, number>> {
  const counts: Record<UnconfirmedOutcome, number> = { skipped: 0, closed_question: 0, filed_unconfirmed: 0, handed_off: 0 };
  for (const id of await listUnconfirmedCandidates(now)) counts[await closeUnconfirmed(id, { now })]++;
  return counts;
}
