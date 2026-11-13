import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { ownedConversation } from '@/lib/bast-chat/events';
import { workerStatus } from '@/lib/bast-chat/heartbeat';
import { expireStaleMessages } from '@/lib/bast-chat/inbox';
import { ApiError } from '@/lib/api/errors';
import { chatError, chatJson, panelActions, panelFeed } from '@/lib/bast-chat/route-helpers';

/** GET /api/bast-chat/conversations/:id/feed?after=<seq>: what the panel polls. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { auth, settings } = await requireChatOwner();
    const { id } = await params;
    const conv = await ownedConversation(id, auth.userId, prisma);
    const raw = request.nextUrl.searchParams.get('after');
    let after = 0;
    if (raw !== null && raw !== '') {
      if (!/^\d{1,9}$/.test(raw)) throw new ApiError('after must be a whole number', 400, 'bad_after');
      after = Number(raw);
    }
    const now = new Date();
    // Lapse old waiting messages here too: the machine may be off, so nothing else would.
    await expireStaleMessages(settings.stale_after_minutes, now);
    const earlier = conv.task_id
      ? (await prisma.bastChatConversation.findMany({ where: { owner_id: auth.userId, task_id: conv.task_id, id: { not: conv.id } }, select: { id: true }, take: 20 })).map((c) => c.id)
      : [];
    const [page, worker, actions] = await Promise.all([panelFeed(conv.id, after, prisma), workerStatus(now), panelActions(conv.id, now, prisma, earlier)]);
    return chatJson({
      conversation: { id: conv.id, status: conv.status },
      events: page.events,
      live_text: conv.status === 'closed' ? null : conv.live_text,
      live_action: conv.status === 'closed' ? null : conv.live_action,
      worker: { online: worker.online, paused: worker.paused, pause_reason: worker.pause_reason, auth_state: worker.auth_state },
      actions,
      waiting: page.waiting,
    });
  } catch (error) {
    return chatError(error);
  }
}
