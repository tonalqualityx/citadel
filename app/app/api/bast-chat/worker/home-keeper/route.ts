import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { runKeeper } from '@/lib/home/keeper/run';
import type { KeeperResult } from '@/lib/home/types';

/** The most changes a response lists (counts and lines always cover all of them). */
export const KEEPER_LIST_CAP = 50;

const emptyBody = z.object({}).strict();

function trimmed(r: KeeperResult): KeeperResult {
  if (!r.plan) return r;
  return { ...r, plan: { ...r.plan, stagger: r.plan.stagger.slice(0, KEEPER_LIST_CAP), dates: r.plan.dates.slice(0, KEEPER_LIST_CAP) } };
}

/**
 * GET /api/bast-chat/worker/home-keeper: the nightly sort as a dry run for the configured owner. Writes nothing.
 * 200 `{dry_run: true, plan: {owner_id, date, stagger, dates, lines, counts}, action_ids: []}` with the first 50 changes
 * of each list, or `{dry_run: true, skipped: "home_off", action_ids: []}` when the owner is not an active admin on the
 * home view. Takes no user id. Also `arcs: {switches, would_make, would_close}`: the arcs the keeper would make or
 * close, shown whatever the switches say (the arc writes themselves stay off until they are switched on).
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    return chatJson(trimmed(await runKeeper(prisma, ownerId, new Date(), { dryRun: true })));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/home-keeper: the real nightly run, strict empty body `{}`. Once per zoned day.
 * 200 `{dry_run: false, plan, action_ids}` (what was written), `{dry_run: false, already_ran: true, action_ids: []}`
 * (this day already has a nightly row; nothing written) or `{dry_run: false, skipped: "home_off", action_ids: []}`.
 * It writes only the owner's home_item_state, home_actions (source keeper) and home_keeper_runs rows, plus (Slice 2c,
 * each behind its own switch in home_keeper_settings) Arc rows and Task.arc_id on his own tasks; `arcs_written` is
 * present only when one of those switches is on.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    await chatWorkerBody(request, emptyBody, 1024);
    const ownerId = await workerOwnerId();
    return chatJson(trimmed(await runKeeper(prisma, ownerId, new Date(), { dryRun: false })));
  } catch (error) {
    return chatError(error);
  }
}
