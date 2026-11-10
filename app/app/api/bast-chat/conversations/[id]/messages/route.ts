import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { appendMikeMessage, ownedConversation } from '@/lib/bast-chat/events';
import { resolveCardContext } from '@/lib/bast-chat/card-context';
import { prisma } from '@/lib/db/prisma';
import { chatError, chatJson, ownerJsonBody, ownerPostGuard } from '@/lib/bast-chat/route-helpers';

// Length rules (1 to 4,000 characters, client_ref 1 to 64) live in appendMikeMessage, which answers in plain sentences.
const bodySchema = z.object({ client_ref: z.string(), text: z.string(), context: z.unknown().optional() }).strict();

/** POST /api/bast-chat/conversations/:id/messages: 201 {seq}, 200 {seq} on a repeat client_ref, 429 on a daily cap. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { auth, settings } = await requireChatOwner();
    const refused = ownerPostGuard(request);
    if (refused) return refused;
    const { id } = await params;
    const conv = await ownedConversation(id, auth.userId, prisma);
    const body = await ownerJsonBody(request, bodySchema);
    const context = await resolveCardContext(body.context);
    const r = await appendMikeMessage({ conversationId: conv.id, ownerId: auth.userId, text: body.text, context, clientRef: body.client_ref, settings });
    return chatJson({ seq: r.seq }, r.duplicate ? 200 : 201);
  } catch (error) {
    return chatError(error);
  }
}
