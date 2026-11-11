import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { applyWatch, watchBodySchema, watchPlan, WATCH_BODY_BYTES } from '@/lib/home/emergency/store';

/**
 * GET /api/bast-chat/worker/home-watch: what the second check should look at, as a dry run for the configured owner.
 * Writes nothing. 200 `{dry_run: true, checks: [{key, site_id, domain}], open: [{key, site_id, domain, source,
 * started_at, last_checked_at, last_check_up, ask_ids}], would_post: [{id, kind: "first"|"again"|"lifeline", text}]}` or `{dry_run: true, skipped: "home_off", checks: [], open: []}`
 * when the owner is not an active admin on the home view. `checks` holds only hosts of Sites of active clients; no
 * domain from mail text is ever listed. Takes no user id.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    return chatJson(await watchPlan(prisma, ownerId, new Date()));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/home-watch: the report of one run, body at most 64 KB:
 * `{kuma: [{monitor, domain, client_id?, started, escalated?}] | null, checks: [{key, up, summary?, checked_at}], caps?: ["slack"]}`.
 * `kuma: null` means the watchdog's state could not be read, and nothing is closed. Opens, updates and closes the
 * owner's home_site_incident rows and writes the owner's "answers again" lines.
 * Slice 6b: every run also tracks what is in the owner's Needs you now. `lines` is `[{id, kind, text}]` (at most 6, each marked
 * claimed now) only when the owner's emergency_slack switch is on AND the body carries `caps: ["slack"]`; otherwise `[]` and
 * nothing is claimed (the 6a machine script sends no caps). The machine posts them and acknowledges through
 * POST /api/bast-chat/worker/home-watch/ack.
 * 200 `{lines, counts: {opened, updated, closed, ignored}}` or `{lines: [], skipped: "home_off", counts}`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, watchBodySchema, WATCH_BODY_BYTES);
    const ownerId = await workerOwnerId();
    return chatJson(await applyWatch(prisma, ownerId, body, new Date()));
  } catch (error) {
    return chatError(error);
  }
}
