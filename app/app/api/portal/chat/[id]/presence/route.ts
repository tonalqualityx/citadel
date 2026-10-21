import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { threadTaskWhere } from '@/lib/portal/thread';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

const bodySchema = z.object({ state: z.enum(['visible', 'typing', 'hidden']) });

// POST /api/portal/chat/:id/presence { state } (portal phase C)
// last_seen_at / last_typing_at / page_hidden_at, read by the walk-away sweep (slice C4).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const body = bodySchema.parse(await request.json());
    const convo = await prisma.chatConversation.findUnique({ where: { id: id.data }, select: { id: true, client_id: true, task_id: true } });
    if (!convo || convo.client_id !== access.clientId) throw new ApiError('Not found', 404);
    const ok = await prisma.task.findFirst({ where: threadTaskWhere(access, convo.task_id), select: { id: true } });
    if (!ok) throw new ApiError('Not found', 404);
    const now = new Date();
    await prisma.chatConversation.update({
      where: { id: convo.id },
      data:
        body.state === 'hidden'
          ? { page_hidden_at: now }
          : body.state === 'typing'
            ? { last_seen_at: now, last_typing_at: now, page_hidden_at: null }
            : { last_seen_at: now, page_hidden_at: null },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
