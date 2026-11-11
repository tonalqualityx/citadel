import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson } from '@/lib/bast-chat/route-helpers';
import { FINISHED_BODY_BYTES, finishedBodySchema, runSweep } from '@/lib/work/finished-store';

/**
 * POST /api/bast-chat/worker/finished (Work stage G): the one-time "looks finished" sweep, for the configured owner.
 * Body (strict, at most 1 MB): `{dry: boolean, machine_evidence: [{task_id, kind: "worker_done"|"commit", ref, at}]}`.
 * `dry: true` counts per group and strength, with 10 sample titles, and writes nothing.
 * Without `dry` it makes the owner's looks-finished rows once; while open rows exist it answers `already_open` and writes nothing.
 * The sweep never closes, changes or comments on a task and sends nothing. Closing is the owner's tap on the home screen.
 * 200 `{dry, total, counts, others, sample, created, run_key}` or `{..., skipped: "home_off"}` or `{..., already_open: true}`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, finishedBodySchema, FINISHED_BODY_BYTES);
    return chatJson(await runSweep(prisma, body, new Date()));
  } catch (error) {
    return chatError(error);
  }
}
