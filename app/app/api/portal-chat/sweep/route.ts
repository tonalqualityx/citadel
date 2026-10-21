import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { runSweep } from '@/lib/portal/chat/sweep';

// POST /api/portal-chat/sweep (portal phase C, slice C4; bot)
// The runner calls this every 60 seconds. Sends the away email for conversations that went quiet
// (one per question, never a reminder), the staff-reply email when the client is away, catches
// stalls, and closes answered question chats. Idempotent.
const bodySchema = z.object({ conversation_ids: z.array(z.string().uuid()).max(200).optional(), created_after: z.string().datetime().optional() }).strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    // The cron call sends no body and sweeps everything; a scoped body limits the pass to those conversations.
    const text = await request.text();
    const body = text.trim() ? bodySchema.parse(JSON.parse(text)) : {};
    const scope = body.conversation_ids || body.created_after ? { conversationIds: body.conversation_ids, createdAfter: body.created_after ? new Date(body.created_after) : undefined } : undefined;
    return NextResponse.json(await runSweep(new Date(), scope));
  } catch (error) {
    return handleApiError(error);
  }
}
