/**
 * apply.ts: the ONLY writer of model results (phase C spec 4.5, 9.2, 11.3).
 *
 * Order is fixed: the job must be live; the result must match the contract; every client-facing
 * string goes through the copy gate (a refusal is a 422 the runner answers with one regeneration;
 * a second refusal arrives as `canned`); the sources are rebuilt from the job's own logged tool
 * calls (provenance); only then do the actions run, in APPLY_ORDER, each against ids Citadel has
 * checked belong to this client. The model decides nothing with a consequence: filing, placement,
 * urgency, handoff effects and emails are server code that reads validated fields.
 */
import { Prisma, type EngineJob } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { isLive, abandonJob } from '@/lib/engine/queue';
import { accessForJob } from '@/lib/engine/reads';
import { composeTitle } from '@/lib/portal/intake/compose';
import { buildContext, contextClientTexts } from '@/lib/portal/chat/context';
import { gateReply, type GateKind, type GateResult } from '@/lib/portal/chat/gate';
import { loadGateContext } from '@/lib/portal/chat/gate-context';
import { APPLY_ORDER, injectionReports, resultSchema, type ChatAction, type ChatResult } from '@/lib/portal/chat/result';
import { postAssistantComment, postInternalNote } from '@/lib/portal/chat/assistant-comment';
import { refreshTaskDescription } from '@/lib/portal/chat/description';
import { handOff } from '@/lib/portal/chat/handoff';
import { confirmConversation } from '@/lib/portal/chat/confirm';
import { CANNED_LINE, NOTE } from '@/lib/portal/chat/copy';
import { emailAssistantReply, emailFixedLine } from '@/lib/portal/chat/mailer';
import { syncProvisionalPlacement } from '@/lib/portal/chat/place';
import { clientSites, conversationPages, rankPages, readAsk, readSlots, resolveChoices, sectionsOf, type OpenAsk, type Slots, type SummarySnap } from '@/lib/portal/chat/slots';
import { z } from 'zod';

export const runSchema = z
  .object({
    attempt: z.number().int().min(1).max(10),
    model: z.string().max(64),
    prompt_hash: z.string().max(64),
    input_tokens: z.number().int().min(0).default(0),
    cache_read_tokens: z.number().int().min(0).default(0),
    cache_write_tokens: z.number().int().min(0).default(0),
    output_tokens: z.number().int().min(0).default(0),
    cost_usd: z.number().min(0).max(100).default(0),
    duration_ms: z.number().int().min(0).nullish(),
    duration_api_ms: z.number().int().min(0).nullish(),
    num_turns: z.number().int().min(0).nullish(),
    is_error: z.boolean().default(false),
    rejected_text: z.string().max(5000).nullish(),
  })
  .strict();
export type RunInput = z.infer<typeof runSchema>;

export const completeSchema = z.object({ result: z.unknown().optional(), runs: z.array(runSchema).max(6).default([]), canned: z.boolean().optional() });

export type ApplyOutcome =
  | { status: 'applied'; gate_result: 'pass' | 'regenerated' | 'canned'; comment_id: string | null }
  | { status: 'rejected'; rule: string; match: string }
  | { status: 'expired' };

class Expired extends Error {}

interface ActionError {
  action: string;
  error: string;
  detail?: string;
}

const TEAM_SPAN = /\[TEAM[^\]]*\]/g;
const DATE_RANGE = /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/;

/**
 * Every string field of the result contract, and what happens to it. A test enumerates the Zod
 * schema's string fields and fails when one is in none of these three lists, so a new field cannot
 * reach a client ungated by accident.
 *
 *  - GATED_FIELDS: runs through the copy gate in `complete` (a refusal is a 422), and says as what.
 *  - ID_VALIDATED_FIELDS: an id, a key or a call id that Citadel checks against this client's own
 *    rows and drops when unknown; the client never sees the model's text for it.
 *  - INTERNAL_ONLY_FIELDS: never shown to a client (staff note, or rebuilt from the database).
 */
export const GATED_FIELDS: Record<string, GateKind> = {
  reply: 'reply',
  'ask.question': 'ask',
  'propose_summary.summary': 'summary',
  'propose_summary.change': 'field',
  'propose_summary.section': 'field',
  'record.change': 'field',
  'record.page_text': 'field',
  'record.section_text': 'field',
  'hand_to_person.draft_reply': 'draft',
};
export const ID_VALIDATED_FIELDS: string[] = [
  'ask.choice_ids',
  'record.site_id',
  'record.page_id',
  'record.section_key',
  'record.attachment_ids',
  'propose_summary.site_id',
  'propose_summary.page_id',
  'propose_summary.attachment_ids',
  'sources.tool_call_id',
  'sources.range',
];
export const INTERNAL_ONLY_FIELDS: string[] = [
  'report_injection.excerpt', // staff note, quotes the client, never shown or obeyed
  'sources.label', // replaced by the tool result's own label from the database
];

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/** A field that is the client's own words, verbatim, is theirs to say: it is not gated as our copy. */
function isClientVerbatim(text: string, clientTexts: string[]): boolean {
  const t = norm(text);
  return t.length > 0 && clientTexts.some((c) => norm(c).includes(t));
}

function gateAll(result: ChatResult, ctx: Parameters<typeof gateReply>[1], clientTexts: string[], jobType?: string): { rejected: GateResult | null; draftOk: boolean } {
  const checks: Array<[string, GateKind]> = [[result.reply, GATED_FIELDS.reply]];
  for (const a of result.actions) {
    if (a.type === 'ask') checks.push([a.question, GATED_FIELDS['ask.question']]);
    if (a.type === 'propose_summary') {
      checks.push([a.summary, GATED_FIELDS['propose_summary.summary']]);
      checks.push([a.change, GATED_FIELDS['propose_summary.change']]);
      if (a.section) checks.push([a.section, GATED_FIELDS['propose_summary.section']]);
    }
    if (a.type === 'record') {
      if (a.change) checks.push([a.change, GATED_FIELDS['record.change']]);
      if (a.page_text) checks.push([a.page_text, GATED_FIELDS['record.page_text']]);
      if (a.section_text) checks.push([a.section_text, GATED_FIELDS['record.section_text']]);
    }
  }
  // An answer to an email also goes out by email: the model's part of that body (reply, question,
  // summary) is gated once more as an email body. Template lines (greeting, link, reference) are not.
  if (jobType === 'chat_email_reply') {
    const part = [result.reply, ...result.actions.flatMap((a) => (a.type === 'ask' ? [a.question] : a.type === 'propose_summary' ? [a.summary] : []))].join('\n');
    checks.push([part, 'email']);
  }
  for (const [text, kind] of checks) {
    if (kind === 'field' && isClientVerbatim(text, clientTexts)) continue;
    const g = gateReply(text, ctx, kind);
    if (!g.ok) return { rejected: g, draftOk: true };
  }
  let draftOk = true;
  const handoff = result.actions.find((a) => a.type === 'hand_to_person');
  if (handoff && handoff.type === 'hand_to_person') {
    const stripped = handoff.draft_reply.replace(TEAM_SPAN, ' ').replace(/\s+/g, ' ').trim();
    draftOk = stripped === '' || gateReply(stripped, ctx, 'draft').ok;
  }
  return { rejected: null, draftOk };
}

async function persistRuns(tx: Prisma.TransactionClient, jobId: string, runs: RunInput[]) {
  for (const r of runs) {
    await tx.engineRun.create({
      data: {
        job_id: jobId,
        attempt: r.attempt,
        model: r.model,
        prompt_hash: r.prompt_hash,
        input_tokens: r.input_tokens,
        cache_read_tokens: r.cache_read_tokens,
        cache_write_tokens: r.cache_write_tokens,
        output_tokens: r.output_tokens,
        cost_usd: r.cost_usd,
        duration_ms: r.duration_ms ?? null,
        duration_api_ms: r.duration_api_ms ?? null,
        num_turns: r.num_turns ?? null,
        is_error: r.is_error,
        rejected_text: r.rejected_text ?? null,
      },
    });
  }
}

/** Close a claimed, live job in the same transaction as its effects. Throws Expired if it is not live. */
async function closeJob(tx: Prisma.TransactionClient, job: EngineJob, gate: 'pass' | 'regenerated' | 'canned', errors: ActionError[], now: Date) {
  const res = await tx.engineJob.updateMany({
    where: { id: job.id, status: 'claimed', lease_until: { gt: now } },
    data: { status: 'done', finished_at: now, gate_result: gate, action_errors: errors.length ? (errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull },
  });
  if (res.count === 0) throw new Expired();
  if (job.conversation_id) await tx.chatConversation.update({ where: { id: job.conversation_id }, data: { mode: 'model' } });
}

/**
 * Attachment ids the model may name: files of THIS conversation that are already on a message, or that
 * this same person staged and has not yet sent. Never another contact's unbound file, never another
 * conversation's, never another client's.
 */
async function attachmentIdsFor(clientId: string, conversationId: string, ids: string[], contactIds: string[]): Promise<{ ok: string[]; bad: string[] }> {
  if (ids.length === 0) return { ok: [], bad: [] };
  const rows = await prisma.portalAttachment.findMany({
    where: {
      id: { in: ids },
      client_id: clientId,
      is_deleted: false,
      conversation_id: conversationId,
      OR: [{ comment_id: { not: null } }, { uploaded_by_contact_id: { in: contactIds } }],
    },
    select: { id: true },
  });
  const have = new Set(rows.map((r) => r.id));
  return { ok: ids.filter((i) => have.has(i)), bad: ids.filter((i) => !have.has(i)) };
}

export async function applyResult(
  jobId: string,
  body: { result?: unknown; runs?: RunInput[]; canned?: boolean },
  opts: { now?: Date } = {}
): Promise<ApplyOutcome> {
  const now = opts.now ?? new Date();
  const runs = body.runs ?? [];
  const job = await prisma.engineJob.findUnique({ where: { id: jobId } });
  if (!job || !isLive(job, now) || !job.conversation_id || !job.client_id || !job.contact_id) return { status: 'expired' };

  const access = await accessForJob(job);
  if (!access) {
    await abandonJob(job.id, 'no_access', now);
    return { status: 'expired' };
  }
  const convo = await prisma.chatConversation.findUnique({ where: { id: job.conversation_id } });
  if (!convo || convo.client_id !== access.clientId) return { status: 'expired' };

  const regenerated = runs.some((r) => r.rejected_text);

  // A conversation that moved to a person while the job ran: the result is dropped, the job closes.
  if (convo.state === 'with_person' || convo.state === 'closed') {
    try {
      await prisma.$transaction(async (tx) => {
        await closeJob(tx, job, regenerated ? 'regenerated' : 'pass', [{ action: 'result', error: 'conversation_not_open' }], now);
        await persistRuns(tx, job.id, runs);
      });
    } catch (e) {
      if (e instanceof Expired) return { status: 'expired' };
      throw e;
    }
    return { status: 'applied', gate_result: regenerated ? 'regenerated' : 'pass', comment_id: null };
  }

  // The fixed fallback after two gate refusals.
  if (body.canned) {
    try {
      await prisma.$transaction(async (tx) => {
        await closeJob(tx, job, 'canned', [], now);
        await persistRuns(tx, job.id, runs);
      });
    } catch (e) {
      if (e instanceof Expired) return { status: 'expired' };
      throw e;
    }
    await handOff(convo.id, { reason: 'unclear', draft: '', say: CANNED_LINE, now });
    // The client wrote by email, so the fixed line goes back by email too (spec 7.4).
    if (job.type === 'chat_email_reply') await emailFixedLine({ conversationId: convo.id, contactId: job.contact_id, text: CANNED_LINE, key: `job:${job.id}`, now });
    return { status: 'applied', gate_result: 'canned', comment_id: null };
  }

  const parsed = resultSchema.safeParse(body.result);
  if (!parsed.success) {
    return { status: 'rejected', rule: 'schema', match: (parsed.error.issues[0]?.message ?? 'invalid').slice(0, 120) };
  }
  const result = parsed.data;

  // Gate, then provenance.
  const context = await buildContext(access, convo.id, { now });
  const gateCtx = await loadGateContext({ jobId: job.id, clientId: access.clientId, contactId: job.contact_id, context, now });
  const gated = gateAll(result, gateCtx, contextClientTexts(context), job.type);
  if (gated.rejected && !gated.rejected.ok) return { status: 'rejected', rule: gated.rejected.rule, match: gated.rejected.match };

  const calls = await prisma.engineToolCall.findMany({ where: { job_id: job.id, error: null }, select: { id: true, result: true } });
  const callById = new Map(calls.map((c) => [c.id, c]));
  const errors: ActionError[] = [];
  const sources: Array<{ tool_call_id: string; label: string; range: string }> = [];
  for (const s of result.sources) {
    const c = callById.get(s.tool_call_id);
    const label = typeof (c?.result as { label?: unknown } | null)?.label === 'string' ? ((c!.result as { label: string }).label) : null;
    if (!c || !label) {
      errors.push({ action: 'source', error: 'unknown_tool_call', detail: s.tool_call_id });
      continue;
    }
    sources.push({ tool_call_id: c.id, label, range: DATE_RANGE.test(s.range) ? s.range : '' });
  }

  // Actions: validate ids against this client; drop what does not belong.
  let slots: Slots = readSlots(convo.slots);
  const personIds = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];
  const sites = await clientSites(access.clientId);
  const pages = await conversationPages(access.clientId, convo.site_id ?? slots.site_id);
  const siteOk = (id?: string | null) => (id ? sites.some((s) => s.id === id) : false);
  const hasHandoff = result.actions.some((a) => a.type === 'hand_to_person');
  const hasSummary = result.actions.some((a) => a.type === 'propose_summary');
  const hasUrgent = result.actions.some((a) => a.type === 'suggest_urgent');

  const ordered = [...result.actions].sort((a, b) => APPLY_ORDER.indexOf(a.type) - APPLY_ORDER.indexOf(b.type));
  const injections = injectionReports(result);

  let openAsk: OpenAsk | null = null;
  let summaryVersion = convo.summary_version;
  let newState = convo.state;
  let retitleType: string | null = null;
  let handoffAction: Extract<ChatAction, { type: 'hand_to_person' }> | null = null;
  let confirmFromEmail: Extract<ChatAction, { type: 'confirm_from_email' }> | null = null;
  let closeQuestion = false;
  let siteId = convo.site_id;
  const firstRequestType = !slots.request_type;
  let summarySnap: SummarySnap | null = null;

  for (const a of ordered) {
    switch (a.type) {
      case 'report_injection':
        break; // written as internal notes below
      case 'record': {
        if (a.site_id) {
          if (siteOk(a.site_id)) {
            slots = { ...slots, site_id: a.site_id };
            siteId = a.site_id;
          } else errors.push({ action: 'record', error: 'unknown_site', detail: a.site_id });
        }
        if (a.page_id) {
          const page = pages.find((p) => p.id === a.page_id);
          if (page) slots = { ...slots, page_id: page.id, page_text: null, section_key: null, section_text: null };
          else errors.push({ action: 'record', error: 'unknown_page', detail: a.page_id });
        }
        if (a.page_text) slots = { ...slots, page_text: a.page_text };
        if (a.section_key) {
          const page = pages.find((p) => p.id === slots.page_id);
          if (sectionsOf(page).some((s) => s.key === a.section_key)) slots = { ...slots, section_key: a.section_key, section_text: null };
          else errors.push({ action: 'record', error: 'unknown_section', detail: a.section_key });
        }
        if (a.section_text) slots = { ...slots, section_text: a.section_text };
        if (a.change) slots = { ...slots, change: a.change };
        if (a.attachment_ids.length) {
          const { ok, bad } = await attachmentIdsFor(access.clientId, convo.id, a.attachment_ids, personIds);
          for (const b of bad) errors.push({ action: 'record', error: 'unknown_attachment', detail: b });
          slots = { ...slots, attachment_ids: [...new Set([...(slots.attachment_ids ?? []), ...ok])] };
        }
        if (a.request_type) {
          if (firstRequestType && !retitleType) retitleType = a.request_type;
          slots = { ...slots, request_type: a.request_type };
        }
        break;
      }
      case 'ask': {
        if (hasHandoff || hasSummary || hasUrgent) {
          errors.push({ action: 'ask', error: 'not_with_other_action' });
          break;
        }
        const effective = { id: convo.id, client_id: access.clientId, site_id: siteId };
        const resolved = await resolveChoices(effective, slots, a.slot, a.choice_ids);
        for (const d of resolved.dropped) errors.push({ action: 'ask', error: 'unknown_choice', detail: d });
        let ids = resolved.choices.map((c) => c.id).filter((id) => !['not_sure', 'another_page', 'no_file'].includes(id));
        let freeText = a.allow_free_text;
        if (resolved.dropped.length > 0 && ids.length === 0) {
          // The deterministic fallback for the slot.
          if (a.slot === 'site') ids = sites.map((s) => s.id);
          else if (a.slot === 'page') ids = rankPages(pages, slots.change ?? '').slice(0, 8).map((p) => p.id);
          else if (a.slot === 'section') ids = sectionsOf(pages.find((p) => p.id === slots.page_id)).slice(0, 8).map((s) => s.key);
          if (ids.length === 0) freeText = true;
        }
        if (ids.length === 0 && !freeText && !a.allow_upload) freeText = true;
        openAsk = { slot: a.slot, question: a.question, choice_ids: ids.slice(0, 8), allow_free_text: freeText, allow_upload: a.allow_upload };
        break;
      }
      case 'propose_summary': {
        if (convo.state === 'filed' || hasHandoff) {
          errors.push({ action: 'propose_summary', error: convo.state === 'filed' ? 'already_filed' : 'not_with_handoff' });
          break;
        }
        const sid = siteOk(a.site_id) ? a.site_id : siteOk(slots.site_id) ? (slots.site_id as string) : siteOk(siteId) ? (siteId as string) : null;
        if (!siteOk(a.site_id)) errors.push({ action: 'propose_summary', error: 'unknown_site', detail: a.site_id });
        const page = a.page_id ? pages.find((p) => p.id === a.page_id) : null;
        if (a.page_id && !page) errors.push({ action: 'propose_summary', error: 'unknown_page', detail: a.page_id });
        const { ok, bad } = await attachmentIdsFor(access.clientId, convo.id, a.attachment_ids, personIds);
        for (const b of bad) errors.push({ action: 'propose_summary', error: 'unknown_attachment', detail: b });
        summaryVersion += 1;
        summarySnap = {
          request_type: a.request_type,
          site_id: sid,
          page_id: page?.id ?? null,
          page_text: page ? null : slots.page_text ?? null,
          section: a.section ?? null,
          change: a.change,
          attachment_ids: [...new Set([...(slots.attachment_ids ?? []), ...ok])],
          text: a.summary,
        };
        if (sid) siteId = sid;
        newState = 'confirming';
        openAsk = null;
        break;
      }
      case 'suggest_urgent':
        if (!slots.urgent_answered) slots = { ...slots, urgent_offered: true };
        break;
      case 'hand_to_person':
        handoffAction = a;
        break;
      case 'confirm_from_email':
        if (job.type !== 'chat_email_reply') errors.push({ action: 'confirm_from_email', error: 'not_an_email_job' });
        else confirmFromEmail = a;
        break;
      case 'close_question':
        closeQuestion = true;
        break;
    }
  }
  if (summarySnap) slots = { ...slots, summary: summarySnap };
  if (closeQuestion) slots = { ...slots, question_closed_at: now.toISOString() };

  const gateResult: 'pass' | 'regenerated' = regenerated ? 'regenerated' : 'pass';
  let commentId: string | null = null;
  try {
    commentId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`portal-chat-convo:${convo.id}`}))`;
      const fresh = await tx.chatConversation.findUnique({ where: { id: convo.id }, select: { state: true } });
      if (!fresh || fresh.state === 'with_person' || fresh.state === 'closed') throw new Expired();
      await closeJob(tx, job, gateResult, errors, now);
      await persistRuns(tx, job.id, runs);

      const task = await tx.task.findUniqueOrThrow({ where: { id: convo.task_id }, select: { tags: true } });
      const tags = new Set(task.tags);
      for (const inj of injections) await postInternalNote(tx, convo.task_id, NOTE.injection(inj.source, inj.excerpt), { injection: true, source: inj.source });

      // Retitle on the first recorded type, and re-run the provisional placement.
      if (retitleType && slots.request_type) {
        const first = await tx.comment.findFirst({ where: { task_id: convo.task_id, author_contact_id: { not: null } }, orderBy: { created_at: 'asc' }, select: { content: true } });
        const title = composeTitle(slots.request_type, first?.content ?? '');
        await tx.task.update({ where: { id: convo.task_id }, data: { title, client_title: title } });
      }
      if (retitleType || siteId !== convo.site_id) {
        await syncProvisionalPlacement(tx, access, convo.task_id, { type: slots.request_type ?? 'other', siteId, now });
      }

      const meta: Record<string, unknown> = { job_id: job.id, sources };
      if (openAsk) meta.ask = openAsk;
      const reply = await postAssistantComment(tx, convo.task_id, result.reply, meta);

      if (openAsk) {
        openAsk = { ...openAsk, comment_id: reply.id };
        tags.add('awaiting-clarification');
      } else {
        tags.delete('awaiting-clarification');
      }
      if (newState === 'confirming') tags.delete('awaiting-clarification');
      if (closeQuestion) tags.add('chat-question');
      await tx.task.update({ where: { id: convo.task_id }, data: { tags: [...tags] } });
      await tx.chatConversation.update({
        where: { id: convo.id },
        data: {
          slots: slots as Prisma.InputJsonValue,
          open_ask: openAsk ? (openAsk as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          state: newState,
          site_id: siteId,
          summary_version: summaryVersion,
          ...(summarySnap ? { summary_text: (summarySnap as SummarySnap).text } : {}),
        },
      });
      await refreshTaskDescription(tx, convo.id);
      return reply.id;
    });
  } catch (e) {
    if (e instanceof Expired) return { status: 'expired' };
    throw e;
  }

  // An answer to an email goes back by email, in the thread, unless the client is in the portal now.
  if (job.type === 'chat_email_reply' && commentId) {
    try {
      await emailAssistantReply({ conversationId: convo.id, commentId, contactId: job.contact_id, now });
    } catch (error) {
      console.error('chat email reply failed to queue', error);
    }
  }
  if (handoffAction) {
    await handOff(convo.id, { reason: handoffAction.reason, draft: handoffAction.draft_reply, draftOk: gated.draftOk, say: null, now });
  }
  if (confirmFromEmail) {
    try {
      await confirmConversation(access, convo.id, { summary_version: confirmFromEmail.summary_version }, { now, viaEmail: true });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'confirm_failed';
      await prisma.engineJob.update({ where: { id: job.id }, data: { action_errors: [...errors, { action: 'confirm_from_email', error: msg }] as unknown as Prisma.InputJsonValue } });
    }
  }
  return { status: 'applied', gate_result: gateResult, comment_id: commentId };
}
