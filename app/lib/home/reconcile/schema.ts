/**
 * Home Slice 9a: the strict bodies of the three worker routes and of POST /api/home/reconcile.
 * The shapes match exactly what the machine job sends (sent-reconciler/reconciler.py and shape.py); an unknown field is a 400.
 *
 * A single action that fails its own shape is not a 400: it is refused with bad_shape, so one bad action never sinks its
 * message (the machine already shape-checks; this is Citadel's own second look, and it runs under dry:true too).
 */
import { z } from 'zod';
import { itemKeySchema } from '../item-key';

export const CANDIDATES_MAX_MESSAGES = 10;
export const CANDIDATES_MAX_BYTES = 64 * 1024;
export const RECONCILE_MAX_MESSAGES = 10;
export const RECONCILE_MAX_BYTES = 128 * 1024;
export const NEW_PART_MAX = 6000;

const iso = z.string().datetime({ offset: true });
const addr = z.object({ email: z.string().min(3).max(254), name: z.string().max(200) }).strict();

export const candidatesBodySchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            message_key: z.string().min(1).max(300),
            account: z.string().min(3).max(255),
            thread_id: z.string().min(1).max(255),
            thread_rfc_ids: z.array(z.string().min(1).max(300)).max(300),
            to: z.array(addr).max(20),
            cc: z.array(addr).max(20),
            subject: z.string().max(500),
            sent_at: iso,
          })
          .strict()
      )
      .min(1)
      .max(CANDIDATES_MAX_MESSAGES),
  })
  .strict();
export type CandidatesBody = z.output<typeof candidatesBodySchema>;
export type CandidatesMessage = CandidatesBody['messages'][number];

const confidence = z.enum(['high', 'medium', 'low']);
const quote = z.string().min(1).max(400);
const waitOn = z.object({ email: z.string().min(3).max(254), name: z.string().max(100), what: z.string().min(1).max(200) }).strict();
const items = z.array(z.string().min(1).max(200)).max(6);

export const actionSchemas = {
  note: z.object({ type: z.literal('note'), task_id: z.string().uuid(), quote, confidence }).strict(),
  done: z
    .object({ type: z.literal('done'), task_id: z.string().uuid(), quote, confidence, past_tense: z.boolean(), remaining_open: items, did_phrase: z.string().min(1).max(200) })
    .strict(),
  waiting: z
    .object({
      type: z.literal('waiting'),
      task_id: z.string().uuid(),
      quote,
      confidence,
      past_tense: z.boolean(),
      remaining_open: items,
      did_phrase: z.string().min(1).max(200),
      wait_on: waitOn,
    })
    .strict(),
  session: z.object({ type: z.literal('session'), session_key: z.string().min(1).max(255), quote, confidence }).strict(),
  wait: z.object({ type: z.literal('wait'), wait_on: waitOn, quote, confidence }).strict(),
  track: z
    .object({
      type: z.literal('track'),
      title: z.string().min(1).max(120),
      done_title: z.string().min(1).max(120),
      next_step: z.string().min(1).max(200),
      later: z.array(z.string().min(1).max(120)).max(5),
      client_id: z.string().uuid().nullable(),
      project_id: z.string().uuid().nullable(),
      minutes: z.number().int().min(0).max(1440),
      estimate_basis: z.string().min(1).max(240),
      quote,
      confidence,
    })
    .strict(),
} as const;

export type NoteAction = z.output<typeof actionSchemas.note>;
export type DoneAction = z.output<typeof actionSchemas.done>;
export type WaitingAction = z.output<typeof actionSchemas.waiting>;
export type SessionAction = z.output<typeof actionSchemas.session>;
export type WaitAction = z.output<typeof actionSchemas.wait>;
export type TrackAction = z.output<typeof actionSchemas.track>;
export type ParsedAction = NoteAction | DoneAction | WaitingAction | SessionAction | WaitAction | TrackAction;

/** One action by its own shape, or null (a bad_shape refusal). */
export function parseAction(raw: unknown): ParsedAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = (raw as { type?: unknown }).type;
  if (typeof t !== 'string' || !(t in actionSchemas)) return null;
  const r = actionSchemas[t as keyof typeof actionSchemas].safeParse(raw);
  return r.success ? (r.data as ParsedAction) : null;
}

const cost = z.number().min(0).max(1000);
const modelInfo = z.object({ model: z.string().min(1).max(20), cost_usd: cost }).strict();

const messageSchema = z
  .object({
    message_key: z.string().min(1).max(300),
    account: z.string().min(3).max(255),
    gmail_id: z.string().min(1).max(64),
    thread_id: z.string().min(1).max(255),
    thread_root: z.string().min(1).max(255),
    sent_at: iso,
    to_label: z.string().max(300),
    subject: z.string().max(500),
    lookback: z.boolean(),
    bast_words: z.boolean(),
    new_part: z.string().max(NEW_PART_MAX),
    quoted_part_hash: z.string().max(64),
    filter: modelInfo,
    match: modelInfo.nullable(),
    outcome: z.enum(['nothing', 'actions']),
    // Facts from the mail mirror, optional (same shapes as the candidates route): when present the server recomputes the candidate set and the
    // match basis from them exactly as the candidates route does; when absent it falls back to to_label, EmailAsk rows and message_key.
    to: z.array(addr).max(20).optional(),
    cc: z.array(addr).max(20).optional(),
    thread_rfc_ids: z.array(z.string().min(1).max(300)).max(60).optional(),
    // Each action is parsed on its own (parseAction), so one bad action is a bad_shape refusal and not a 400.
    actions: z.array(z.unknown()).max(6),
  })
  .strict();
export type ReconcileMessage = z.output<typeof messageSchema>;

/** Real and dry POSTs share this body. The end marker is `{dry:false, lookback_end:true, messages:[]}`. */
export const reconcileBodySchema = z
  .object({
    dry: z.boolean(),
    lookback_end: z.literal(true).optional(),
    messages: z.array(messageSchema).max(RECONCILE_MAX_MESSAGES),
  })
  .strict()
  .refine((b) => !b.lookback_end || b.messages.length === 0, { message: 'The look-back end marker carries no messages.' })
  .refine((b) => b.lookback_end || b.messages.length > 0, { message: 'Send at least one message.' });
export type ReconcileBody = z.output<typeof reconcileBodySchema>;

/** POST /api/home/reconcile (session only). */
export const homeReconcileBodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('track_it'),
      item_key: itemKeySchema,
      placement: z.enum(['project', 'new_project', 'none']),
      minutes: z.number().int().min(0).max(1440).nullable(),
      billable: z.boolean(),
      // Work stage D: his own "track it anyway" after the answer that the conversation is already part of open work.
      create_anyway: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal('log_time'), task_id: z.string().uuid(), minutes: z.number().int().min(1).max(1440), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  // Work stage F: "Log it?" on a clock estimate. target_key is project:<id> or task:<id>; the minutes are his choice (the estimate is preselected).
  z.object({ action: z.literal('log_clock'), target_key: z.string().min(10).max(60), minutes: z.number().int().min(1).max(1440), billable: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('proposal_yes'), item_key: itemKeySchema, minutes: z.number().int().min(0).max(1440).nullable() }).strict(),
]);
export type HomeReconcileBody = z.output<typeof homeReconcileBodySchema>;
