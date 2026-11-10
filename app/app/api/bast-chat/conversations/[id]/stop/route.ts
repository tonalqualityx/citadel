import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { ownedConversation, requestStop } from '@/lib/bast-chat/events';
import { prisma } from '@/lib/db/prisma';
import { chatError, chatJson, ownerJsonBody, ownerPostGuard } from '@/lib/bast-chat/route-helpers';

const emptyBody = z.object({}).strict();

/** POST /api/bast-chat/conversations/:id/stop {}: queue a stop for the running turn. 200 {queued}. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwner();
    const refused = ownerPostGuard(request);
    if (refused) return refused;
    const { id } = await params;
    const conv = await ownedConversation(id, auth.userId, prisma);
    await ownerJsonBody(request, emptyBody);
    return chatJson(await requestStop(conv.id, auth.userId));
  } catch (error) {
    return chatError(error);
  }
}
