/**
 * Bast chat, op `start_quote`: a deal record (an `Accord`, status `lead`) and a pricing task for the owner
 * (plan bast-chat-start, slice 3).
 *
 * One transaction, applied at once. The deal is owned by the owner, named "<who>: <what>", with the owner's words as its
 * notes; it links the client when one is sent, else it carries the lead's name, business and email. When `email_ask_id`
 * is sent, the sender's details are read on the server from that email ask, never from the request. The pricing task is
 * the owner's, tagged `from-chat` and `quote`, linked to the deal and the client, with NO project. Never a Proposal, never a
 * deal value or budget, never sent, no quote-status project.
 *
 * Record: target_type `quote_start`, target_id the deal; `before` is `{}`; `after` is `{deal_id, task_id, client_id}`.
 * Undo: refused ("Changed since. Open the deal.") unless the deal is still `lead` and the task is still the owner's and
 * `not_started` with nothing waiting on it. Then, in one transaction with compare-and-set, the deal goes to `lost`
 * (with lost_at and the reason "Started by mistake from the chat") and the task to `abandoned`. Nothing is deleted.
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { opSummary, type OpContext, type PreparedOp } from '../actions';
import { cleanLine, quoted } from '../card-context';
import type { ReachOrigin } from '../worker-reach';
import { abandonStartTask, checkStartTaskUndo, checklistOf, createStartTask, freeText, inOneTransaction, paragraphsOf, reachOfNewTask, threadLink, START_CREATED_BY, CHAT_TAG } from './start-common';
import type { OpDef, OpDb, OpRun } from './index';

const inputSchema = z
  .object({
    client_id: z.string().uuid().optional(),
    lead_name: freeText(255).optional(),
    lead_business: freeText(255).optional(),
    lead_email: freeText(255).optional(),
    email_ask_id: z.string().uuid().optional(),
    what: freeText(2000),
    message: freeText(4000),
  })
  .strict()
  .refine((v) => !(v.client_id && (v.lead_name || v.lead_business || v.lead_email)), { message: 'Send either client_id or the lead details, not both.' })
  .refine((v) => v.client_id || v.lead_name || v.lead_business || v.lead_email || v.email_ask_id, { message: 'Say who the quote is for.' });
export type StartQuoteInput = z.infer<typeof inputSchema>;

const expectSchema = z.object({ client_id: z.string().uuid().nullable(), thread_id: z.string().nullable() }).strict();
const afterSchema = z.object({ deal_id: z.string().uuid(), task_id: z.string().uuid(), client_id: z.string().uuid().nullable() }).strict();

const CHANGED = 'Changed since. Open the deal.';
const LOST_REASON = 'Started by mistake from the chat';

interface Resolved {
  client_id: string | null;
  who: string;
  lead: { name: string | null; business: string | null; email: string | null };
  ask: { subject: string; from: string; thread_id: string | null; link: string | null } | null;
}

async function resolve(db: OpDb, input: StartQuoteInput): Promise<Resolved> {
  let clientName: string | null = null;
  if (input.client_id) {
    const c = await db.client.findFirst({ where: { id: input.client_id, is_deleted: false }, select: { id: true, name: true } });
    if (!c) throw new ApiError('That client does not exist.', 404, 'client_missing');
    clientName = c.name;
  }
  let ask: Resolved['ask'] = null;
  let askName: string | null = null;
  let askEmail: string | null = null;
  if (input.email_ask_id) {
    const a = await db.emailAsk.findFirst({ where: { id: input.email_ask_id }, select: { from_name: true, from_email: true, subject: true, thread_id: true, account: true, deep_link: true } });
    if (!a) throw new ApiError('That email is not there.', 404, 'email_ask_missing');
    askName = a.from_name?.trim() || null;
    askEmail = a.from_email;
    ask = {
      subject: a.subject,
      from: a.from_name ? `${a.from_name} <${a.from_email}>` : a.from_email,
      thread_id: a.thread_id,
      link: a.deep_link?.trim() || (a.thread_id ? threadLink(a.account, a.thread_id) : null),
    };
  }
  const lead = input.client_id
    ? { name: null, business: null, email: null }
    : { name: input.lead_name ?? askName, business: input.lead_business ?? null, email: input.lead_email ?? askEmail };
  const who = clientName ?? lead.name ?? lead.business ?? lead.email ?? 'a new lead';
  return { client_id: input.client_id ?? null, who, lead, ask };
}

function pricingText(input: StartQuoteInput, r: Resolved, dealId: string | null): string | null {
  return paragraphsOf([
    input.what,
    `For: ${r.who}`,
    ...(r.ask ? [`Email subject: ${r.ask.subject}`, `From: ${r.ask.from}`, ...(r.ask.thread_id ? [`Thread id: ${r.ask.thread_id}`] : []), ...(r.ask.link ? [`Thread link: ${r.ask.link}`] : [])] : []),
    ...(dealId ? [`Deal id: ${dealId}`] : []),
    'What Mike wrote in the chat, word for word:',
    input.message,
  ]);
}

const titleOf = (input: StartQuoteInput, r: Resolved) => cleanLine(`Price ${cleanLine(input.what, 120)} for ${cleanLine(r.who, 80)}`, 500);
const checklistFor = (r: Resolved) => [
  'Price it from the offer catalog and past invoices',
  'Write the quote as a draft note here',
  ...(r.ask?.thread_id ? ['Put the same draft, unsent, in Gmail on the thread'] : []),
  'Hand it back to Mike',
];

async function prepare(ctx: OpContext, input: StartQuoteInput, origin: ReachOrigin): Promise<PreparedOp> {
  const r = await resolve(ctx.db as OpDb, input);
  const reach = reachOfNewTask(ctx, { title: titleOf(input, r), description: pricingText(input, r, null), requirements: null, client_id: r.client_id, site_id: null, tags: [CHAT_TAG, 'quote'] }, origin);
  return {
    reach,
    expect: { client_id: r.client_id, thread_id: r.ask?.thread_id ?? null },
    copy: { clause: `start a quote for ${cleanLine(r.who, 60)}` },
  };
}

async function run(ctx: OpContext, input: StartQuoteInput, expect: unknown): Promise<OpRun> {
  const e = expectSchema.safeParse(expect);
  if (!e.success) throw new ApiError(CHANGED, 409, 'changed_since');
  const db = ctx.db as OpDb;
  const r = await resolve(db, input);
  if (r.client_id !== e.data.client_id || (r.ask?.thread_id ?? null) !== e.data.thread_id) throw new ApiError(CHANGED, 409, 'changed_since');

  const deal = await db.accord.create({
    data: {
      name: cleanLine(`${r.who}: ${cleanLine(input.what, 120)}`, 255),
      status: 'lead',
      owner_id: ctx.ownerId,
      client_id: r.client_id,
      lead_name: r.lead.name,
      lead_business_name: r.lead.business,
      lead_email: r.lead.email,
      notes: input.message,
    },
    select: { id: true },
  });
  const taskId = randomUUID();
  await createStartTask(db, {
    id: taskId,
    title: titleOf(input, r),
    description: pricingText(input, r, deal.id),
    requirements: checklistOf(checklistFor(r), taskId),
    client_id: r.client_id,
    site_id: null,
    accord_id: deal.id,
    tags: [CHAT_TAG, 'quote'],
    ownerId: ctx.ownerId,
  });
  return {
    target_id: deal.id,
    before: {},
    after: { deal_id: deal.id, task_id: taskId, client_id: r.client_id },
    summary: opSummary({ op: 'start_quote', who: r.who, what: input.what }, ctx.now),
    result: { deal_id: deal.id, task_id: taskId, client_id: r.client_id },
    undoable: true,
  };
}

export const startQuoteOp: OpDef<StartQuoteInput> = {
  name: 'start_quote',
  target_type: 'quote_start',
  tool: 'start_quote',
  validate: (raw) => inputSchema.parse(raw),
  // The deal does not exist yet; the proposal (when the reach check ever asks for one) points at the client or the email.
  targetId: (input) => input.client_id ?? input.email_ask_id ?? '00000000-0000-4000-8000-000000000000',
  prepare,
  run,
  async prepareUndo(ctx, record) {
    const after = afterSchema.safeParse(record.after);
    if (!after.success) throw new ApiError("That can't be undone from here. Open it in Citadel.", 409, 'not_undoable');
    const d = await (ctx.db as OpDb).accord.findFirst({ where: { id: after.data.deal_id, is_deleted: false }, select: { id: true, name: true, status: true } });
    if (!d || d.status !== 'lead') throw new ApiError(CHANGED, 409, 'changed_since');
    const reach = await checkStartTaskUndo(ctx, after.data.task_id, CHANGED);
    return { reach, expect: { deal_id: d.id, task_id: after.data.task_id }, copy: { clause: `mark the ${quoted(d.name, 80)} deal as started by mistake and drop its pricing task` } };
  },
  async undo(ctx, record) {
    const after = afterSchema.safeParse(record.after);
    if (!after.success) return { ok: false, reason: 'invalid' };
    const a = after.data;
    try {
      await inOneTransaction(ctx.db as OpDb, async (tx) => {
        const d = await tx.accord.updateMany({
          where: { id: a.deal_id, status: 'lead', is_deleted: false },
          data: { status: 'lost', lost_at: ctx.now, entered_current_status_at: ctx.now, rejection_reason: LOST_REASON },
        });
        if (d.count !== 1 || !(await abandonStartTask(tx, a.task_id, ctx.ownerId))) throw new ApiError(CHANGED, 409, 'changed_since');
      });
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 409) return { ok: false, reason: 'changed_since' };
      throw e;
    }
    return { ok: true };
  },
};
