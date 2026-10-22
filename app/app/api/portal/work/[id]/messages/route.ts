import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { portalReadRateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadThread, MESSAGE_MAX_CHARS, postClientMessage, toThreadMessage } from '@/lib/portal/thread';
import { ensureConversation, postChatMessage } from '@/lib/portal/chat/post-message';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

const bodySchema = z.object({
  client_ref: z.string().uuid(),
  text: z.string().max(MESSAGE_MAX_CHARS).default(''),
  // Files staged on this task before the conversation existed (POST /api/portal/uploads with task_id).
  attachment_ids: z.array(z.string().uuid()).max(10).default([]),
}).refine((b) => b.text.trim().length > 0 || b.attachment_ids.length > 0, { message: 'A message needs words or a file.', path: ['text'] });

const idOr404 = (id: string) => {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError('Not found', 404);
};

// GET /api/portal/work/:id/messages?after=<iso> (portal phase B slice 2)
// The conversation on a request, oldest first: the client's own messages and the staff replies
// shared with them. Anything else on the task stays out (see lib/portal/thread.ts). 404 for work
// the contact may not see. The work page polls this every 30 seconds with ?after=.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = portalReadRateLimit(request);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { id } = await params;
    idOr404(id);
    const afterRaw = new URL(request.url).searchParams.get('after');
    const after = afterRaw && !Number.isNaN(Date.parse(afterRaw)) ? new Date(afterRaw) : null;
    const messages = await loadThread(access, id, { after });
    if (!messages) throw new ApiError('Not found', 404);
    return NextResponse.json({ messages });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/portal/work/:id/messages { client_ref, text }
// The client writes in the thread. 201 with the message when new, 200 with the same message when
// client_ref was already sent (a double send changes nothing). Any client role may write,
// grant-only contacts included. 120 messages an hour and 200 a day per person (counted in
// the database); past that, 429 with the plain-words limit message.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const { id } = await params;
    idOr404(id);
    const body = bodySchema.parse(await request.json());
    const contact = await prisma.clientContact.findFirst({
      where: { id: access.contactId, is_deleted: false },
      select: { id: true, name: true },
    });
    if (!contact) throw new ApiError('Not found', 404);
    // Portal phase C: a task with a conversation (or one chat is available for) goes through the chat,
    // which opens the conversation lazily on the first client message and queues the reply job.
    const conversationId = await ensureConversation(access, id);
    if (conversationId) {
      const chat = await postChatMessage(access, contact, conversationId, { client_ref: body.client_ref, text: body.text, attachment_ids: body.attachment_ids });
      const row = await prisma.comment.findUnique({
        where: { id: chat.comment_id },
        select: { id: true, content: true, created_at: true, author_contact_id: true, author_contact: { select: { name: true } } },
      });
      if (!row) throw new ApiError('Not found', 404);
      const ids = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];
      return NextResponse.json({ message: toThreadMessage(row, ids) }, { status: chat.created ? 201 : 200 });
    }
    // The phase B thread (no chat) takes words only.
    if (body.text.trim().length === 0) throw new ApiError('Messages are 1 to 4000 characters.', 400, 'bad_message');
    const posted = await postClientMessage(access, contact, id, { client_ref: body.client_ref, text: body.text });
    return NextResponse.json({ message: posted.message }, { status: posted.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
