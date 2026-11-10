import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { listConversations, startConversation } from '@/lib/bast-chat/events';
import { chatError, chatJson, ownerJsonBody, ownerPostGuard } from '@/lib/bast-chat/route-helpers';

const emptyBody = z.object({}).strict();

/** GET /api/bast-chat/conversations: the last 20 conversations. */
export async function GET(): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwner();
    const rows = await listConversations(auth.userId, 20);
    return chatJson({
      conversations: rows.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        last_message_at: c.last_message_at ? c.last_message_at.toISOString() : null,
        created_at: c.created_at.toISOString(),
      })),
    });
  } catch (error) {
    return chatError(error);
  }
}

/** POST /api/bast-chat/conversations {}: start a new conversation (the open one is closed, kept). 201 {id}. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwner();
    const refused = ownerPostGuard(request);
    if (refused) return refused;
    await ownerJsonBody(request, emptyBody);
    return chatJson(await startConversation(auth.userId), 201);
  } catch (error) {
    return chatError(error);
  }
}
