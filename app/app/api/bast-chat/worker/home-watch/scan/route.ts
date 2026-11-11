import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { ownerOnHome } from '@/lib/home/keeper/run';
import { scanBodySchema, SCAN_BODY_BYTES } from '@/lib/home/emergency/scan';
import { recordScan } from '@/lib/home/emergency/scan-store';

/**
 * POST /api/bast-chat/worker/home-watch/scan: the machine's outside scan result for a site a home-watch run handed it.
 * Body at most 16 KB, strict: `{key, summary, findings}`. `summary` is plain text, one paragraph, at most 500 characters, no
 * em or en dash, never the words priority, priorities or overdue, no URL (a bare hostname is fine); anything else is 400.
 * Slack and markup characters are neutralised before it is stored. `findings` is a JSON object of at most 8 KB, stored as scan_json.
 * A result for a key that was not requested (or already answered, or older than a day) is ignored.
 * 200 `{recorded: boolean}`; `{recorded: false, skipped: "home_off"}` when the owner is not an active admin on the home view.
 * Writes only the owner's home_emergency_watch row and, for a site that answered again, one keeper line. Sends and requests nothing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, scanBodySchema, SCAN_BODY_BYTES);
    const ownerId = await workerOwnerId();
    const { ok, timezone } = await ownerOnHome(prisma, ownerId);
    if (!ok) return chatJson({ recorded: false, skipped: 'home_off' });
    return chatJson(await recordScan(prisma, ownerId, body, new Date(), timezone));
  } catch (error) {
    return chatError(error);
  }
}
