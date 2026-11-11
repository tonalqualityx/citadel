import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { listSummaryWork, saveSummaries } from '@/lib/home/keeper/summaries';
import { SUMMARY } from '@/lib/home/rules';

const postBody = z
  .object({
    items: z
      .array(
        z
          .object({
            item_key: z.string().min(1).max(300),
            hash: z.string().regex(/^[0-9a-f]{64}$/),
            summary: z.string().max(2000),
            done_when: z.array(z.string().max(500)).max(30).optional(),
          })
          .strict(),
      )
      .max(SUMMARY.perRun),
  })
  .strict();

/**
 * GET /api/bast-chat/worker/home-keeper/summaries?limit=40: the owner's long cards that still need a short version.
 * 200 `{items: [{item_key, task_id, title, text, hash, has_checklist}]}` (in view first, then by rank, at most 40;
 * `limit` only lowers that), or `{items: [], skipped: "home_off"}`. Writes nothing. Takes no user id.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    const raw = Number(new URL(request.url).searchParams.get('limit') ?? SUMMARY.perRun);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(SUMMARY.perRun, Math.floor(raw)) : SUMMARY.perRun;
    return chatJson(await listSummaryWork(prisma, ownerId, new Date(), limit));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/home-keeper/summaries: strict body `{items: [{item_key, hash, summary, done_when?}]}`, at
 * most 40. 200 `{dry_run: false, saved, refused: [{item_key, reason}], skipped: [{item_key, reason}], action_id, line}`;
 * refused reasons are empty, too_long, dash, banned_word, bad_done_when; skipped reasons are duplicate, not_found,
 * not_long, stale_hash, held, unchanged, changed. Valid items are saved even when others are refused.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, postBody, 512 * 1024);
    const ownerId = await workerOwnerId();
    return chatJson(await saveSummaries(prisma, ownerId, new Date(), body.items));
  } catch (error) {
    return chatError(error);
  }
}
