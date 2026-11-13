/**
 * Bast chat: conversations and the event log. Nothing here deletes anything.
 *
 * seq is gapless per conversation and allocated under the conversation ROW LOCK (SELECT ... FOR NO KEY UPDATE,
 * then UPDATE last_seq = last_seq + n RETURNING), so a later seq is never visible before an earlier one and `feed`
 * never skips an event. A repeat `client_ref` returns the first seq and stores nothing.
 *
 * Where this row sits in the one lock order of the chat lane (task advisory locks, then task-side rows, then this
 * conversation row, then the day's usage row): see the table in task-locks.ts (VERIFY-6 A1).
 *
 * FOR NO KEY UPDATE, not FOR UPDATE (VERIFY-5 Z1): writers of this row only change non-key columns (last_seq, status,
 * cost), so they serialize with each other exactly as before, while a transaction that holds FOR KEY SHARE on the row
 * (Postgres takes it for the foreign key whenever a transaction inserts or updates a bast_chat_actions or
 * bast_chat_events row of this conversation) no longer blocks them. With FOR UPDATE, two taps of one conversation each
 * held KEY SHARE (from their own action-row updates) and each waited for the other's to take the row: a deadlock.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { isChatUuid } from './worker-kit';
import { assertCanSend, bumpUsage } from './usage';
import { cleanLine, type CardContext } from './card-context';
import type { ChatSettings } from './settings';

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_EVENT_PAYLOAD_BYTES = 16 * 1024;
export const MAX_EVENT_TEXT_BYTES = 8 * 1024;
export const MAX_WORKER_EVENTS_PER_POST = 100;
export const MAX_LIVE_TEXT_CHARS = 4000;
export const FEED_DEFAULT_LIMIT = 200;
export const FEED_MAX_LIMIT = 500;
export const HISTORY_DEFAULT = 20;
export const IDLE_CLOSE_HOURS = 4;
export const WORKER_EVENT_ROLES = ['assistant', 'tool', 'system'] as const;
export const WORKER_EVENT_KINDS = ['text', 'action', 'result', 'status', 'cost'] as const;
export const EXPIRED_TEXT = 'Not answered: the machine was off when you sent this. Send it again if it still matters.';
export const CLOSED_TEXT = 'This chat is closed. Start a new one.';
export const STOP_CODE = 'stop_requested';

type Db = PrismaClient;

/** 413 when the payload is over 16 KB or its `text` over 8 KB. */
export function assertPayloadCaps(payload: unknown): number {
  const json = JSON.stringify(payload ?? null);
  if (json === undefined) throw new ApiError('Payload must be JSON', 400, 'bad_payload');
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_EVENT_PAYLOAD_BYTES) throw new ApiError('That is too long', 413, 'payload_too_large');
  const text = payload && typeof payload === 'object' ? (payload as { text?: unknown }).text : undefined;
  if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > MAX_EVENT_TEXT_BYTES) throw new ApiError('That is too long', 413, 'text_too_large');
  return bytes;
}

/** Lock the conversation row and allocate `n` seqs. Returns the first seq and the status. Call inside a transaction. */
export async function allocateSeq(tx: Prisma.TransactionClient, conversationId: string, n: number): Promise<{ first: number; status: string }> {
  const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM bast_chat_conversations WHERE id = ${conversationId}::uuid FOR NO KEY UPDATE`;
  if (locked.length !== 1) throw new ApiError('Chat not found', 404, 'not_found');
  const rows = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE bast_chat_conversations SET last_seq = last_seq + ${n}::int WHERE id = ${conversationId}::uuid RETURNING last_seq`;
  return { first: rows[0].last_seq - n + 1, status: locked[0].status };
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  title: string | null;
  status: string;
  last_message_at: Date | null;
  created_at: Date;
  /** The card this conversation is about (operating model S4), or null for the general home chat. */
  task_id: string | null;
}

const SUMMARY_SELECT = { id: true, title: true, status: true, last_message_at: true, created_at: true, task_id: true } as const;

/**
 * Start a new conversation. Any open GENERAL conversation of the owner is marked closed (kept, never deleted).
 * A conversation tied to a card (`taskId`) is exempt from that one-open rule in both directions: starting the
 * general chat leaves card conversations alone, and a card conversation never closes another one. It also never
 * starts a second conversation for the same card: the card's own conversation is REOPENED (closed or idle, it goes
 * to idle, `closed_at` cleared, its events untouched) and `reopened` is true.
 */
export async function startConversation(ownerId: string, now: Date = new Date(), db: Db = defaultDb, taskId?: string | null): Promise<{ id: string; reopened: boolean }> {
  if (taskId) return openCardConversation(ownerId, taskId, db);
  return db.$transaction(async (tx) => {
    await tx.bastChatConversation.updateMany({ where: { owner_id: ownerId, task_id: null, status: { not: 'closed' } }, data: { status: 'closed', closed_at: now, live_text: null, live_action: null } });
    const c = await tx.bastChatConversation.create({ data: { owner_id: ownerId }, select: { id: true } });
    return { id: c.id, reopened: false };
  });
}

async function openCardConversation(ownerId: string, taskId: string, db: Db): Promise<{ id: string; reopened: boolean }> {
  const reopen = async (): Promise<{ id: string; reopened: boolean } | null> => {
    const existing = await db.bastChatConversation.findUnique({ where: { owner_id_task_id: { owner_id: ownerId, task_id: taskId } }, select: { id: true, status: true } });
    if (!existing) return null;
    // Only a closed one changes: an idle, queued or running one is already open (never touch a turn in flight).
    if (existing.status === 'closed') {
      await db.bastChatConversation.updateMany({ where: { id: existing.id, status: 'closed' }, data: { status: 'idle', closed_at: null, live_text: null, live_action: null } });
    }
    return { id: existing.id, reopened: true };
  };
  const found = await reopen();
  if (found) return found;
  try {
    const c = await db.bastChatConversation.create({ data: { owner_id: ownerId, task_id: taskId }, select: { id: true } });
    return { id: c.id, reopened: false };
  } catch (e) {
    // Two taps at once: the unique (owner, card) index let one win; the other reopens that one.
    if ((e as { code?: string }).code === 'P2002') {
      const again = await reopen();
      if (again) return again;
    }
    throw e;
  }
}

/** The owner's most recent general conversation that is not closed, or null. Card conversations are never "the current chat". */
export async function currentConversation(ownerId: string, db: Pick<PrismaClient, 'bastChatConversation'> = defaultDb): Promise<ConversationSummary | null> {
  return db.bastChatConversation.findFirst({
    where: { owner_id: ownerId, task_id: null, status: { not: 'closed' } },
    orderBy: { created_at: 'desc' },
    select: SUMMARY_SELECT,
  });
}

/** The owner's conversation about one card, open or closed, or null. */
export async function conversationForTask(ownerId: string, taskId: string, db: Pick<PrismaClient, 'bastChatConversation'> = defaultDb): Promise<ConversationSummary | null> {
  return db.bastChatConversation.findUnique({ where: { owner_id_task_id: { owner_id: ownerId, task_id: taskId } }, select: SUMMARY_SELECT });
}

/** The last 20 conversations (open and closed), newest first. */
export async function listConversations(ownerId: string, limit = 20, db: Pick<PrismaClient, 'bastChatConversation'> = defaultDb): Promise<ConversationSummary[]> {
  return db.bastChatConversation.findMany({
    where: { owner_id: ownerId },
    orderBy: { created_at: 'desc' },
    take: Math.min(50, Math.max(1, Math.trunc(limit) || 20)),
    select: SUMMARY_SELECT,
  });
}

/** Mark idle conversations closed after 4 hours without a message. Marks only; nothing is deleted. */
export async function closeIdleConversations(now: Date = new Date(), db: Pick<PrismaClient, 'bastChatConversation'> = defaultDb): Promise<number> {
  const cutoff = new Date(now.getTime() - IDLE_CLOSE_HOURS * 3600 * 1000);
  const r = await db.bastChatConversation.updateMany({
    where: { status: 'idle', updated_at: { lt: cutoff }, OR: [{ last_message_at: null }, { last_message_at: { lt: cutoff } }] },
    data: { status: 'closed', closed_at: now, live_text: null, live_action: null },
  });
  return r.count;
}

/** A conversation the owner may use, else 404. */
export async function ownedConversation(conversationId: string, ownerId: string, db: Pick<PrismaClient, 'bastChatConversation'> = defaultDb) {
  if (!isChatUuid(conversationId)) throw new ApiError('Chat not found', 404, 'not_found');
  const c = await db.bastChatConversation.findUnique({ where: { id: conversationId } });
  if (!c || c.owner_id !== ownerId) throw new ApiError('Chat not found', 404, 'not_found');
  return c;
}

// ---------------------------------------------------------------------------
// Mike's messages and stops
// ---------------------------------------------------------------------------

export interface AppendMikeInput {
  conversationId: string;
  ownerId: string;
  text: string;
  context: CardContext;
  clientRef: string;
  settings: ChatSettings;
  now?: Date;
}

/**
 * Mike's message. Checks the conversation is his and open, the text is 1 to 4,000 characters, and `client_ref`
 * is 1 to 64 characters. A repeat `client_ref` answers first with the stored seq (`duplicate: true`, no cap
 * check, nothing counted). Otherwise the daily caps are checked (429, one plain line), the event is stored with
 * `delivered_at` null, the conversation goes to `queued`, and today's message count goes up by one.
 */
export async function appendMikeMessage(input: AppendMikeInput, db: Db = defaultDb): Promise<{ seq: number; duplicate: boolean }> {
  if (!isChatUuid(input.conversationId)) throw new ApiError('Chat not found', 404, 'not_found');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) throw new ApiError('Write a message first', 400, 'empty_message');
  if (text.length > MAX_MESSAGE_CHARS) throw new ApiError(`Keep it under ${MAX_MESSAGE_CHARS} characters`, 400, 'message_too_long');
  if (!input.clientRef || input.clientRef.length > 64) throw new ApiError('client_ref is required (max 64 characters)', 400, 'bad_client_ref');
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string; owner_id: string }[]>`SELECT status::text AS status, owner_id::text AS owner_id FROM bast_chat_conversations WHERE id = ${input.conversationId}::uuid FOR NO KEY UPDATE`;
    if (locked.length !== 1 || locked[0].owner_id !== input.ownerId) throw new ApiError('Chat not found', 404, 'not_found');
    const dup = await tx.bastChatEvent.findUnique({ where: { conversation_id_client_ref: { conversation_id: input.conversationId, client_ref: input.clientRef } }, select: { seq: true } });
    if (dup) return { seq: dup.seq, duplicate: true };
    if (locked[0].status === 'closed') throw new ApiError(CLOSED_TEXT, 409, 'chat_closed');
    await assertCanSend(input.ownerId, input.settings, now, tx);
    const rows = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE bast_chat_conversations SET last_seq = last_seq + 1 WHERE id = ${input.conversationId}::uuid RETURNING last_seq`;
    const seq = rows[0].last_seq;
    await tx.bastChatEvent.create({
      data: { conversation_id: input.conversationId, seq, role: 'mike', kind: 'text', payload: { text }, context: input.context as unknown as Prisma.InputJsonValue, client_ref: input.clientRef },
    });
    const conv = await tx.bastChatConversation.findUnique({ where: { id: input.conversationId }, select: { title: true, status: true } });
    await tx.bastChatConversation.update({
      where: { id: input.conversationId },
      data: { status: conv?.status === 'running' ? 'running' : 'queued', last_message_at: now, ...(conv && !conv.title ? { title: cleanLine(text, 60) || null } : {}) },
    });
    await bumpUsage(input.ownerId, { turns: 1 }, now, tx);
    return { seq, duplicate: false };
  });
}

/**
 * Queue a stop for the running turn. A stop is a system status event with code `stop_requested`; the inbox
 * serves it once and marks it delivered. Returns `{queued: false}` when no turn is running.
 */
export async function requestStop(conversationId: string, ownerId: string, db: Db = defaultDb): Promise<{ queued: boolean }> {
  if (!isChatUuid(conversationId)) throw new ApiError('Chat not found', 404, 'not_found');
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string; owner_id: string }[]>`SELECT status::text AS status, owner_id::text AS owner_id FROM bast_chat_conversations WHERE id = ${conversationId}::uuid FOR NO KEY UPDATE`;
    if (locked.length !== 1 || locked[0].owner_id !== ownerId) throw new ApiError('Chat not found', 404, 'not_found');
    if (locked[0].status !== 'running') return { queued: false };
    const pending = await tx.bastChatEvent.count({ where: { conversation_id: conversationId, role: 'system', kind: 'status', delivered_at: null, expired_at: null, payload: { path: ['code'], equals: STOP_CODE } } });
    if (pending > 0) return { queued: true };
    const rows = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE bast_chat_conversations SET last_seq = last_seq + 1 WHERE id = ${conversationId}::uuid RETURNING last_seq`;
    await tx.bastChatEvent.create({ data: { conversation_id: conversationId, seq: rows[0].last_seq, role: 'system', kind: 'status', payload: { code: STOP_CODE, text: 'Stopping.' } } });
    return { queued: true };
  });
}

// ---------------------------------------------------------------------------
// The daemon's events
// ---------------------------------------------------------------------------

/**
 * House rule: no en or em dash in anything the reader sees. The model sometimes writes one anyway, so the server
 * swaps each (with the space around it) for ", " and collapses doubled spaces. Written as escapes on purpose.
 * The same scrubber is the backstop for three more slips: the words for ranking a task ("priority", "priorities",
 * "overdue" become "order", "order", "late"), literal bold marks (`**`), and heading marks at the start of a line.
 */
export function stripDashes(text: string): string {
  return text
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/\bpriorit(?:y|ies)\b/gi, 'order')
    .replace(/\boverdue\b/gi, 'late')
    .replace(/\*\*/g, '')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/ {2,}/g, ' ');
}

function cleanAssistantPayload(e: { role: string; kind: string; payload: Prisma.InputJsonValue }): Prisma.InputJsonValue {
  if (e.role !== 'assistant' || e.kind !== 'text') return e.payload;
  const p = e.payload as { text?: unknown } | null;
  if (!p || typeof p !== 'object' || typeof p.text !== 'string') return e.payload;
  return { ...(p as Record<string, Prisma.InputJsonValue>), text: stripDashes(p.text) };
}

export interface WorkerEventInput {
  role: (typeof WORKER_EVENT_ROLES)[number];
  kind: (typeof WORKER_EVENT_KINDS)[number];
  payload: Prisma.InputJsonValue;
  turn?: number | null;
}

/** The dollars a batch's cost events add (each 0 to 100). */
function costOfBatch(events: WorkerEventInput[]): number {
  return events.reduce((sum, e) => {
    if (e.kind !== 'cost') return sum;
    const v = Number((e.payload as { turn_usd?: unknown } | null)?.turn_usd);
    return Number.isFinite(v) && v > 0 && v < 100 ? sum + v : sum;
  }, 0);
}

/**
 * The daemon's batch: up to 100 assistant, tool or system events get seqs, and in the same transaction `acks`
 * set `delivered_at` once on Mike's messages. A `cost` event adds `turn_usd` to the conversation and to today's
 * usage. Allowed on a closed conversation (the last events of a turn can land after the close).
 */
export async function appendWorkerEvents(
  conversationId: string,
  ownerId: string | null,
  input: { acks?: number[]; events?: WorkerEventInput[] },
  now: Date = new Date(),
  db: Db = defaultDb,
): Promise<{ last_seq: number; first_seq: number | null; acked: number }> {
  if (!isChatUuid(conversationId)) throw new ApiError('Chat not found', 404, 'not_found');
  const events = input.events ?? [];
  const acks = [...new Set(input.acks ?? [])].filter((n) => Number.isInteger(n) && n > 0);
  if (events.length > MAX_WORKER_EVENTS_PER_POST) throw new ApiError(`At most ${MAX_WORKER_EVENTS_PER_POST} events per post`, 413, 'too_many_events');
  for (const e of events) {
    if (!(WORKER_EVENT_ROLES as readonly string[]).includes(e.role)) throw new ApiError('Worker events must have role assistant, tool or system', 400, 'bad_role');
    if (!(WORKER_EVENT_KINDS as readonly string[]).includes(e.kind)) throw new ApiError('Unknown event kind', 400, 'bad_kind');
    assertPayloadCaps(e.payload);
  }
  return db.$transaction(async (tx) => {
    let first: number | null = null;
    let last: number;
    let costOwner: string | null = null;
    if (events.length > 0) {
      const alloc = await allocateSeq(tx, conversationId, events.length);
      first = alloc.first;
      last = alloc.first + events.length - 1;
      await tx.bastChatEvent.createMany({
        data: events.map((e, i) => ({ conversation_id: conversationId, seq: alloc.first + i, role: e.role, kind: e.kind, payload: cleanAssistantPayload(e), turn: e.turn ?? null })),
      });
      const cost = costOfBatch(events);
      if (cost > 0) {
        const conv = await tx.bastChatConversation.update({ where: { id: conversationId }, data: { cost_usd: { increment: cost } }, select: { owner_id: true } });
        costOwner = ownerId ?? conv.owner_id;
      }
    } else {
      const c = await tx.bastChatConversation.findUnique({ where: { id: conversationId }, select: { last_seq: true } });
      if (!c) throw new ApiError('Chat not found', 404, 'not_found');
      last = c.last_seq;
    }
    let acked = 0;
    if (acks.length > 0) {
      const r = await tx.bastChatEvent.updateMany({ where: { conversation_id: conversationId, role: 'mike', seq: { in: acks }, delivered_at: null }, data: { delivered_at: now } });
      acked = r.count;
    }
    // The day's usage row last, so it is held only for the commit (VERIFY-6 A1, the lock order in task-locks.ts).
    if (costOwner) await bumpUsage(costOwner, { cost_usd: costOfBatch(events) }, now, tx);
    return { last_seq: last, first_seq: first, acked };
  });
}

export interface WorkerConversationPatch {
  status?: 'idle' | 'queued' | 'running';
  live_text?: string | null;
  live_action?: string | null;
  model?: string | null;
  cost_usd?: number;
}

/**
 * The daemon's PATCH: status (never `closed`; only Citadel closes), live_text (last 4,000 characters), live_action
 * (one line, 200), the resolved model (refused when it is not sonnet or haiku, so a Fable or Opus name is never
 * stored) and cost. `cost_usd` here sets the conversation total only; the day's usage comes from cost events.
 */
export async function patchWorkerConversation(conversationId: string, patch: WorkerConversationPatch, db: Pick<PrismaClient, 'bastChatConversation'> = defaultDb): Promise<void> {
  if (!isChatUuid(conversationId)) throw new ApiError('Chat not found', 404, 'not_found');
  const data: Prisma.BastChatConversationUpdateInput = {};
  if (patch.status !== undefined) {
    if (!['idle', 'queued', 'running'].includes(patch.status)) throw new ApiError('Bad status', 400, 'bad_status');
    data.status = patch.status;
  }
  if (patch.live_text !== undefined) data.live_text = patch.live_text === null ? null : stripDashes(patch.live_text).slice(-MAX_LIVE_TEXT_CHARS);
  if (patch.live_action !== undefined) data.live_action = patch.live_action === null ? null : cleanLine(patch.live_action, 200);
  if (patch.model !== undefined) {
    if (patch.model !== null && !/^(sonnet|haiku|claude-(sonnet|haiku)-\d+(-\d+)*(-\d{8})?)$/.test(patch.model)) throw new ApiError('That model is not allowed in the chat', 400, 'bad_model');
    data.model = patch.model;
  }
  if (patch.cost_usd !== undefined) {
    if (!Number.isFinite(patch.cost_usd) || patch.cost_usd < 0 || patch.cost_usd > 1000) throw new ApiError('Bad cost', 400, 'bad_cost');
    data.cost_usd = patch.cost_usd;
  }
  const current = await db.bastChatConversation.findUnique({ where: { id: conversationId }, select: { status: true } });
  if (!current) throw new ApiError('Chat not found', 404, 'not_found');
  // A closed chat keeps its status; the daemon may still clear live text and report cost.
  if (current.status === 'closed') delete data.status;
  await db.bastChatConversation.update({ where: { id: conversationId }, data });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface FeedEvent {
  seq: number;
  role: string;
  kind: string;
  payload: Prisma.JsonValue;
  context: Prisma.JsonValue | null;
  expired_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Notes for the chat: what Mike did to its actions (plan v2 section 6, VERIFY D16 and F8)
// ---------------------------------------------------------------------------

/**
 * One system status event per occurrence, so the chat is told on its next turn what changed under it:
 * - `action_undone`: Mike undid a change (the text is the server's line of that change).
 * - `action_released`: Mike tapped yes on a proposal and it was carried out.
 * - `action_declined`: Mike tapped no; nothing changed.
 * - `action_failed`: Mike's tap was refused because the record changed since; nothing changed.
 * - `undo_proposed`: Mike's Undo would start or re-steer Bast or show the client, so it waits for his tap.
 * These are for the chat only. The panel does not show them (its action lines already show the new state), so
 * `feed` hides them, as it hides stop requests. Only `expired` and the other status events stay visible.
 */
export const CHAT_NOTE_CODES = ['action_undone', 'action_released', 'action_declined', 'action_failed', 'undo_proposed'] as const;
export type ChatNoteCode = (typeof CHAT_NOTE_CODES)[number];
/** Status codes the panel feed never shows. */
export const PANEL_HIDDEN_STATUS_CODES: readonly string[] = [STOP_CODE, ...CHAT_NOTE_CODES];

export interface ChatNote {
  seq: number;
  code: ChatNoteCode;
  text: string;
  action_id: string | null;
}

/**
 * Add one note to the conversation, under its row lock (gapless seq). Call inside a transaction. The text is the
 * server's own line, cleaned (one line, 300 characters, no dash). Allowed on a closed conversation.
 */
export async function appendChatNote(
  tx: Prisma.TransactionClient,
  conversationId: string,
  note: { code: ChatNoteCode; text: string; action_id?: string | null },
): Promise<number> {
  if (!(CHAT_NOTE_CODES as readonly string[]).includes(note.code)) throw new ApiError('Unknown note', 400, 'bad_note');
  const alloc = await allocateSeq(tx, conversationId, 1);
  const text = stripDashes(cleanLine(note.text, 300));
  await tx.bastChatEvent.create({
    data: { conversation_id: conversationId, seq: alloc.first, role: 'system', kind: 'status', payload: { code: note.code, text, action_id: note.action_id ?? null } },
  });
  return alloc.first;
}

/**
 * The notes the chat has not been told yet, oldest first, marked delivered in the same call (each is served once).
 * For the inbox or the daemon's next turn of that conversation.
 */
export async function takeChatNotes(conversationId: string, now: Date = new Date(), db: Pick<PrismaClient, 'bastChatEvent'> = defaultDb): Promise<ChatNote[]> {
  const rows = await db.bastChatEvent.findMany({
    where: { conversation_id: conversationId, role: 'system', kind: 'status', delivered_at: null },
    orderBy: { seq: 'asc' },
    take: 200,
    select: { seq: true, payload: true },
  });
  const notes: ChatNote[] = [];
  for (const r of rows) {
    const p = (r.payload ?? {}) as { code?: unknown; text?: unknown; action_id?: unknown };
    if (typeof p.code !== 'string' || !(CHAT_NOTE_CODES as readonly string[]).includes(p.code)) continue;
    notes.push({ seq: r.seq, code: p.code as ChatNoteCode, text: typeof p.text === 'string' ? p.text : '', action_id: typeof p.action_id === 'string' ? p.action_id : null });
  }
  if (notes.length > 0) {
    await db.bastChatEvent.updateMany({ where: { conversation_id: conversationId, role: 'system', kind: 'status', seq: { in: notes.map((n) => n.seq) }, delivered_at: null }, data: { delivered_at: now } });
  }
  return notes;
}

/** Events with seq > after, ascending, at most `limit`. Stop requests and the chat's notes are internal and are not shown. */
export async function feed(
  conversationId: string,
  opts: { after?: number; limit?: number } = {},
  db: Pick<PrismaClient, 'bastChatEvent'> = defaultDb,
): Promise<{ events: FeedEvent[]; last_seq: number; has_more: boolean }> {
  const after = Number.isInteger(opts.after) && (opts.after as number) > 0 ? (opts.after as number) : 0;
  const limit = Math.min(FEED_MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? FEED_DEFAULT_LIMIT) || FEED_DEFAULT_LIMIT));
  const rows = await db.bastChatEvent.findMany({
    where: { conversation_id: conversationId, seq: { gt: after } },
    orderBy: { seq: 'asc' },
    take: limit + 1,
    select: { seq: true, role: true, kind: true, payload: true, context: true, expired_at: true, delivered_at: true, created_at: true },
  });
  const has_more = rows.length > limit;
  const page = has_more ? rows.slice(0, limit) : rows;
  const events = page.filter((e) => {
    if (e.role !== 'system' || e.kind !== 'status') return true;
    const code = (e.payload as { code?: unknown } | null)?.code;
    return !(typeof code === 'string' && PANEL_HIDDEN_STATUS_CODES.includes(code));
  });
  return { events, last_seq: page.length > 0 ? page[page.length - 1].seq : after, has_more };
}

/** The last `n` text events (Mike's and Bast's), oldest first, to seed a reopened query. */
export async function recentText(conversationId: string, n = HISTORY_DEFAULT, db: Pick<PrismaClient, 'bastChatEvent'> = defaultDb): Promise<{ seq: number; role: string; text: string }[]> {
  const rows = await db.bastChatEvent.findMany({
    where: { conversation_id: conversationId, kind: 'text', expired_at: null, role: { in: ['mike', 'assistant'] } },
    orderBy: { seq: 'desc' },
    take: Math.min(50, Math.max(1, Math.trunc(n) || HISTORY_DEFAULT)),
    select: { seq: true, role: true, payload: true },
  });
  return rows
    .reverse()
    .map((r) => ({ seq: r.seq, role: r.role, text: String((r.payload as { text?: unknown } | null)?.text ?? '') }))
    .filter((r) => r.text.length > 0);
}
