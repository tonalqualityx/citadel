import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { appendWorkerEvents, ownedConversation, WORKER_EVENT_KINDS, WORKER_EVENT_ROLES, MAX_WORKER_EVENTS_PER_POST } from '@/lib/bast-chat/events';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';

const bodySchema = z
  .object({
    acks: z.array(z.number().int().positive()).max(200).optional(),
    events: z
      .array(
        z
          .object({
            role: z.enum(WORKER_EVENT_ROLES),
            kind: z.enum(WORKER_EVENT_KINDS),
            payload: z.record(z.string(), z.unknown()),
            turn: z.number().int().min(0).max(100000).nullish(),
          })
          .strict(),
      )
      .max(MAX_WORKER_EVENTS_PER_POST)
      .optional(),
  })
  .strict();

/**
 * POST /api/bast-chat/worker/conversations/:id/events {acks, events}: 200 {last_seq, first_seq, acked}.
 * (The machine's client reads last_seq; the other two are extra.)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const { id } = await params;
    const ownerId = await workerOwnerId();
    const conv = await ownedConversation(id, ownerId, prisma);
    const body = await chatWorkerBody(request, bodySchema);
    const events = (body.events ?? []).map((e) => ({ role: e.role, kind: e.kind, payload: e.payload as Prisma.InputJsonValue, turn: e.turn ?? null }));
    return chatJson(await appendWorkerEvents(conv.id, ownerId, { acks: body.acks, events }));
  } catch (error) {
    return chatError(error);
  }
}
