import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { runLearn } from '@/lib/home/learn/run';

const emptyBody = z.object({}).strict();

/**
 * GET /api/bast-chat/worker/home-keeper/learn: the learn step as a dry run for the configured owner. Writes nothing.
 * 200 `{dry_run: true, date, monday, daily: {date, open_items, past_day, owed}, week, lines: [{action, line, details}],
 * action_ids: []}`, where `week` is null except on his Monday, or `{dry_run: true, skipped: "home_off", action_ids: []}`
 * when the owner is not an active admin on the home view. Takes no user id.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    return chatJson(await runLearn(prisma, ownerId, new Date(), { dryRun: true }));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/home-keeper/learn: the real run, strict empty body `{}`. Once per zoned day.
 * 200 `{dry_run: false, date, monday, daily, week, lines, action_ids}` (what was written), `{dry_run: false,
 * already_ran: true, action_ids: []}` or `{dry_run: false, skipped: "home_off", action_ids: []}`. It writes only the
 * owner's home_measures, home_keeper_runs (kind learn) and home_actions (source keeper, keeper_measures and keeper_guard,
 * no Undo) rows. It changes no ranking, task, email ask, wait or project.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    await chatWorkerBody(request, emptyBody, 1024);
    const ownerId = await workerOwnerId();
    return chatJson(await runLearn(prisma, ownerId, new Date(), { dryRun: false }));
  } catch (error) {
    return chatError(error);
  }
}
