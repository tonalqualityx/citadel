import { z } from 'zod';
import { randomUUID } from 'crypto';
import { chatChecklist, chatRichText, plainString } from './plain';
import type { AuthPayload } from '@/lib/auth/middleware';
import { ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { getSettings } from './settings';
import { reserveWrite } from './usage';
import { isChatUuid } from './worker-kit';
import { BAST_USER_ID } from './gate-mirror';
import { checkTaskCreate, type ReachTask } from './worker-reach';
import type { ProposalResult } from './actions';
import type { PatchTaskExpect } from '@/lib/services/task-patch';

/**
 * Body filter for the `bast-chat` API-key lane on POST /api/tasks and PATCH /api/tasks/:id (plan v2 1.2, 1.3).
 * Lane keys are checked per route, not per field, so this is the field allowlist. It is an ALLOWLIST: a field
 * that is not in the table below is refused, so a column added to the schema later does not open by accident.
 * Every caller that is not the `bast-chat` lane gets the very same body object back, untouched.
 *
 * Open is the default: the chat changes any task, whoever holds it, in every field of the table, each with its
 * own validation here. Closed is the exception and each closed field has a reason in the plan: the approval and
 * provenance machinery (a client's yes publishes), billing (ruling 7), `function_id` (can auto-assign to Bast),
 * board layout. Whether an open change would start or re-steer Bast, or show something to a client, is not decided
 * here: `chatPatchGate` (below) asks the reach check after the body passes, and a hit becomes a proposal.
 */

export const CHAT_LANE = 'bast-chat';
export const CHAT_TAG = 'from-chat';

/** Plan section 6, verbatim: the line for a closed field, and for a security tag. */
export const CLOSED_FIELD_TEXT = 'That field is changed on the task page, not here.';
export const SECURITY_TAG_TEXT = "I can't remove a security tag. I can take it out of Needs you now if you want.";
export const HAND_TO_BAST_TEXT = 'Handing work to Bast needs your tap. File it to yourself first, then hand it over.';
/** VERIFY-5 Z3: Sabeen's queue is read by Bast's delegate pass. */
export const DELEGATE_CREATE_TEXT = "Filing work into Sabeen's queue needs your tap. File it to yourself first, then hand it over.";
/** VERIFY-3 X2: the model tier is Mike's alone (policy.json tag_overrides: "Only Mike sets these"). */
export const TIER_TAG_TEXT = 'Only you set the model tier, on the task page.';
/** `promised_to` holds a person's or a client's name. */
/**
 * `promised_to` from the chat (VERIFY-4 R5): a person's or a client's name. Letters (with their accents), spaces,
 * hyphens and apostrophes; a full stop only right after a single letter, for an initial ("J. Smith", "J.R. Ewing");
 * at most 60 characters and 4 words. Anything else is refused with PROMISE_TEXT.
 */
export const PROMISE_MAX = 60;
export const PROMISE_MAX_WORDS = 4;
const PROMISE_WORD = /^(?:(?:\p{L}\.)+|\p{L}[\p{L}\p{M}'\u2019-]*)$/u;
export function isPromiseName(v: string): boolean {
  if (v.length === 0 || v.length > PROMISE_MAX || v !== v.trim() || /\s{2,}/.test(v) || /[^\S ]/.test(v)) return false;
  const words = v.split(' ');
  return words.length <= PROMISE_MAX_WORDS && words.every((w) => PROMISE_WORD.test(w));
}
export const PROMISE_TEXT = 'A promise is a name, up to four words, like Jill or J. Smith.';
/** Tags that pick the model a worker runs on (model-policy.py `find_tag_override`). */
export const isTierTag = (t: string) => t.trim().toLowerCase().startsWith('tier:');

/** PATCH: the keys the chat may send. `tags_add` and `tags_remove` become the full `tags` list on the server. */
export const CHAT_PATCH_FIELDS = [
  'status', 'title', 'description', 'requirements', 'notes', 'assignee_id', 'project_id', 'client_id', 'site_id',
  'arc_id', 'origin_url', 'tags_add', 'tags_remove', 'energy_estimate', 'mystery_factor', 'battery_impact', 'due_date', 'promised_to',
  'priority', 'is_focus', 'blocked_by_ids', 'needs_review', 'approved', 'client_visible',
] as const;
/** PATCH: fields that are closed on purpose (plan 1.2). Named so the refusal can give the plan's sentence. Any other key is refused too. */
export const CHAT_CLOSED_FIELDS = [
  'client_approved_at', 'approved_by_contact_id', 'approval_source', 'staging_preview_url', 'staging_deployed_at',
  'source', 'source_ref', 'requested_by_contact_id', 'review_requirements', 'reviewer_id',
  'is_billable', 'billing_target', 'billing_amount', 'is_retainer_work', 'is_support',
  'function_id', 'phase', 'sort_order', 'hard_due_at', 'hard_due_source',
] as const;
/** POST: the only keys the chat may send. `due_date` is dropped, not refused (see the POST rules below). */
export const CHAT_POST_ALLOWED = [
  'title', 'description', 'assignee_id', 'tags', 'client_id', 'site_id', 'sop_id', 'project_id', 'arc_id',
  'energy_estimate', 'mystery_factor', 'battery_impact', 'priority', 'is_focus', 'needs_review', 'due_date', 'promised_to',
] as const;
/**
 * POST: request controls the chat may send beside the task fields (they are not task fields, so they are not in the field table).
 * Work stage D: `source_key` is the source the task is for (`email:<conversation key>`), so the guard can answer already_tracked; `create_anyway` is
 * the owner's own "create it anyway" after he heard that answer.
 */
export const CHAT_POST_CONTROLS = ['source_key', 'create_anyway'] as const;
/** Statuses: all six (plan 1.2). Closing is `done`, letting go is `abandoned`, reopening is `not_started` or `in_progress`. */
export const CHAT_PATCH_STATUSES = ['triage', 'not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'] as const;

type Code = 'chat_field_refused' | 'chat_lane_refused';
export type ChatFilterInput = {
  auth: Pick<AuthPayload, 'lane' | 'laneEnforced'>;
  method: 'POST' | 'PATCH';
  body: unknown;
  /** The chat owner's user id (BastChatSettings.owner_user_id). Only read for the bast-chat lane. */
  ownerId?: string | null;
  /** PATCH only: the task as stored now (its tags build the full list from `tags_add` and `tags_remove`). */
  existing?: { id?: string; assignee_id?: string | null; tags?: string[] | null; requirements?: unknown } | null;
};

export type ChatFilterResult =
  | { ok: true; body: unknown; dropped?: string[] }
  | { ok: false; status: 403; code: Code; message: string };

const refuse = (code: Code, message: string): ChatFilterResult => ({ ok: false, status: 403, code, message });
const refuseField = (field: string): ChatFilterResult => refuse('chat_field_refused', `${CLOSED_FIELD_TEXT} Field: ${field}`);
/** "<what>: <field>", or for a whole sentence (ends in a full stop) "<sentence> Field: <field>", like the closed fields. */
const badValue = (field: string, what: string): ChatFilterResult => refuse('chat_field_refused', what.endsWith('.') ? `${what} Field: ${field}` : `${what}: ${field}`);

// Each field's own validation, on the value after `plainString` (VERIFY-4 R1). The checklist's shape is judged by
// `chatChecklist` (lines of text only), which runs right after.
const requirementsSchema = z.array(z.unknown()).max(200);

const uuidOrNull = z.string().uuid().nullable();
const fieldSchemas: Record<string, { schema: z.ZodTypeAny; what: string }> = {
  status: { schema: z.enum(CHAT_PATCH_STATUSES), what: 'That is not a status' },
  title: { schema: z.string().trim().min(1).max(200).refine((t) => !/[\r\n]/.test(t)), what: 'The title must be one line of up to 200 characters' },
  // Text, or the BlockNote blocks create-task.py sends in its follow-up PATCH (the route serializes either).
  description: {
    schema: z.union([z.string().max(4000), z.array(z.unknown()).max(200).refine((a) => JSON.stringify(a).length <= 40000)]).nullable(),
    what: 'The description must be text of up to 4,000 characters',
  },
  origin_url: { schema: z.string().max(1000), what: 'The link must be text of up to 1,000 characters' },
  notes: { schema: z.string().max(4000).nullable(), what: 'The notes must be text of up to 4,000 characters' },
  requirements: { schema: requirementsSchema.nullable(), what: 'The checklist is not in the right shape' },
  assignee_id: { schema: uuidOrNull, what: 'The person must be an id or null' },
  project_id: { schema: uuidOrNull, what: 'The project must be an id or null' },
  client_id: { schema: uuidOrNull, what: 'The client must be an id or null' },
  site_id: { schema: uuidOrNull, what: 'The site must be an id or null' },
  arc_id: { schema: uuidOrNull, what: 'The arc must be an id or null' },
  energy_estimate: { schema: z.number().int().min(1).max(8).nullable(), what: 'The estimate must be 1 to 8 or null' },
  mystery_factor: { schema: z.enum(['none', 'average', 'significant', 'no_idea']), what: 'That is not a mystery factor' },
  battery_impact: { schema: z.enum(['average_drain', 'high_drain', 'energizing']), what: 'That is not a battery impact' },
  due_date: { schema: z.string().datetime().nullable(), what: 'The date must be an ISO date and time or null' },
  // Who it was promised to: a short name on one line, never a sentence (VERIFY-3 X2: the worker reads it).
  promised_to: { schema: z.string().refine(isPromiseName).nullable(), what: PROMISE_TEXT },
  priority: { schema: z.number().int().min(1).max(5), what: 'The order must be 1 to 5' },
  is_focus: { schema: z.boolean(), what: 'The focus flag must be true or false' },
  needs_review: { schema: z.boolean(), what: 'The review flag must be true or false' },
  approved: { schema: z.boolean(), what: 'The approval flag must be true or false' },
  client_visible: { schema: z.boolean(), what: 'The sharing flag must be true or false' },
};
const blockersSchema = z
  .object({ connect: z.array(z.string().uuid()).max(20).optional(), disconnect: z.array(z.string().uuid()).max(20).optional() })
  .strict();
const tagList = z.array(z.string().trim().min(1).max(50)).max(10);

const lower = (t: string) => t.trim().toLowerCase();
/** Tags the chat never adds or removes: the approval machinery, and `from-chat` itself. */
const isMachineryTag = (t: string) => {
  const x = lower(t);
  return x === 'client-approved' || x.startsWith('cp:') || x.startsWith('preview-notified:') || x === CHAT_TAG;
};
const isSecurityTag = (t: string) => ['security', 'security-report'].includes(lower(t));

function tagsFor(b: Record<string, unknown>, existing: ChatFilterInput['existing']): { ok: true; tags: string[] } | { ok: false; res: ChatFilterResult } {
  const addRaw = 'tags_add' in b ? tagList.safeParse(b.tags_add) : null;
  const remRaw = 'tags_remove' in b ? tagList.safeParse(b.tags_remove) : null;
  if (addRaw && !addRaw.success) return { ok: false, res: badValue('tags_add', 'The tags must be a short list of text') };
  if (remRaw && !remRaw.success) return { ok: false, res: badValue('tags_remove', 'The tags must be a short list of text') };
  const add = addRaw?.success ? addRaw.data : [];
  const rem = remRaw?.success ? remRaw.data : [];
  if (rem.some(isSecurityTag)) return { ok: false, res: refuse('chat_field_refused', `${SECURITY_TAG_TEXT} Field: tags_remove`) };
  if (add.some(isTierTag)) return { ok: false, res: refuse('chat_field_refused', `${TIER_TAG_TEXT} Field: tags_add`) };
  if (rem.some(isTierTag)) return { ok: false, res: refuse('chat_field_refused', `${TIER_TAG_TEXT} Field: tags_remove`) };
  if (add.some(isMachineryTag)) return { ok: false, res: refuseField('tags_add') };
  if (rem.some(isMachineryTag)) return { ok: false, res: refuseField('tags_remove') };
  const current = [...(existing?.tags ?? [])];
  const out = current.filter((t) => !rem.some((r) => lower(r) === lower(t)));
  for (const t of add) if (!out.some((x) => lower(x) === lower(t))) out.push(t.trim());
  return { ok: true, tags: out };
}

export function filterChatTaskBody(input: ChatFilterInput): ChatFilterResult {
  const { auth, method, body, ownerId, existing } = input;
  // Any caller that is not the chat lane: the same object, no copy, no read.
  if (auth.lane !== CHAT_LANE) return { ok: true, body };

  if (auth.laneEnforced !== true) return refuse('chat_lane_refused', 'The chat key must be enforced.');
  if (!ownerId) return refuse('chat_lane_refused', 'The chat owner is not set.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse('chat_field_refused', 'The request body must be an object.');
  }
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);

  if (method === 'PATCH') {
    for (const k of keys) {
      if ((CHAT_CLOSED_FIELDS as readonly string[]).includes(k)) return refuseField(k);
      if (k === 'tags') return badValue(k, 'Send tags_add or tags_remove, not tags');
      if (!(CHAT_PATCH_FIELDS as readonly string[]).includes(k)) return badValue(k, 'The chat cannot change this field');
    }
    const plain = plainBody(b);
    for (const k of keys) {
      if (k === 'tags_add' || k === 'tags_remove' || k === 'blocked_by_ids') continue;
      const f = fieldSchemas[k];
      if (!f.schema.safeParse(plain[k]).success) return badValue(k, f.what);
    }
    // origin_url is open as in version one: only on a task that is the owner's and that the chat filed.
    if ('origin_url' in b && !(existing?.assignee_id === ownerId && (existing?.tags ?? []).includes(CHAT_TAG))) return refuseField('origin_url');
    if ('blocked_by_ids' in b) {
      const p = blockersSchema.safeParse(b.blocked_by_ids);
      if (!p.success) return badValue('blocked_by_ids', 'The tasks it waits on must be lists of ids');
      if (existing?.id && [...(p.data.connect ?? [])].includes(existing.id)) return badValue('blocked_by_ids', 'A task cannot wait on itself');
    }
    const stored = storedForms(plain, existing?.id ?? 'task', existing?.requirements);
    if (!stored.ok) return stored.res;
    if (!('tags_add' in b) && !('tags_remove' in b)) return { ok: true, body: stored.body };
    const t = tagsFor(plain, existing);
    if (!t.ok) return t.res;
    const { tags_add: _a, tags_remove: _r, ...rest } = stored.body;
    void _a; void _r;
    return { ok: true, body: { ...rest, tags: t.tags } };
  }

  // POST
  for (const k of keys) {
    if (!(CHAT_POST_ALLOWED as readonly string[]).includes(k) && !(CHAT_POST_CONTROLS as readonly string[]).includes(k)) return refuseField(k);
  }
  const pb = plainBody(b);
  if (typeof b.assignee_id !== 'string' || !z.string().uuid().safeParse(b.assignee_id).success) {
    return badValue('assignee_id', 'A task from the chat must be assigned to someone');
  }
  // Bast as the assignee is a proposal only Mike's tap can release; a create has no proposal, so it is refused.
  if (b.assignee_id === BAST_USER_ID) return refuse('chat_field_refused', `${HAND_TO_BAST_TEXT} Field: assignee_id`);
  const tags = pb.tags;
  const extra = Array.isArray(tags) ? tags.filter((t) => t !== CHAT_TAG) : [];
  if (
    !Array.isArray(tags) || !tags.includes(CHAT_TAG) || tags.filter((t) => t === CHAT_TAG).length !== 1 ||
    tags.length > 5 || extra.some((t) => typeof t !== 'string' || t.trim().length === 0 || t.length > 50)
  ) {
    return badValue('tags', `Tags must be ${CHAT_TAG} and at most 4 others`);
  }
  if (extra.some((t) => typeof t === 'string' && isTierTag(t))) return refuse('chat_field_refused', `${TIER_TAG_TEXT} Field: tags`);
  if (extra.some((t) => isMachineryTag(t))) return refuseField('tags');
  // create-task.py sends its defaults; only the do-nothing values pass.
  if ('priority' in b && b.priority !== 3) return badValue('priority', 'The chat cannot set this field');
  if ('is_focus' in b && b.is_focus !== false) return badValue('is_focus', 'The chat cannot set this field');
  if ('needs_review' in b && b.needs_review !== false) return badValue('needs_review', 'The chat cannot set this field');
  if ('promised_to' in pb && !fieldSchemas.promised_to.schema.safeParse(pb.promised_to).success) return badValue('promised_to', fieldSchemas.promised_to.what);
  if ('source_key' in b && !(typeof b.source_key === 'string' && b.source_key.length > 0 && b.source_key.length <= 320)) return badValue('source_key', 'A source key is text such as email:<conversation key>');
  if ('create_anyway' in b && typeof b.create_anyway !== 'boolean') return badValue('create_anyway', 'create_anyway is true or false');
  if ('title' in pb && !fieldSchemas.title.schema.safeParse(pb.title).success) return badValue('title', fieldSchemas.title.what);
  if ('description' in pb && !fieldSchemas.description.schema.safeParse(pb.description).success) return badValue('description', fieldSchemas.description.what);
  const stored = storedForms(pb, randomUUID(), null);
  if (!stored.ok) return stored.res;
  // create-task.py always sends a default date, so the date is dropped here (a date Mike names is set by a PATCH).
  if ('due_date' in stored.body) {
    const rest = { ...stored.body };
    delete rest.due_date;
    return { ok: true, body: rest, dropped: ['due_date'] };
  }
  return { ok: true, body: stored.body };
}

/** Free-text keys of a chat body (VERIFY-4 R1): each string loses its invisible and control characters. */
const TEXT_KEYS = ['title', 'description', 'notes', 'promised_to', 'origin_url'];
const TEXT_LIST_KEYS = ['tags', 'tags_add', 'tags_remove'];
function plainBody(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...b };
  for (const k of TEXT_KEYS) if (typeof out[k] === 'string') out[k] = plainString(out[k] as string);
  // Stored as checked (VERIFY-5 Z7): the title is validated trimmed, so it is stored trimmed.
  if (typeof out.title === 'string') out.title = out.title.trim();
  for (const k of TEXT_LIST_KEYS) if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).map((t) => (typeof t === 'string' ? plainString(t) : t));
  return out;
}

/**
 * The exact stored form of the chat's text (VERIFY-4 R1, R2): description and notes as plain paragraphs, the
 * checklist as lines of text with the server's ids and ticks. What this returns is what the reach check judges, the
 * card shows, the write stores and a tap writes again, byte for byte. Rich content the chat cannot write is refused.
 */
function storedForms(b: Record<string, unknown>, seed: string, currentChecklist: unknown): { ok: true; body: Record<string, unknown> } | { ok: false; res: ChatFilterResult } {
  const out = { ...b };
  for (const k of ['description', 'notes', 'requirements'] as const) {
    if (!(k in out)) continue;
    try {
      out[k] = k === 'requirements' ? chatChecklist(out[k], currentChecklist, `${seed}:requirements`) : chatRichText(out[k], `${seed}:${k}`);
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, res: refuse('chat_field_refused', `${e.message} Field: ${k}`) };
      throw e;
    }
  }
  return { ok: true, body: out };
}

export const NOTHING_TO_CHANGE_TEXT = 'There is nothing to change in that request.';
export const CLOSED_CHAT_TEXT = 'That chat is closed. Start a new one.';

/**
 * Route helper: returns the body untouched (no database read) for any non-chat caller; for the chat lane it
 * reads the owner from BastChatSettings, applies the filter, and throws a 403 ApiError on a refusal.
 */
export async function guardChatTaskBody<T>(
  auth: Pick<AuthPayload, 'lane' | 'laneEnforced'>,
  method: 'POST' | 'PATCH',
  body: T,
  existing?: { id?: string; assignee_id?: string | null; tags?: string[] | null; requirements?: unknown } | null,
): Promise<T> {
  if (auth.lane !== CHAT_LANE) return body;
  const settings = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  const r = filterChatTaskBody({ auth, method, body, ownerId: settings?.owner_user_id ?? null, existing });
  if (!r.ok) throw new ApiError(r.message, r.status, r.code);
  if (method === 'PATCH' && (!r.body || typeof r.body !== 'object' || Object.keys(r.body as object).length === 0)) {
    throw new ApiError(NOTHING_TO_CHANGE_TEXT, 400, 'chat_nothing_to_change');
  }
  // The daily write cap is reserved here, atomically, before any write: 429 with the plain cap sentence.
  // A reserved write whose task write then fails (409, validation error) stays counted: a refused attempt
  // costing a slot is acceptable and simpler than a refund. A proposal stored by a task route is not reserved
  // again (`reserve: false`): this reservation is its one.
  await reserveWrite(settings!.owner_user_id!, (await getSettings(prisma)).daily_write_cap, new Date(), prisma);
  return r.body as T;
}

export const CHAT_CONVERSATION_HEADER = 'X-Bast-Chat-Conversation';
export const NEEDS_CONVERSATION_TEXT = 'Say which chat this change belongs to.';
export const BAD_CONVERSATION_TEXT = 'That chat was not found.';
export const NO_OPEN_CHAT_TEXT = 'Open the chat first.';

/**
 * Which conversation a chat-lane write belongs to. Null for every other caller (nothing is read).
 * - PATCH and POST alike: the header `X-Bast-Chat-Conversation` is checked when present (malformed, foreign or,
 *   for a PATCH, closed is refused). When absent (create-task.py's follow-up PATCH cannot send it) the owner's
 *   current open conversation is used, and with none open the request is a 400. Every chat change writes a record
 *   or a proposal, and both belong to a conversation.
 * The conversation must exist and belong to the chat owner. Call it after the guard and before any write.
 */
export async function chatConversationFor(
  auth: Pick<AuthPayload, 'lane'>,
  headers: Headers,
  method: 'POST' | 'PATCH',
): Promise<string | null> {
  if (auth.lane !== CHAT_LANE) return null;
  const settings = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  const ownerId = settings?.owner_user_id;
  if (!ownerId) throw new ApiError('The chat owner is not set.', 403, 'chat_lane_refused');
  const header = headers.get(CHAT_CONVERSATION_HEADER);
  if (header === null || header === '') {
    // No header (create-task.py's follow-up PATCH cannot send one): the owner's current open conversation.
    const open = await prisma.bastChatConversation.findFirst({
      where: { owner_id: ownerId, status: { not: 'closed' } },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    if (!open) throw new ApiError(NO_OPEN_CHAT_TEXT, 400, 'chat_no_conversation');
    return open.id;
  }
  if (!isChatUuid(header)) throw new ApiError(BAD_CONVERSATION_TEXT, 400, 'chat_conversation_invalid');
  const conv = await prisma.bastChatConversation.findUnique({ where: { id: header }, select: { owner_id: true, status: true } });
  if (!conv || conv.owner_id !== ownerId) throw new ApiError(BAD_CONVERSATION_TEXT, 400, 'chat_conversation_invalid');
  if (method === 'PATCH' && conv.status === 'closed') throw new ApiError(CLOSED_CHAT_TEXT, 409, 'chat_conversation_closed');
  // The ops route's rule (VERIFY-2 N6): a change named for a conversation is made while a turn is being answered.
  // The owner's tap and Undo never come through here (they call patchTask as the owner), and the header-less
  // follow-up PATCH of create-task.py keeps the newest open conversation above.
  if (method === 'PATCH' && conv.status !== 'running') throw new ApiError(NO_OPEN_CHAT_TEXT, 409, 'conversation_not_running');
  return header;
}

export const RACE_TEXT = 'The task changed while that was being written. Open the task.';

/**
 * Chat lane only (the PATCH route calls it only for that lane): run the reach check and the write while holding the
 * advisory locks of the task, the tasks it waits on, the tasks that wait on it, and any task the body connects or
 * disconnects (task-locks.ts, VERIFY-2 N1). The owner's tap holds the same locks from its re-check to its write, so
 * neither can land between the other's check and write. Nothing here runs for any other caller.
 */
export async function withChatTaskLock<T>(taskId: string, body: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const { scopeFor, withLocks } = await import('./task-locks');
  const links = (body.blocked_by_ids ?? null) as { connect?: unknown; disconnect?: unknown } | null;
  const linked = [links?.connect, links?.disconnect].flatMap((x) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []));
  const scope = await scopeFor(prisma, [taskId, ...linked]);
  return withLocks(prisma, scope, () => fn());
}

/**
 * PATCH write target. The chat lane writes only if the owner and `updated_at` are still what the request read at
 * its start (a miss is a 409); every other caller keeps `{ id }` exactly.
 */
export function taskWriteWhere(
  auth: Pick<AuthPayload, 'lane'>,
  id: string,
  existing: { assignee_id?: string | null; updated_at?: Date | null },
): { id: string; assignee_id?: string | null; updated_at?: Date } {
  if (auth.lane !== CHAT_LANE) return { id };
  return { id, assignee_id: existing.assignee_id ?? null, ...(existing.updated_at ? { updated_at: existing.updated_at } : {}) };
}

/** `.catch` handler for the PATCH writes: a compare-and-set miss from the chat lane becomes a 409. */
export function chatWriteMiss(auth: Pick<AuthPayload, 'lane'>) {
  return (e: unknown): never => {
    if (auth.lane === CHAT_LANE && typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2025') {
      throw new ApiError(RACE_TEXT, 409, 'changed_since');
    }
    throw e;
  };
}

/** What the chat-lane PATCH route needs after the body and conversation are checked. */
export type ChatPatchGate =
  | { kind: 'proposal'; proposal: Pick<ProposalResult, 'id' | 'line' | 'proposal_kind'> }
  | { kind: 'write'; expect: PatchTaskExpect; existing: Record<string, unknown> };

/**
 * Chat lane only (the route calls it only for that lane): the reach check on a PATCH that passed the filter and
 * the conversation check (plan 4.2). `prepareOperation` loads the task the way the tap does and runs the rules.
 * - A hit (it would start or re-steer Bast, or show something to a client): the proposal is stored, nothing is
 *   written to the task, and the route answers 202 with the action id and the line. The daily write was already
 *   reserved by `guardChatTaskBody`, so the proposal passes `reserve: false`.
 * - No hit: the route writes through `patchTask` with `expect`, so the write lands only on the row the reach was
 *   judged on. `existing` is the route's task row plus its blockers, so the change record can name them.
 * The actions module is loaded here, on demand, so no other caller ever loads or runs it.
 */
export async function chatPatchGate(a: {
  taskId: string;
  body: Record<string, unknown>;
  conversationId: string | null;
  existing: Record<string, unknown>;
  now?: Date;
}): Promise<ChatPatchGate> {
  const settings = await prisma.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  const ownerId = settings?.owner_user_id;
  if (!ownerId) throw new ApiError('The chat owner is not set.', 403, 'chat_lane_refused');
  if (!a.conversationId) throw new ApiError(NEEDS_CONVERSATION_TEXT, 400, 'chat_conversation_required');
  const { prepareOperation, storeProposal } = await import('./actions');
  const now = a.now ?? new Date();
  // `origin_url` is not a task column (patchTask drops it) and the plan body is strict, so it stays out of the plan.
  // Every text field is already in its exact stored form (filterChatTaskBody, plain.ts): the plan, the reach check and
  // the write all see the same bytes (VERIFY-4 R2, Y3).
  const { origin_url: _link, ...rest } = a.body;
  void _link;
  const planBody: Record<string, unknown> = { ...rest };
  if (Object.keys(planBody).length === 0) {
    const e = a.existing as { updated_at?: Date; assignee_id?: string | null };
    return { kind: 'write', expect: { assignee_id: e.assignee_id ?? null, ...(e.updated_at ? { updated_at: e.updated_at } : {}) }, existing: a.existing };
  }
  const { input, prepared } = await prepareOperation('task', { task_id: a.taskId, body: planBody }, { ownerId, now });
  if (prepared.reach.needs_tap) {
    const p = await storeProposal({ ownerId, conversationId: a.conversationId, tool: 'change_task', op: 'task', input, prepared, reserve: false, now });
    return { kind: 'proposal', proposal: { id: p.id, line: p.line, proposal_kind: p.proposal_kind } };
  }
  const blockers = await prisma.task.findUnique({ where: { id: a.taskId }, select: { blocked_by: { select: { id: true } } } });
  return { kind: 'write', expect: prepared.expect as PatchTaskExpect, existing: { ...a.existing, blocked_by: blockers?.blocked_by ?? [] } };
}

/**
 * Chat lane only: a create that would reach (the reach check's create rules) is refused. A create has no
 * proposal kind, so a new task assigned to Bast, or anything else the check names, is a 403 and nothing is
 * written. The chat files the task to Mike and then changes its assignee, which is a proposal.
 */
export function refuseChatCreateThatReaches(task: Partial<ReachTask> & { assignee_id: string | null }, now: Date = new Date()): void {
  const r = checkTaskCreate({ task: { id: '00000000-0000-4000-8000-000000000000', ...task } as ReachTask, assignee_resolved: true, now });
  // VERIFY-5 Z3: a task filed into a delegate's queue puts its text where Bast's delegate pass reads it.
  if (r.needs_tap && r.starts.every((h) => h.rule === 'edits_delegate_text')) throw new ApiError(DELEGATE_CREATE_TEXT, 403, 'chat_field_refused');
  if (r.needs_tap) throw new ApiError(HAND_TO_BAST_TEXT, 403, 'chat_field_refused');
}
