/**
 * Bast chat: small helpers shared by the routes under app/api/bast-chat (task C3). Nothing here deletes anything.
 *
 * - `chatJson` and `chatError`: every response is no-store, every failure body is `{error: "<plain sentence>"}`
 *   (no codes, no zod details).
 * - `ownerPostGuard`: same-origin and JSON content type for Mike's POSTs and PATCHes.
 * - `ownerJsonBody`: size-limited, strict-schema body for Mike's routes.
 * - `workerOwnerId`: the owner the worker acts for, from the settings (the worker never names a user).
 * - `panelFeed`, `panelActions`, `lastAssistantSeq`: the shapes the panel hook reads.
 * - `ownerToday`: the owner's Today in a small shape for the machine's `today` tool (read only, no scores).
 */
import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError, AuthError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { getZonedDateString } from '@/lib/utils/time';
import { loadHomeInputs } from '@/lib/home/load';
import { getHomeDay, loadItemStates } from '@/lib/home/state';
import { selectHome } from '@/lib/home/select';
import { assembleHomeResponse, proposeDay } from '@/lib/home/today';
import type { HomeItem } from '@/lib/home/types';
import { cleanLine } from './card-context';
import { feed, type FeedEvent } from './events';
import { listActions } from './actions';
import { getSettings } from './settings';
import { chatWorkerBody } from './worker-kit';

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
export const OWNER_BODY_BYTES = 64 * 1024;
const NOT_FOUND = 'Chat not found';

export function chatJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** One failure shape for every chat route: `{error}` and no-store. Server errors are logged without detail leaking out. */
export function chatError(error: unknown): NextResponse {
  if (error instanceof AuthError) return chatJson({ error: error.message }, error.statusCode);
  if (error instanceof ApiError) return chatJson({ error: error.message }, error.statusCode);
  if (error instanceof ZodError) return chatJson({ error: 'That request is not valid. Check the fields and try again.' }, 400);
  console.error('Bast chat route error:', error instanceof Error ? error.message : 'unknown');
  return chatJson({ error: 'Something went wrong. Try again.' }, 500);
}

/** Null when the request may proceed, else the refusal (JSON content type, same origin), with the chat's error shape. */
export function ownerPostGuard(request: NextRequest): NextResponse | null {
  const refusal = rejectCrossSiteRequest(request);
  if (!refusal) return null;
  const error = refusal.status === 415 ? 'Send the request as JSON.' : 'That request did not come from this site.';
  return chatJson({ error }, refusal.status);
}

/** Bounded JSON body, strict schema (an unknown field is a ZodError, so a 400 through `chatError`). */
export function ownerJsonBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  return chatWorkerBody(request, schema, OWNER_BODY_BYTES);
}

/** The owner the worker acts for. Without an owner the chat does not exist, so 404. */
export async function workerOwnerId(db: Pick<PrismaClient, 'bastChatSettings'> = defaultDb): Promise<string> {
  const s = await getSettings(db);
  if (!s.owner_user_id) throw new ApiError(NOT_FOUND, 404, 'not_found');
  return s.owner_user_id;
}

export interface PanelEvent {
  seq: number;
  role: string;
  kind: string;
  payload: { text?: string; code?: string };
  client_ref?: string;
  delivered?: boolean;
  expired?: boolean;
  created_at: string;
}

/**
 * Events as the panel reads them. Only the text and the status code travel (a tool, action, result or cost event
 * goes out with an empty payload, so no tool result or cost detail reaches the browser). Mike's messages carry
 * `client_ref`, `delivered` and `expired`.
 */
export async function panelFeed(
  conversationId: string,
  after: number,
  db: Pick<PrismaClient, 'bastChatEvent'> = defaultDb,
): Promise<{ events: PanelEvent[]; waiting: { seq: number; delivered: boolean; expired: boolean }[]; last_seq: number; has_more: boolean }> {
  const page = await feed(conversationId, { after }, db);
  const mikeSeqs = page.events.filter((e) => e.role === 'mike').map((e) => e.seq);
  const refs = mikeSeqs.length
    ? await db.bastChatEvent.findMany({ where: { conversation_id: conversationId, seq: { in: mikeSeqs } }, select: { seq: true, client_ref: true } })
    : [];
  const refBySeq = new Map(refs.map((r) => [r.seq, r.client_ref]));
  const events = page.events.map((e) => toPanelEvent(e, refBySeq.get(e.seq) ?? null));
  const open = await db.bastChatEvent.findMany({
    where: { conversation_id: conversationId, role: 'mike', delivered_at: null },
    orderBy: { seq: 'asc' },
    take: 100,
    select: { seq: true, expired_at: true },
  });
  const waiting = open.map((o) => ({ seq: o.seq, delivered: false, expired: o.expired_at !== null }));
  return { events, waiting, last_seq: page.last_seq, has_more: page.has_more };
}

function toPanelEvent(e: FeedEvent, clientRef: string | null): PanelEvent {
  const p = (e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? e.payload : {}) as { text?: unknown; code?: unknown };
  const shown: { text?: string; code?: string } = {};
  if (e.kind === 'text' || e.kind === 'status') {
    if (typeof p.text === 'string') shown.text = p.text;
    if (e.kind === 'status' && typeof p.code === 'string') shown.code = p.code;
  }
  return {
    seq: e.seq,
    role: e.role,
    kind: e.kind,
    payload: shown,
    ...(e.role === 'mike' ? { client_ref: clientRef, delivered: e.delivered_at !== null, expired: e.expired_at !== null } : {}),
    created_at: e.created_at.toISOString(),
  } as PanelEvent;
}

export interface PanelAction {
  id: string;
  tool: string;
  summary: string;
  status: string;
  undo_until: string | null;
  event_seq: number | null;
  proposed_assignee?: string | null;
}

/** The conversation's actions as the panel reads them. A proposal names who it would go to by first name. */
export async function panelActions(
  conversationId: string,
  now: Date = new Date(),
  db: Pick<PrismaClient, 'bastChatAction' | 'user'> = defaultDb,
): Promise<PanelAction[]> {
  const list = await listActions(conversationId, now, db);
  const ids = [...new Set(list.map((a) => a.proposed_assignee_id).filter((v): v is string => !!v))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, cleanLine(u.name.split(/\s+/)[0] ?? '', 40)]));
  return list.map((a) => ({
    id: a.id,
    tool: a.tool,
    summary: a.summary,
    status: a.status,
    undo_until: a.can_undo && a.undo_until ? a.undo_until.toISOString() : null,
    event_seq: a.event_seq,
    ...(a.proposed_assignee_id ? { proposed_assignee: nameOf.get(a.proposed_assignee_id) ?? null } : {}),
  }));
}

/** Highest seq of an assistant text message in the conversation, or null. */
export async function lastAssistantSeq(conversationId: string, db: Pick<PrismaClient, 'bastChatEvent'> = defaultDb): Promise<number | null> {
  const r = await db.bastChatEvent.findFirst({
    where: { conversation_id: conversationId, role: 'assistant', kind: 'text' },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  return r?.seq ?? null;
}

export interface TodayLine {
  key: string;
  title: string;
  who: string | null;
  age: string;
  effort: string;
}

export interface OwnerToday {
  date: string;
  arc_name: string | null;
  why: string | null;
  size_line: string | null;
  quick: TodayLine[];
  steps: TodayLine[];
}

const line = (i: HomeItem): TodayLine => ({ key: i.key, title: i.title, who: i.who, age: i.age, effort: i.effort });

/**
 * The owner's Today, the way GET /api/home builds it but read only (it stores nothing and moves no emergency):
 * the stored day of the local date, else what would be proposed now. Trimmed to the arc name and, per item, the key,
 * title, who, age and effort. No score, class, reason or button ever leaves this function.
 */
export async function ownerToday(ownerId: string, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<OwnerToday> {
  const timezone = await resolveUserTimezone(ownerId);
  const date = getZonedDateString(now, timezone);
  const [raw, states] = await Promise.all([loadHomeInputs(db, ownerId, now, { timezone }), loadItemStates(db, ownerId)]);
  const sel = selectHome({ raw, states, now });
  const day = (await getHomeDay(db, ownerId, date)) ?? proposeDay(sel, raw.calendar_events, now);
  const body = assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now, timezone, user_id: ownerId });
  const t = body.today;
  if (!t) return { date, arc_name: null, why: null, size_line: null, quick: [], steps: [] };
  return { date, arc_name: t.arc_name, why: t.why, size_line: t.size_line, quick: t.quick.map(line), steps: t.steps.map(line) };
}
