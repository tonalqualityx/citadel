/**
 * Home Slice 4b: "Send the draft". This file is the ONE place an owed_reply outbox row is made (queueOwedReplySend), and
 * app/api/home/send/route.ts is the only importer of it. A grep test (lib/sends/__tests__/owed-send-door.test.ts) holds both.
 *
 * What a press does, in one transaction the route opens: it re-reads the switch, checks the draft is Bast's current draft
 * (or the short one) for the newest open mail, writes the home_actions row of the press (action send_draft, source home,
 * Undo until the hold ends) and queues the held outbox row. Nothing is sent here. The courier lane's sender claims the row
 * only after the 10 minutes, and the claim route checks the press again (lib/sends/owed-reply.ts).
 *
 * Undo (cancelOwedSend): compare and set on the row, only while it is unclaimed and unsent.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { queueInOutbox } from '@/lib/sends/outbox';
import { OWED_REPLY_KIND } from '@/lib/sends/govern';
import { OWED_HOLD_MS, OWED_SEND_ACTION, owedSwitchOn } from '@/lib/sends/owed-reply';
import { parseItemKey } from '../item-key';
import { SEND_COPY, sendingLine } from './send-copy';
import { appendHomeAction, getHomeAction, markHomeActionUndone, type HomeDb } from '../state';

export { OWED_SEND_ACTION, OWED_HOLD_MS };

export const sendBodySchema = z.object({ item_key: z.string().min(1).max(300), draft_id: z.string().min(1).max(64) }).strict();
export type SendBody = z.infer<typeof sendBodySchema>;

export interface SendResult {
  ok: true;
  action_id: string;
  send_after: string;
  item_key: string;
  message: string;
}

// ----------------------------------------------------------------------------
// The press
// ----------------------------------------------------------------------------

function cleanName(raw: string | null | undefined, email: string): string {
  const name = (raw ?? '').replace(/["<>]/g, '').trim();
  return name || email.split('@')[0] || 'them';
}

/**
 * Queue one held reply. `db` is the route's transaction. Throws ApiError: 409 send_off, 409 not_current, 409 already_queued,
 * 409 draft_blank, 404 not_found. Never sends.
 */
export async function queueOwedReplySend(db: Prisma.TransactionClient, userId: string, body: SendBody, now: Date, timezone = 'America/New_York'): Promise<SendResult> {
  // The switch first. A missing settings row is off.
  if (!(await owedSwitchOn(db, userId))) throw new ApiError(SEND_COPY.off, 409, 'send_off');

  const key = parseItemKey(body.item_key);
  if (!key || key.kind !== 'thread') throw new ApiError(SEND_COPY.noThread, 404, 'not_found');

  const asks = await db.emailAsk.findMany({
    where: { account: key.account, state: 'open', OR: [{ thread_id: key.thread_id }, { thread_id: null, message_id: key.thread_id }] },
    orderBy: { received_at: 'desc' },
    select: { id: true, from_email: true, from_name: true, subject: true },
    take: 50,
  });
  if (asks.length === 0) throw new ApiError(SEND_COPY.noThread, 404, 'not_found');
  const newest = asks[0];

  const row = await db.homeOwedThread.findUnique({
    where: { user_id_thread_key: { user_id: userId, thread_key: body.item_key } },
    select: {
      state: true, request_kind: true, draft_id: true, draft_text: true, draft_for_ask_id: true, mike_edited_at: true,
      short_draft_id: true, short_draft_text: true,
    },
  });
  if (!row || row.mike_edited_at || row.request_kind) throw new ApiError(SEND_COPY.notCurrent, 409, 'not_current');

  const fullCurrent = row.state === 'drafted' && row.draft_id === body.draft_id && !!row.draft_text && row.draft_for_ask_id === newest.id;
  // The short holding draft follows the same door: only while the full draft covers the newest mail, or there is none (needs thought).
  const shortCurrent =
    !!row.short_draft_id && row.short_draft_id === body.draft_id && !!row.short_draft_text &&
    ((row.state === 'drafted' && !!row.draft_id && row.draft_for_ask_id === newest.id) || row.state === 'needs_thought');
  if (!fullCurrent && !shortCurrent) throw new ApiError(SEND_COPY.notCurrent, 409, 'not_current');
  const text = (fullCurrent ? row.draft_text : row.short_draft_text) as string;
  if (text.includes('[[')) throw new ApiError(SEND_COPY.blank, 409, 'draft_blank');

  // A row for this draft that never went (superseded, or failing) is replaced; one still waiting or sent is not.
  const dedupe = `owed:${body.draft_id}`;
  const prior = await db.emailOutbox.findUnique({ where: { dedupe_key: dedupe }, select: { id: true, sent_at: true, superseded_at: true, attempts: true } });
  if (prior) {
    if (prior.sent_at || (!prior.superseded_at && prior.attempts === 0)) throw new ApiError(SEND_COPY.alreadyQueued, 409, 'already_queued');
    await db.emailOutbox.updateMany({
      where: { id: prior.id, sent_at: null },
      data: { dedupe_key: null, superseded_at: prior.superseded_at ?? now, superseded_reason: 'replaced' },
    });
  }

  const sendAfter = new Date(now.getTime() + OWED_HOLD_MS);
  const who = cleanName(newest.from_name, newest.from_email);
  const action = await appendHomeAction(db, userId, {
    item_key: body.item_key,
    action: OWED_SEND_ACTION,
    before: null,
    after: { draft_id: body.draft_id, short: shortCurrent && !fullCurrent, who, send_after: sendAfter.toISOString(), outbox_id: null },
    undo_until: sendAfter,
    source: 'home',
  });
  const subject = /^re:/i.test(newest.subject.trim()) ? newest.subject.trim() : `Re: ${newest.subject.trim()}`;
  const queued = await queueInOutbox(
    db,
    {
      kind: OWED_REPLY_KIND,
      to: newest.from_email,
      subject: subject.slice(0, 500),
      text,
      from_account: key.account,
      allow_external: true,
      dedupe_key: dedupe,
      send_after: sendAfter,
    },
    {
      intent: 'owed_reply',
      home_action_id: action.id,
      user_id: userId,
      ask_ids: asks.map((a) => a.id),
      account: key.account,
      thread_id: key.thread_id,
      draft_id: body.draft_id,
    },
  );
  await db.homeAction.update({
    where: { id: action.id },
    data: { after: { draft_id: body.draft_id, short: shortCurrent && !fullCurrent, who, send_after: sendAfter.toISOString(), outbox_id: queued.id } },
  });
  return { ok: true, action_id: action.id, send_after: sendAfter.toISOString(), item_key: body.item_key, message: sendingLine(who, sendAfter, timezone) };
}

// ----------------------------------------------------------------------------
// Undo
// ----------------------------------------------------------------------------

/**
 * Undo a press while the hold lasts: compare and set the action row, then the outbox row (only while unclaimed and unsent).
 * `db` is a transaction: a refusal throws, which rolls the first write back. Never touches Gmail.
 */
export async function cancelOwedSend(db: Prisma.TransactionClient, userId: string, actionId: string, now: Date): Promise<{ ok: true; action_id: string; item_key: string | null }> {
  const row = await getHomeAction(db, userId, actionId);
  if (!row || row.action !== OWED_SEND_ACTION) throw new ApiError('Not found', 404, 'not_found');
  if (row.undone_at) throw new ApiError('That was already undone.', 409, 'undo_used');
  if (!row.undo_until || row.undo_until.getTime() <= now.getTime()) throw new ApiError(SEND_COPY.tooLate, 409, 'undo_expired');
  const after = row.after && typeof row.after === 'object' && !Array.isArray(row.after) ? (row.after as Record<string, unknown>) : {};
  const outboxId = typeof after.outbox_id === 'string' ? after.outbox_id : null;
  if (!outboxId) throw new ApiError(SEND_COPY.tooLate, 409, 'undo_expired');

  if (!(await markHomeActionUndone(db as HomeDb, userId, actionId, now))) throw new ApiError('That was already undone.', 409, 'undo_used');
  const cancelled = await db.emailOutbox.updateMany({
    where: { id: outboxId, claimed_at: null, sent_at: null, superseded_at: null },
    data: { superseded_at: now, superseded_reason: 'cancelled_by_mike', last_error: 'superseded: cancelled_by_mike', dedupe_key: null },
  });
  if (cancelled.count !== 1) throw new ApiError(SEND_COPY.tooLate, 409, 'undo_expired');
  return { ok: true, action_id: actionId, item_key: row.item_key };
}
