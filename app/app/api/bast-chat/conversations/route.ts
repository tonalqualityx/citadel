import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireChatOwner } from '@/lib/bast-chat/access';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { conversationForTask, listConversations, startConversation } from '@/lib/bast-chat/events';
import { chatError, chatJson, ownerJsonBody, ownerPostGuard } from '@/lib/bast-chat/route-helpers';

const UUID = z.string().uuid();
/** `{}` starts the general chat; `{task_id}` opens (or reopens) that card's own conversation. Nothing else is accepted. */
const startBody = z.object({ task_id: UUID.optional() }).strict();

const summaryJson = (c: { id: string; title: string | null; status: string; last_message_at: Date | null; created_at: Date; task_id: string | null }) => ({
  id: c.id,
  title: c.title,
  status: c.status,
  last_message_at: c.last_message_at ? c.last_message_at.toISOString() : null,
  created_at: c.created_at.toISOString(),
  task_id: c.task_id,
});

/**
 * GET /api/bast-chat/conversations: the last 20 conversations. `?task_id=<uuid>` returns only that card's conversation
 * (zero or one row), for the card page.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwner();
    const raw = request.nextUrl.searchParams.get('task_id');
    if (raw !== null) {
      const parsed = UUID.safeParse(raw);
      if (!parsed.success) throw new ApiError('That card id is not valid.', 400, 'bad_task_id');
      const one = await conversationForTask(auth.userId, parsed.data.toLowerCase(), prisma);
      return chatJson({ conversations: one ? [summaryJson(one)] : [] });
    }
    const rows = await listConversations(auth.userId, 20);
    return chatJson({ conversations: rows.map(summaryJson) });
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/conversations {}: start a new general conversation (the open one is closed, kept). 201 {id}.
 * POST {task_id}: open that card's own conversation: 201 {id, reopened: false} the first time, 200 {id, reopened: true}
 * after (a closed one goes back to idle; its turns are replayed by the machine). No other conversation is closed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwner();
    const refused = ownerPostGuard(request);
    if (refused) return refused;
    const body = await ownerJsonBody(request, startBody);
    if (!body.task_id) return chatJson({ id: (await startConversation(auth.userId)).id }, 201);
    const taskId = body.task_id.toLowerCase();
    const task = await prisma.task.findFirst({ where: { id: taskId, is_deleted: false }, select: { id: true } });
    if (!task) throw new ApiError('That card was not found.', 404, 'not_found');
    const r = await startConversation(auth.userId, new Date(), prisma, taskId);
    return chatJson({ id: r.id, reopened: r.reopened }, r.reopened ? 200 : 201);
  } catch (error) {
    return chatError(error);
  }
}
