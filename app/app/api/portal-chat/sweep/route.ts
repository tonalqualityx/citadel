import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { runSweep } from '@/lib/portal/chat/sweep';

// POST /api/portal-chat/sweep (portal phase C, slice C4; bot)
// The runner calls this every 60 seconds. Sends the away email for conversations that went quiet
// (one per question, never a reminder), the staff-reply email when the client is away, catches
// stalls, and closes answered question chats. Idempotent.
export async function POST() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    return NextResponse.json(await runSweep());
  } catch (error) {
    return handleApiError(error);
  }
}
