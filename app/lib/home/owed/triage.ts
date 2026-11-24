/**
 * Owed-reply triage. A thread is owed (shown as waiting on his reply, given a clock, queued for a draft) only after a
 * verdict for its newest message says a reply from him is needed. The verdict lives on home_owed_thread and belongs to one
 * ask (triage_for_ask_id): a newer message clears it by being a different ask.
 *
 * Pure helpers (the view a verdict puts a thread in, the reason check, the Handled line) and the two writers that close a
 * thread as "No reply needed" and put it back. The close is the same dismissal the screen's own "No reply needed" performs
 * (every open ask on the thread goes to state dismissed), so the Seeing Stone and the chat see it too.
 */

import type { Prisma } from '@prisma/client';
import { OWED_CHECK } from './checks';
import { TRIAGE_COPY } from './copy';
import type { OwedRow } from './state';

export const TRIAGE_VERDICTS = ['reply', 'no_reply', 'task', 'meeting_set'] as const;
export type TriageVerdict = (typeof TRIAGE_VERDICTS)[number];
export const TRIAGE_CONFIDENCES = ['high', 'medium'] as const;
export type TriageConfidence = (typeof TRIAGE_CONFIDENCES)[number];

/** The home_actions.action of a close (the keeper's own, and his press on Close it). */
export const TRIAGE_ACTION = 'triage_close';
export const TRIAGE_CLOSE_PER_DAY = 15;
export const TRIAGE_REASON_MAX = 200;
const HOLD_MS = 30 * 86_400_000;
const UNDO_MS = 72 * 3_600_000;

/**
 * Where a thread stands after triage:
 * - owed: the verdict is reply (the thread has its clock, its draft and its Waiting words)
 * - untriaged: no verdict for the newest message yet (age only, no pressure, never queued for a draft)
 * - task: they asked for work, not an answer
 * - probably_no_reply: no_reply or meeting_set, and the thread is still open (medium, over the daily cap, held, or reopened)
 */
export type TriageView = 'owed' | 'untriaged' | 'task' | 'probably_no_reply';

export interface TriageFacts {
  verdict: TriageVerdict;
  confidence: TriageConfidence;
  reason: string;
}

type TriageRow = Pick<OwedRow, 'triage' | 'triage_confidence' | 'triage_reason' | 'triage_for_ask_id'>;

/** The verdict for the newest ask, or null (none, or it was made for an older ask). */
export function triageFor(row: TriageRow | null | undefined, newestAskId: string): TriageFacts | null {
  if (!row || !row.triage || row.triage_for_ask_id !== newestAskId) return null;
  if (!(TRIAGE_VERDICTS as readonly string[]).includes(row.triage)) return null;
  return {
    verdict: row.triage as TriageVerdict,
    confidence: row.triage_confidence === 'high' ? 'high' : 'medium',
    reason: row.triage_reason ?? '',
  };
}

export function triageView(row: TriageRow | null | undefined, newestAskId: string): TriageView {
  const t = triageFor(row, newestAskId);
  if (!t) return 'untriaged';
  if (t.verdict === 'reply') return 'owed';
  if (t.verdict === 'task') return 'task';
  return 'probably_no_reply';
}

/** True only for a thread whose verdict is reply. Every consumer that counts an owed reply reads this. */
export function isOwedReply(row: TriageRow | null | undefined, newestAskId: string): boolean {
  return triageView(row, newestAskId) === 'owed';
}

export function holdActive(row: Pick<OwedRow, 'triage_hold_until'> | null | undefined, now: Date): boolean {
  return !!row?.triage_hold_until && row.triage_hold_until.getTime() > now.getTime();
}

/** Checks on the reason line a model wrote: one plain line, at most 200 characters, no dash, no banned word, no link. */
export function checkTriageReason(text: string): { ok: true } | { ok: false; match: string } {
  const t = text.trim();
  if (t.length === 0) return { ok: false, match: 'empty' };
  if (t.length > TRIAGE_REASON_MAX) return { ok: false, match: 'too long' };
  if (/[\r\n]/.test(text)) return { ok: false, match: 'not one line' };
  const dash = OWED_CHECK.dash.exec(text);
  if (dash) return { ok: false, match: dash[0] };
  const banned = OWED_CHECK.banned.exec(text);
  if (banned) return { ok: false, match: banned[0] };
  const url = /https?:\/\/|\bwww\.|\b[\w.-]+\.(?:com|org|net|io|co|app|dev)\b|\S+@\S+/i.exec(text);
  if (url) return { ok: false, match: url[0] };
  return { ok: true };
}

const noClean = (s: string): string => s.replace(/[–—]/g, ' ').replace(/\s+/g, ' ').trim();

/** The thing that was closed, in plain words, from the reason ("a thank-you", "a booking note"). */
export function closedThing(reason: string, verdict: TriageVerdict): string {
  if (verdict === 'meeting_set') return TRIAGE_COPY.thingBooking;
  const r = reason.toLowerCase();
  if (/thank|thx|appreciat/.test(r)) return TRIAGE_COPY.thingThanks;
  if (/acknowledg|got it|received|confirm/.test(r)) return TRIAGE_COPY.thingAck;
  if (/automat|notice|receipt|notification|no-?reply/.test(r)) return TRIAGE_COPY.thingNotice;
  if (/\bfyi\b|heads.?up|for your info/.test(r)) return TRIAGE_COPY.thingFyi;
  if (/pleasantr|closing|sign.?off|have a (?:great|good)|talk soon/.test(r)) return TRIAGE_COPY.thingClosing;
  return TRIAGE_COPY.thingMessage;
}

export function closedLine(name: string, reason: string, verdict: TriageVerdict): string {
  const who = noClean(name) || 'someone';
  return TRIAGE_COPY.closed(who, closedThing(reason, verdict), verdict === 'meeting_set');
}

export interface OpenAskLite {
  id: string;
}

type Tx = Prisma.TransactionClient;

/** The open, non-urgent asks on a thread (the ones a close dismisses). */
export async function openAsksOf(tx: Tx, account: string, threadId: string): Promise<OpenAskLite[]> {
  return tx.emailAsk.findMany({
    where: { account, state: 'open', is_urgent: false, OR: [{ thread_id: threadId }, { thread_id: null, message_id: threadId }] },
    select: { id: true },
  });
}

/** Mark exactly these asks "No reply needed" (state dismissed), clearing the draft marker as every leave from open does. Returns the ids changed. */
export async function dismissAsks(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.emailAsk.findMany({ where: { id: { in: [...ids] }, state: 'open' }, select: { id: true } });
  const live = rows.map((r) => r.id);
  if (live.length === 0) return [];
  await tx.emailAsk.updateMany({ where: { id: { in: live }, state: 'open' }, data: { state: 'dismissed', draft_started_at: null, draft_url: null } });
  return live;
}

/** What a close stores so Undo can put exactly those asks back. */
export interface TriageCloseRecord {
  thread_key: string;
  ask_ids: string[];
}

export function readCloseRecord(v: unknown): TriageCloseRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = (v as { triage_close?: unknown }).triage_close;
  if (!rec || typeof rec !== 'object') return null;
  const r = rec as { thread_key?: unknown; ask_ids?: unknown };
  if (typeof r.thread_key !== 'string' || !Array.isArray(r.ask_ids)) return null;
  return { thread_key: r.thread_key, ask_ids: r.ask_ids.filter((x): x is string => typeof x === 'string') };
}

export const undoUntilFrom = (now: Date): Date => new Date(now.getTime() + UNDO_MS);

/**
 * Undo of a close: reopen exactly the asks it dismissed (only those still dismissed), then hold the thread from auto closing for
 * 30 days. The thread's verdict is kept as a medium no_reply so it sits in "Probably no reply needed" with its buttons.
 */
export async function undoClose(tx: Tx, userId: string, rec: TriageCloseRecord, now: Date): Promise<number> {
  let reopened = 0;
  if (rec.ask_ids.length > 0) {
    const r = await tx.emailAsk.updateMany({ where: { id: { in: rec.ask_ids }, state: 'dismissed' }, data: { state: 'open' } });
    reopened = r.count;
  }
  const hold = new Date(now.getTime() + HOLD_MS);
  await tx.homeOwedThread.upsert({
    where: { user_id_thread_key: { user_id: userId, thread_key: rec.thread_key } },
    create: { user_id: userId, thread_key: rec.thread_key, triage_hold_until: hold },
    update: { triage_hold_until: hold, triage_confidence: 'medium' },
  });
  return reopened;
}

// ============================================================================
// His own taps: Close it, I'll reply
// ============================================================================

import type { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { appendHomeAction } from '../state';
import { parseItemKey } from '../item-key';
import type { HomeActResponse } from '../types';

const GONE = 'That thread is not waiting on a reply any more.';

/** Close it: every open ask on the thread goes to No reply needed, with Undo for 72 hours (Undo reopens exactly those asks and holds the thread). */
export async function runTriageClose(db: PrismaClient, userId: string, itemKey: string, now: Date): Promise<HomeActResponse> {
  const parsed = parseItemKey(itemKey);
  if (!parsed || parsed.kind !== 'thread') throw new ApiError('That is not an email thread.', 404, 'not_found');
  return db.$transaction(async (tx) => {
    const ids = await dismissAsks(tx, (await openAsksOf(tx, parsed.account, parsed.thread_id)).map((a) => a.id));
    if (ids.length === 0) throw new ApiError(GONE, 404, 'not_found');
    const undo = undoUntilFrom(now);
    const row = await appendHomeAction(tx, userId, {
      item_key: itemKey,
      action: TRIAGE_ACTION,
      before: { triage_close: { thread_key: itemKey, ask_ids: ids } },
      after: { line: TRIAGE_COPY.closedToast },
      undo_until: undo,
    });
    return { ok: true as const, action_id: row.id, undo_until: undo.toISOString(), item_key: itemKey, message: TRIAGE_COPY.closedToast };
  });
}

/** I'll reply / Just reply: the thread is owed, whatever Bast's verdict was. Writes only his own owed row. */
export async function runTriageReply(db: PrismaClient, userId: string, itemKey: string, now: Date): Promise<HomeActResponse> {
  const parsed = parseItemKey(itemKey);
  if (!parsed || parsed.kind !== 'thread') throw new ApiError('That is not an email thread.', 404, 'not_found');
  return db.$transaction(async (tx) => {
    const newest = await tx.emailAsk.findFirst({
      where: { account: parsed.account, state: 'open', is_urgent: false, OR: [{ thread_id: parsed.thread_id }, { thread_id: null, message_id: parsed.thread_id }] },
      orderBy: { received_at: 'desc' },
      select: { id: true },
    });
    if (!newest) throw new ApiError(GONE, 404, 'not_found');
    const data = { triage: 'reply', triage_confidence: 'high', triage_reason: TRIAGE_COPY.mikeReply, triage_for_ask_id: newest.id, triaged_at: now };
    await tx.homeOwedThread.upsert({
      where: { user_id_thread_key: { user_id: userId, thread_key: itemKey } },
      create: { user_id: userId, thread_key: itemKey, ...data },
      update: data,
    });
    const row = await appendHomeAction(tx, userId, { item_key: itemKey, action: 'triage_reply', after: { line: TRIAGE_COPY.replyToast }, undo_until: null });
    return { ok: true as const, action_id: row.id, undo_until: null, item_key: itemKey, message: TRIAGE_COPY.replyToast };
  });
}
