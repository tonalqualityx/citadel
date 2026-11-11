import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson } from '@/lib/bast-chat/route-helpers';
import { decisionReplayBodySchema, planReplay } from '@/lib/work/intake';

/**
 * POST /api/bast-chat/worker/decision-replay (Work stage B): what each replayed intake decision WOULD change. Chat key. Writes nothing.
 * Body (strict, at most 500 items, at most 256 KB): `{items: [{ask_id, disposition, reason}]}`.
 * Uses the same function as apply-decisions, so the answer is what the real run would do.
 * 200 `{counts: {total, would_close, would_set, left, refused, by_disposition}, rows: [{ask_id, verdict, disposition, why, now, subject}]}`.
 */
const BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, decisionReplayBodySchema, BODY_BYTES);
    return chatJson(await planReplay(prisma, body.items));
  } catch (error) {
    return chatError(error);
  }
}
