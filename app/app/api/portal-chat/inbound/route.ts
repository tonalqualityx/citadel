import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { ingestEmailReply, inboundSchema } from '@/lib/portal/chat/inbound';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

// POST /api/portal-chat/inbound (portal phase C, slice C4; bot)
// A parsed email reply for a chat. Verifies the sender against the conversation's people, stores the
// client's words (idempotent on the RFC Message-ID), and queues a chat_email_reply job.
export async function POST(request: NextRequest) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = inboundSchema.parse(await request.json());
    const out = await ingestEmailReply(body);
    return NextResponse.json(out, { status: out.status === 'ingested' ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
