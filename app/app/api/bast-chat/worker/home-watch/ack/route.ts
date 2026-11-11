import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { ackBodySchema, ackLines } from '@/lib/home/emergency/slack-store';

const ACK_BODY_BYTES = 8 * 1024;

/**
 * POST /api/bast-chat/worker/home-watch/ack: the machine says which Slack lines it posted. Body `{ids: [string]}`, 1 to 20 ids
 * from the `lines` a home-watch POST returned (`<row id>:<kind>`); strict. Marks those lines posted so they are never offered
 * again. An id that is unknown, malformed or not the owner's changes nothing. Writes only the owner's home_emergency_watch rows.
 * 200 `{acked, ignored}`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, ackBodySchema, ACK_BODY_BYTES);
    const ownerId = await workerOwnerId();
    return chatJson(await ackLines(prisma, ownerId, body.ids, new Date()));
  } catch (error) {
    return chatError(error);
  }
}
