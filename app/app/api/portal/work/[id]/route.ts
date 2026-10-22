import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { portalReadRateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { prisma } from '@/lib/db/prisma';
import { loadWorkItem } from '@/lib/portal/requests';
import { chatAvailability } from '@/lib/portal/chat/switches';

// GET /api/portal/work/:id (portal phase B slice 1)
// One client-visible task in client words: title, state, engagement, the intake answers, and the
// staged preview when it is waiting on the client. 404 for anything the contact may not see, the
// same answer as "missing", so ids cannot be probed. Allow-list only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = portalReadRateLimit(request);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Not found', 404);
    const item = await loadWorkItem(access, id);
    if (!item) throw new ApiError('Not found', 404);
    // Portal phase C: whether the conversation on this request is the chat. `conversation_id` is set
    // once it is open; `available` says it opens on the next message (the page keeps the phase B thread otherwise).
    const convo = await prisma.chatConversation.findUnique({ where: { task_id: id }, select: { id: true, client_id: true } });
    let chat: { conversation_id: string | null; available: boolean } = { conversation_id: null, available: false };
    if (convo && convo.client_id === access.clientId) chat = { conversation_id: convo.id, available: true };
    else if (!convo) {
      const task = await prisma.task.findUnique({ where: { id }, select: { site_id: true } });
      const avail = await chatAvailability({ contactId: access.contactId, clientId: access.clientId, siteId: task?.site_id ?? null });
      chat = { conversation_id: null, available: avail.available };
    }
    return NextResponse.json({ work: item, chat });
  } catch (error) {
    return handleApiError(error);
  }
}
