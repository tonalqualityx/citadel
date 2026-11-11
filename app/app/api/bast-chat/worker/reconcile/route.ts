import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { loadContext } from '@/lib/home/reconcile/load';
import { RECONCILE_MAX_BYTES, reconcileBodySchema } from '@/lib/home/reconcile/schema';
import { saveReconcile } from '@/lib/home/reconcile/store';

/**
 * GET /api/bast-chat/worker/reconcile (Slice 9a, the sent-mail reconciler): the context the machine job starts from. Writes nothing.
 * 200 `{owner_ok, on, auto: false, caps: {notes_left, cards_left}, processed: [message_key], holds: [target_key],
 * bast_draft_hashes: [sha256], lookback_done}`, or `{skipped: "home_off", owner_ok: false, on: false}`. Takes no user id.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    return chatJson(await loadContext(prisma, ownerId, new Date()));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/reconcile: strict body `{dry: boolean, messages: [{message_key, account, gmail_id, thread_id, thread_root,
 * sent_at, to_label, subject, lookback, bast_words, new_part, quoted_part_hash, filter: {model, cost_usd}, match: {model, cost_usd} | null,
 * outcome: "nothing" | "actions", actions: [...]}]}`, at most 10 messages, at most 128 KB. The end of the look-back is
 * `{dry: false, lookback_end: true, messages: []}`.
 *
 * Every validation runs under `dry: true` too, with identical decisions, and writes nothing. A real POST writes, in one transaction per
 * message: the message row (a second POST of the same message_key answers `already` and writes nothing), the internal notes on his own
 * tasks (each with a Handled line), and the cards. It never changes a task's status, never creates a time entry, project or task, and
 * sends no email.
 * 200 `{messages: [{message_key, outcome, decisions: [{i, result: "noted" | "carded" | "nothing" | "refused", reason?}]}]}`; a look-back
 * end answers `{lookback_end: "set" | "would_set" | "already", messages: []}`; or `{skipped: "home_off" | "reconcile_off", messages: []}`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, reconcileBodySchema, RECONCILE_MAX_BYTES);
    const ownerId = await workerOwnerId();
    return chatJson(await saveReconcile(prisma, ownerId, body, new Date()));
  } catch (error) {
    return chatError(error);
  }
}
