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
import { ALREADY_FILED_LINE, SENT_LINES } from '@/lib/portal/chat/copy';
import { workPageUrl } from '@/lib/portal/notices';
import { readSlots, type SummarySnap } from '@/lib/portal/chat/slots';
import { accessForJob } from '@/lib/engine/reads';
import { postInternalNote } from '@/lib/portal/chat/assistant-comment';
import { handOff } from '@/lib/portal/chat/handoff';

export interface Confirmed {
  already: boolean;
  quote: boolean;
  urgent: boolean;
  lines: string[];
  task_id?: string;
  /** Where the request now lives, when the Send was stale because the sweep filed it. */
  link?: string;
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
    data: {
      state: 'filed',
      open_ask: Prisma.DbNull,
      site_id: placement.site_id ?? convo.site_id,
      ...(opts.unconfirmed ? { slots: { ...readSlots(convo.slots), unconfirmed_filed: true } as Prisma.InputJsonValue } : { confirmed_at: now }),
    },
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
    // A Send that arrives after the sweep filed the request (the client had walked away): say so plainly.
    if (convo.state === 'filed' && !convo.confirmed_at && readSlots(convo.slots).unconfirmed_filed) {
      return { already: true as const, stale: true as const, quote: convo.task.tags.includes('quote'), urgent: convo.task.tags.includes('emergency'), task: convo.task, notify: false };
    }
    if (convo.state === 'filed' && convo.confirmed_at) return { already: true as const, stale: false as const, quote: convo.task.tags.includes('quote'), urgent: convo.task.tags.includes('emergency'), task: convo.task, notify: false };
    if (convo.state !== 'confirming') throw new ApiError('There is nothing to send yet.', 409, 'not_confirming');
    if (convo.summary_version !== input.summary_version) throw new ApiError('That summary changed. Please check it again.', 409, 'stale_summary');
    const snap = readSlots(convo.slots).summary;
    if (!snap) throw new ApiError('There is nothing to send yet.', 409, 'not_confirming');
    const filed = await fileFromSnapshot(tx, access, convo, snap, { projectId: input.project_id, now, unconfirmed: false });
    return { already: false as const, stale: false as const, ...filed, notify: true };
  });

  if (out.notify) await notifyNewPortalRequest(out.task.id);
  if (out.stale) return { already: true, quote: out.quote, urgent: out.urgent, lines: [ALREADY_FILED_LINE], task_id: out.task.id, link: workPageUrl(out.task.id) };
  return { already: out.already, quote: out.quote, urgent: out.urgent, lines: [SENT_LINES.heading, SENT_LINES.more], task_id: out.task.id };
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

export interface Candidate {
  id: string;
  /** The quiet clock: the latest client or assistant message, or the conversation's creation. */
  quiet: Date;
}

/**
 * Conversations that might be due, ordered by the quiet clock (the last client or assistant message,
 * NOT `updated_at`, which any bookkeeping write moves), one batch at a time. Pass the last row as
 * `after` for the next batch: the cursor is (quiet, id), so a conversation that stays not-yet-due is
 * not read again within one sweep and the sweep pages past any number of rows.
 */
export async function listUnconfirmedCandidates(
  now: Date = new Date(),
  opts: { limit?: number; after?: Candidate | null } = {}
): Promise<Candidate[]> {
  const limit = opts.limit ?? 50;
  // ISO strings cast to timestamp: the columns are timestamp without time zone, holding UTC.
  const before = new Date(now.getTime() - Math.min(QUESTION_CLOSE_HOURS, UNCONFIRMED_FILE_HOURS) * HOUR).toISOString();
  const afterQuiet = opts.after?.quiet ? opts.after.quiet.toISOString() : null;
  const afterId = opts.after?.id ?? null;
  const rows = await prisma.$queryRaw<Array<{ id: string; quiet: Date }>>`
    SELECT id, quiet FROM (
      SELECT c.id,
             COALESCE((
               SELECT max(m.created_at) FROM comments m
               WHERE m.task_id = c.task_id AND m.is_deleted = false AND m.is_internal = false
                 AND (m.author_contact_id IS NOT NULL OR m.source = 'assistant')
             ), c.created_at) AS quiet
      FROM portal_chat_conversations c
      WHERE c.state IN ('clarifying', 'confirming')
        AND COALESCE((c.slots ->> 'sweep_skip')::boolean, false) = false
    ) q
    WHERE q.quiet < ${before}::timestamp
      AND (${afterQuiet}::timestamp IS NULL OR (q.quiet, q.id) > (${afterQuiet}::timestamp, ${afterId}::uuid))
    ORDER BY q.quiet ASC, q.id ASC
    LIMIT ${limit}`;
  return rows;
}

export const SWEEP_MAX_FAILURES = 3;

/** One conversation failed in the sweep: count it; at three in a row, tag it needs-mike and skip it from now on. */
async function recordSweepFailure(conversationId: string, error: unknown): Promise<'counted' | 'parked'> {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`portal chat sweep: conversation ${conversationId} failed: ${detail}`);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${conversationId}`}))`;
    const convo = await tx.chatConversation.findUnique({ where: { id: conversationId }, include: { task: { select: { tags: true } } } });
    if (!convo) return 'counted' as const;
    const slots = readSlots(convo.slots);
    const failures = (slots.sweep_failures ?? 0) + 1;
    if (failures >= SWEEP_MAX_FAILURES) {
      const tags = new Set([...convo.task.tags, 'needs-mike']);
      tags.delete('chat-clarifying'); // parked for a person; chat-clarifying would hide it from the gate
      await tx.task.update({ where: { id: convo.task_id }, data: { tags: [...tags] } });
      await tx.chatConversation.update({ where: { id: conversationId }, data: { slots: { ...slots, sweep_failures: failures, sweep_skip: true } as Prisma.InputJsonValue } });
      await postInternalNote(tx, convo.task_id, `The walk-away sweep failed ${failures} times on this chat and has stopped trying. A person should read the thread and file or close it. Last error: ${detail.slice(0, 300)}`, { sweep: 'parked' });
      return 'parked' as const;
    }
    await tx.chatConversation.update({ where: { id: conversationId }, data: { slots: { ...slots, sweep_failures: failures } as Prisma.InputJsonValue } });
    return 'counted' as const;
  });
}

async function clearSweepFailures(conversationId: string): Promise<void> {
  const convo = await prisma.chatConversation.findUnique({ where: { id: conversationId }, select: { slots: true } });
  const slots = readSlots(convo?.slots);
  if (slots.sweep_failures) await prisma.chatConversation.update({ where: { id: conversationId }, data: { slots: { ...slots, sweep_failures: 0 } as Prisma.InputJsonValue } });
}

export type SweepCounts = Record<UnconfirmedOutcome, number> & { failed: number; parked: number };

/**
 * The whole sweep step, for C4: pages through every due candidate (batches of `batch`), calls
 * `closeUnconfirmed` for each inside its own try/catch so one bad conversation never stops the rest,
 * and counts what happened.
 */
export async function sweepUnconfirmed(now: Date = new Date(), opts: { batch?: number } = {}): Promise<SweepCounts> {
  const counts: SweepCounts = { skipped: 0, closed_question: 0, filed_unconfirmed: 0, handed_off: 0, failed: 0, parked: 0 };
  const batch = opts.batch ?? 50;
  let after: Candidate | null = null;
  for (;;) {
    const rows = await listUnconfirmedCandidates(now, { limit: batch, after });
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        const outcome = await closeUnconfirmed(row.id, { now });
        counts[outcome]++;
        if (outcome !== 'skipped') await clearSweepFailures(row.id);
      } catch (error) {
        counts.failed++;
        try {
          if ((await recordSweepFailure(row.id, error)) === 'parked') counts.parked++;
        } catch (inner) {
          console.error('portal chat sweep: could not record a failure', inner);
        }
      }
    }
    after = rows[rows.length - 1];
    if (rows.length < batch) break;
  }
  return counts;
}
