import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { MESSAGE_MAX_CHARS } from '@/lib/portal/thread';
import { postChatMessage } from '@/lib/portal/chat/post-message';

const bodySchema = z.object({
  client_ref: z.string().uuid(),
  text: z.string().max(MESSAGE_MAX_CHARS).nullish(),
  choice: z.object({ slot: z.string().min(1).max(20), id: z.string().min(1).max(64) }).nullish(),
  attachment_ids: z.array(z.string().uuid()).max(10).default([]),
});

// POST /api/portal/chat/:id/messages { client_ref, text?, choice?: { slot, id }, attachment_ids[] }
// The client writes or presses a choice. Saved first, verbatim; a choice is checked against the real
// options. 201 when new, 200 on a repeat of client_ref.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const body = bodySchema.parse(await request.json());
    const contact = await prisma.clientContact.findFirst({ where: { id: access.contactId, is_deleted: false }, select: { id: true, name: true } });
    if (!contact) throw new ApiError('Not found', 404);
    const posted = await postChatMessage(access, contact, id.data, body);
    return NextResponse.json({ comment_id: posted.comment_id, route: posted.route, urgent: posted.urgent ?? null }, { status: posted.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
