import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { runApproveSweep } from '@/lib/home/keeper/approve-sweep';

const emptyBody = z.object({}).strict();

/**
 * GET /api/bast-chat/worker/home-keeper/approve-sweep: the approval sweep as a dry run. Writes nothing.
 * 200 `{dry_run: true, approved: [{task_id, title, project, finished_at}], raced: 0, skipped, line}`: the full list of
 * tasks it would approve.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    return chatJson(await runApproveSweep(prisma, ownerId, new Date(), { dryRun: true }));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/home-keeper/approve-sweep: the real run, strict empty body `{}`.
 * 200 `{dry_run: false, approved, raced, skipped, line}`. Sets approved on each qualifying task and logs it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    await chatWorkerBody(request, emptyBody, 1024);
    const ownerId = await workerOwnerId();
    return chatJson(await runApproveSweep(prisma, ownerId, new Date(), { dryRun: false }));
  } catch (error) {
    return chatError(error);
  }
}
