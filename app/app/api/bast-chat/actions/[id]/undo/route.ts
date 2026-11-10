import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { undoAction } from '@/lib/bast-chat/actions';
import { chatIdParam } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, ownerJsonBody, ownerPostGuard } from '@/lib/bast-chat/route-helpers';

const emptyBody = z.object({}).strict();

/**
 * POST /api/bast-chat/actions/:id/undo {}: runs in Citadel under the owner's session, never the worker's key.
 * 200 {action}. 409 with a plain sentence when it can no longer be done.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwner();
    const refused = ownerPostGuard(request);
    if (refused) return refused;
    const id = chatIdParam((await params).id);
    await ownerJsonBody(request, emptyBody);
    return chatJson({ action: await undoAction(id, auth.userId) });
  } catch (error) {
    return chatError(error);
  }
}
