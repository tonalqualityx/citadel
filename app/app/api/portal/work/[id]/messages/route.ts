import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { loadThread, MESSAGE_MAX_CHARS, postClientMessage } from '@/lib/portal/thread';

const bodySchema = z.object({
  client_ref: z.string().uuid(),
  text: z.string().min(1).max(MESSAGE_MAX_CHARS),
});

const idOr404 = (id: string) => {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError('Not found', 404);
};

// GET /api/portal/work/:id/messages?after=<iso> (portal phase B slice 2)
// The conversation on a request, oldest first: the client's own messages and the staff replies
// shared with them. Anything else on the task stays out (see lib/portal/thread.ts). 404 for work
// the contact may not see. The work page polls this every 30 seconds with ?after=.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimit(request, 120);
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
// grant-only contacts included. 20 messages per 10 minutes and 200 a day per person (counted in
// the database); past that, 429 with the plain-words limit message.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const posted = await postClientMessage(access, contact, id, body);
    return NextResponse.json({ message: posted.message }, { status: posted.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
