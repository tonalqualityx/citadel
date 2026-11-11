import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { listOwedWork, saveOwedResults, type OwedResultItem } from '@/lib/home/owed/store';
import { OWED } from '@/lib/home/owed/copy';
import { itemKeySchema } from '@/lib/home/item-key';

/** The most items one POST carries. */
export const OWED_POST_MAX_ITEMS = 10;
/** Body cap for the POST. */
export const OWED_POST_MAX_BYTES = 64 * 1024;

const base = { thread_key: itemKeySchema, newest_ask_id: z.string().uuid() };
const model = z.string().min(1).max(20);
const cost = z.number().min(0).max(100).optional();

const item = z.discriminatedUnion('outcome', [
  z.object({ ...base, outcome: z.literal('drafted'), draft_id: z.string().min(1).max(64), draft_message_id: z.string().min(1).max(64), draft_text: z.string().min(1).max(8000), model, cost_usd: cost }).strict(),
  z
    .object({
      ...base,
      outcome: z.literal('needs_thought'),
      read: z.string().min(1).max(2000),
      suggested_answer: z.string().max(2000).nullable(),
      needs_commitment: z.boolean(),
      model,
      cost_usd: cost,
    })
    .strict(),
  z.object({ ...base, outcome: z.literal('mike_edited') }).strict(),
  z.object({ ...base, outcome: z.literal('failed'), error: z.string().max(2000) }).strict(),
]);

const postBody = z.object({ items: z.array(item).max(OWED_POST_MAX_ITEMS) }).strict();

/**
 * GET /api/bast-chat/worker/owed?limit=6: the owner's drafting queue, in order (taps first, then redrafts, leads, the
 * oldest thread). Also the machine's dry run. Writes nothing. 200 `{items: [{thread_key, account, thread_id, ask_ids,
 * newest: {ask_id, gmail_id, from_email, from_name, subject, received_at, intent}, client_name, lead, request,
 * suggested_answer, bast_draft: {draft_id, draft_hash, for_ask_id} | null}]}` or `{skipped: "home_off", items: []}`.
 * `limit` only lowers the 6. Takes no user id.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    const raw = Number(new URL(request.url).searchParams.get('limit') ?? OWED.perRun);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(OWED.perRun, Math.floor(raw)) : OWED.perRun;
    return chatJson(await listOwedWork(prisma, ownerId, new Date(), limit));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/owed: strict body `{items: [...]}`, at most 10, at most 64 KB. Each item is
 * `{thread_key, newest_ask_id, outcome: "drafted", draft_id, draft_message_id, draft_text, model, cost_usd?}`,
 * `{..., outcome: "needs_thought", read, suggested_answer | null, needs_commitment, model, cost_usd?}`,
 * `{..., outcome: "mike_edited"}` or `{..., outcome: "failed", error}`. The commitment checks run again here.
 * 200 `{saved: [{thread_key, outcome}], refused: [{thread_key, reason, status?}], action_id, line}` (a stale newest ask is
 * refused with status 409, reason "stale", and nothing is written for it), or `{skipped: "home_off", saved: [], refused: []}`.
 * Writes only the owner's home_owed_thread, home_keeper_runs (kind owed_reply) and home_actions (source keeper) rows.
 * Never an email ask, task or outbox row, and nothing is sent.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, postBody, OWED_POST_MAX_BYTES);
    const ownerId = await workerOwnerId();
    return chatJson(await saveOwedResults(prisma, ownerId, body.items as OwedResultItem[], new Date()));
  } catch (error) {
    return chatError(error);
  }
}
