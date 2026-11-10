import { NextRequest, NextResponse } from 'next/server';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { undoSince, undoSinceSchema } from '@/lib/bast-chat/actions';
import { chatError, chatJson, ownerJsonBody, ownerPostGuard } from '@/lib/bast-chat/route-helpers';

/**
 * POST /api/bast-chat/actions/undo-since {since} or {from_action_id}: "Undo everything since", Mike's remedy if the
 * chat is ever misled. Runs in Citadel under the owner's session only (same access check as the other action
 * routes), never the worker's key. Walks the chat's applied changes at or after the point, newest first, each
 * through the normal Undo with all its checks, and stops at the first that cannot be undone.
 * 200 {undone, proposed, stopped, left, waiting}. 400 for a body that names neither or both.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwner();
    const refused = ownerPostGuard(request);
    if (refused) return refused;
    const body = await ownerJsonBody(request, undoSinceSchema);
    return chatJson(await undoSince(auth.userId, body));
  } catch (error) {
    return chatError(error);
  }
}
