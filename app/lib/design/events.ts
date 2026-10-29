/**
 * Designer Portal: the session event log (design 6 invariants 2, 3 and 5; 7.1 feed and messages; 7.3 events/inbox; D6).
 *
 * seq is gapless and ordered per session. It is allocated under the session ROW LOCK (SELECT ... FOR UPDATE,
 * then UPDATE last_seq = last_seq + n RETURNING) inside the insert transaction, so a second appender waits until
 * the first commits: a later seq is never visible before an earlier one, which is what lets `feed(after)` never
 * skip an event.
 */
import type { DesignEvent, DesignEventKind, DesignEventRole, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { isUuid } from './helpers';

export const MAX_EVENT_PAYLOAD_BYTES = 32 * 1024;
export const MAX_EVENT_TEXT_BYTES = 20 * 1024;
export const MAX_WORKER_EVENTS_PER_POST = 100;
export const FEED_DEFAULT_LIMIT = 200;
export const FEED_MAX_LIMIT = 500;
export const WORKER_EVENT_ROLES = ['assistant', 'tool', 'system'] as const satisfies readonly DesignEventRole[];
export const DESIGNER_EVENT_KINDS = ['text', 'apply'] as const satisfies readonly DesignEventKind[];
/** T14 (W8.2 H5): at most 30 designer messages (text or apply) per session per rolling minute; the 31st is 429. */
export const DESIGNER_MESSAGES_PER_MINUTE = 30;
export const DESIGNER_MESSAGE_WINDOW_SECONDS = 60;
/** A designer message is delivered only while the session can take a turn; paused_budget, publishing, stopped and pending hold it. */
export const DELIVERABLE_STATUSES = ['awaiting_input', 'active'] as const;

type Db = PrismaClient;

/** 413 when the payload is over 32 KB or its `text` over 20 KB. Returns the byte size. */
export function assertPayloadCaps(payload: unknown): number {
  const json = JSON.stringify(payload ?? null);
  if (json === undefined) throw new ApiError('Payload must be JSON', 400, 'bad_payload');
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_EVENT_PAYLOAD_BYTES) throw new ApiError(`Event payload is over ${MAX_EVENT_PAYLOAD_BYTES} bytes`, 413, 'payload_too_large');
  const text = payload && typeof payload === 'object' ? (payload as { text?: unknown }).text : undefined;
  if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > MAX_EVENT_TEXT_BYTES) {
    throw new ApiError(`Event text is over ${MAX_EVENT_TEXT_BYTES} bytes`, 413, 'text_too_large');
  }
  return bytes;
}

/** Lock the session row and allocate `n` seqs. Returns the first seq and the session status. */
async function allocate(tx: Prisma.TransactionClient, sessionId: string, n: number): Promise<{ first: number; status: string }> {
  const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM design_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
  if (locked.length !== 1) throw new ApiError('Session not found', 404, 'not_found');
  const rows = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE design_sessions SET last_seq = last_seq + ${n}::int WHERE id = ${sessionId}::uuid RETURNING last_seq`;
  return { first: rows[0].last_seq - n + 1, status: locked[0].status };
}

export interface AppendDesignerInput {
  sessionId: string;
  authorId: string;
  kind: 'text' | 'apply';
  payload: Prisma.InputJsonValue;
  clientRef: string;
}

/**
 * A designer (or admin) message or Apply. Starts pending for the worker (delivered_at null). A repeat of the
 * same client_ref is a no-op that returns the first seq (`duplicate: true`). Refused (409 session_closed) on a
 * closed or abandoned session. Stored but held in paused_budget / publishing / stopped / pending: the inbox
 * only returns deliverable statuses.
 *
 * Rate limit (T14, W8.2 H5): the session's designer events in the last 60 s are counted in the database under
 * the same row lock that allocates the seq, so concurrent posts and several app instances see one count; past
 * 30 the new event is refused with 429 `rate_limited` and nothing is written. A repeat of a stored client_ref
 * is answered before the count, so a retry of an accepted message never turns into a 429.
 */
export async function appendDesignerEvent(input: AppendDesignerInput, db: Db = defaultDb): Promise<{ seq: number; duplicate: boolean }> {
  if (!isUuid(input.sessionId)) throw new ApiError('Session not found', 404, 'not_found');
  assertPayloadCaps(input.payload);
  if (!input.clientRef || input.clientRef.length > 64) throw new ApiError('client_ref is required (max 64 characters)', 400, 'bad_client_ref');
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM design_sessions WHERE id = ${input.sessionId}::uuid FOR UPDATE`;
    if (locked.length !== 1) throw new ApiError('Session not found', 404, 'not_found');
    if (locked[0].status === 'closed' || locked[0].status === 'abandoned') throw new ApiError('This session is closed', 409, 'session_closed');
    const dup = await tx.designEvent.findUnique({ where: { session_id_client_ref: { session_id: input.sessionId, client_ref: input.clientRef } }, select: { seq: true } });
    if (dup) return { seq: dup.seq, duplicate: true };
    const since = new Date(Date.now() - DESIGNER_MESSAGE_WINDOW_SECONDS * 1000);
    const recent = await tx.designEvent.count({ where: { session_id: input.sessionId, role: 'designer', created_at: { gt: since } } });
    if (recent >= DESIGNER_MESSAGES_PER_MINUTE) {
      throw new ApiError(`At most ${DESIGNER_MESSAGES_PER_MINUTE} messages a minute per session; wait a moment and send again`, 429, 'rate_limited', 'messages_per_minute');
    }
    const rows = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE design_sessions SET last_seq = last_seq + 1 WHERE id = ${input.sessionId}::uuid RETURNING last_seq`;
    const seq = rows[0].last_seq;
    await tx.designEvent.create({
      data: { session_id: input.sessionId, seq, role: 'designer', kind: input.kind, payload: input.payload, author_id: input.authorId, client_ref: input.clientRef },
    });
    return { seq, duplicate: false };
  });
}

export interface WorkerEventInput {
  role: (typeof WORKER_EVENT_ROLES)[number];
  kind: DesignEventKind;
  payload: Prisma.InputJsonValue;
  turn?: number | null;
}

/**
 * The worker's batch: allocates seqs for up to 100 assistant/tool/system events and, in the same
 * transaction, acks designer events (sets delivered_at on those seqs, once). Worker events are allowed on any
 * session state (the close status event arrives after the move to a terminal state).
 */
export async function appendWorkerEvents(
  sessionId: string,
  input: { acks?: number[]; events?: WorkerEventInput[] },
  db: Db = defaultDb,
): Promise<{ last_seq: number; first_seq: number | null; acked: number }> {
  if (!isUuid(sessionId)) throw new ApiError('Session not found', 404, 'not_found');
  const events = input.events ?? [];
  const acks = [...new Set(input.acks ?? [])].filter((n) => Number.isInteger(n) && n > 0);
  if (events.length > MAX_WORKER_EVENTS_PER_POST) throw new ApiError(`At most ${MAX_WORKER_EVENTS_PER_POST} events per post`, 413, 'too_many_events');
  for (const e of events) {
    if (!(WORKER_EVENT_ROLES as readonly string[]).includes(e.role)) throw new ApiError('Worker events must have role assistant, tool or system', 400, 'bad_role');
    assertPayloadCaps(e.payload);
  }
  return db.$transaction(async (tx) => {
    let first: number | null = null;
    let last: number;
    if (events.length > 0) {
      const alloc = await allocate(tx, sessionId, events.length);
      first = alloc.first;
      last = alloc.first + events.length - 1;
      await tx.designEvent.createMany({
        data: events.map((e, i) => ({ session_id: sessionId, seq: alloc.first + i, role: e.role, kind: e.kind, payload: e.payload, turn: e.turn ?? null })),
      });
    } else {
      const s = await tx.designSession.findUnique({ where: { id: sessionId }, select: { last_seq: true } });
      if (!s) throw new ApiError('Session not found', 404, 'not_found');
      last = s.last_seq;
    }
    let acked = 0;
    if (acks.length > 0) {
      const r = await tx.designEvent.updateMany({
        where: { session_id: sessionId, role: 'designer', seq: { in: acks }, delivered_at: null },
        data: { delivered_at: new Date() },
      });
      acked = r.count;
    }
    return { last_seq: last, first_seq: first, acked };
  });
}

export interface FeedEvent {
  seq: number;
  role: DesignEventRole;
  kind: DesignEventKind;
  payload: Prisma.JsonValue;
  created_at: Date;
}

/**
 * Events with seq > after, ascending, at most `limit`. Because seqs become visible in order (see the file
 * header), a client that resumes from the last seq it saw never misses one. `last_seq` echoes the highest seq
 * returned (or `after` when none) so the browser can use it as its next cursor.
 */
export async function feed(
  sessionId: string,
  opts: { after?: number; limit?: number } = {},
  db: Pick<PrismaClient, 'designEvent'> = defaultDb,
): Promise<{ events: FeedEvent[]; last_seq: number; has_more: boolean }> {
  const after = Number.isInteger(opts.after) && (opts.after as number) > 0 ? (opts.after as number) : 0;
  const limit = Math.min(FEED_MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? FEED_DEFAULT_LIMIT) || FEED_DEFAULT_LIMIT));
  const rows = await db.designEvent.findMany({
    where: { session_id: sessionId, seq: { gt: after } },
    orderBy: { seq: 'asc' },
    take: limit + 1,
    select: { seq: true, role: true, kind: true, payload: true, created_at: true },
  });
  const has_more = rows.length > limit;
  const events = has_more ? rows.slice(0, limit) : rows;
  return { events, last_seq: events.length > 0 ? events[events.length - 1].seq : after, has_more };
}

export interface PendingMessage {
  session_id: string;
  seq: number;
  kind: DesignEventKind;
  payload: Prisma.JsonValue;
  author_id: string | null;
}

/** Undelivered designer events of sessions that can take a turn, oldest first (the inbox's `messages`). */
export async function pendingDesignerEvents(max = 50, db: Pick<PrismaClient, 'designEvent'> = defaultDb): Promise<PendingMessage[]> {
  const rows = await db.designEvent.findMany({
    where: { role: 'designer', delivered_at: null, session: { status: { in: [...DELIVERABLE_STATUSES] } } },
    orderBy: [{ created_at: 'asc' }, { seq: 'asc' }],
    take: Math.min(200, Math.max(1, Math.trunc(max) || 50)),
    select: { session_id: true, seq: true, kind: true, payload: true, author_id: true },
  });
  return rows;
}

/** True when the session has a designer event the worker has not acked (feed `next_poll_ms`). */
export async function hasUndelivered(sessionId: string, db: Pick<PrismaClient, 'designEvent'> = defaultDb): Promise<boolean> {
  return (await db.designEvent.count({ where: { session_id: sessionId, role: 'designer', delivered_at: null } })) > 0;
}

export type { DesignEvent };
