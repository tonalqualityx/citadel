import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { ownedConversation, patchWorkerConversation, recentText } from '@/lib/bast-chat/events';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';

const patchSchema = z
  .object({
    status: z.enum(['idle', 'queued', 'running']),
    live_text: z.string().max(100_000).nullable(),
    live_action: z.string().max(1000).nullable(),
    model: z.string().max(100).nullable(),
    cost_usd: z.number().min(0).max(1000),
  })
  .partial()
  .strict();

/** GET /api/bast-chat/worker/conversations/:id?history=20: {messages:[{seq, role, text}]} to seed a reopened query. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const { id } = await params;
    const conv = await ownedConversation(id, await workerOwnerId(), prisma);
    const raw = request.nextUrl.searchParams.get('history');
    let n = 20;
    if (raw !== null && raw !== '') {
      if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) throw new ApiError('history must be a whole number from 1 to 50', 400, 'bad_history');
      n = Math.min(50, Number(raw));
    }
    return chatJson({ messages: await recentText(conv.id, n, prisma) });
  } catch (error) {
    return chatError(error);
  }
}

/** PATCH /api/bast-chat/worker/conversations/:id: status, live_text, live_action, model, cost_usd. 200 {ok:true}. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const { id } = await params;
    const conv = await ownedConversation(id, await workerOwnerId(), prisma);
    const patch = await chatWorkerBody(request, patchSchema);
    await patchWorkerConversation(conv.id, patch);
    return chatJson({ ok: true });
  } catch (error) {
    return chatError(error);
  }
}
