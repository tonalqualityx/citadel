import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { currentConversation } from '@/lib/bast-chat/events';
import { getUsage, usageLeft } from '@/lib/bast-chat/usage';
import { workerStatus } from '@/lib/bast-chat/heartbeat';
import { expireStaleMessages } from '@/lib/bast-chat/inbox';
import { chatError, chatJson, lastAssistantSeq } from '@/lib/bast-chat/route-helpers';

/** GET /api/bast-chat/status: owner only, session only. A 403 makes the dock render nothing. */
export async function GET(): Promise<NextResponse> {
  try {
    const { auth, settings } = await requireChatOwner();
    const now = new Date();
    // Lapse old waiting messages here too: the machine may be off, so nothing else would.
    await expireStaleMessages(settings.stale_after_minutes, now);
    const [worker, conv, used] = await Promise.all([workerStatus(now), currentConversation(auth.userId), getUsage(auth.userId, now)]);
    return chatJson({
      enabled: settings.enabled,
      worker: { online: worker.online, paused: worker.paused, pause_reason: worker.pause_reason, auth_state: worker.auth_state },
      conversation_id: conv?.id ?? null,
      last_assistant_seq: conv ? await lastAssistantSeq(conv.id, prisma) : null,
      usage: usageLeft(settings, used),
    });
  } catch (error) {
    return chatError(error);
  }
}
