import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, ownerToday, workerOwnerId } from '@/lib/bast-chat/route-helpers';

/** GET /api/bast-chat/worker/today: the owner's Today, trimmed (no scores). Takes no user id. */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    return chatJson(await ownerToday(await workerOwnerId(), new Date(), prisma));
  } catch (error) {
    return chatError(error);
  }
}
