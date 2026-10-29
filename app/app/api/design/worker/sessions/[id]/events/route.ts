import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';
import { appendWorkerEvents, MAX_WORKER_EVENTS_PER_POST } from '@/lib/design/events';

const KINDS = ['text', 'thought', 'action', 'result', 'screenshot', 'gate', 'cost', 'plan', 'status', 'followup', 'client_files', 'change', 'publish'] as const;
const schema = z.object({
  acks: z.array(z.number().int().positive()).max(500).optional(),
  // The cap is checked by appendWorkerEvents (413), so allow one more than the cap through zod.
  events: z
    .array(z.object({
      role: z.enum(['assistant', 'tool', 'system']),
      kind: z.enum(KINDS),
      payload: z.record(z.string(), z.unknown()),
      turn: z.number().int().min(0).nullish(),
    }))
    .max(MAX_WORKER_EVENTS_PER_POST * 5)
    .optional(),
});

// Events are bounded at 100 per post, 32 KB each: the body can legitimately reach a few MB.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const body = await workerBody(request, schema, 4 * 1024 * 1024);
    const r = await appendWorkerEvents(id, {
      acks: body.acks,
      events: body.events?.map((e) => ({ role: e.role, kind: e.kind, payload: e.payload as Prisma.InputJsonValue, turn: e.turn ?? null })),
    });
    return NextResponse.json({ last_seq: r.last_seq });
  } catch (error) {
    return handleApiError(error);
  }
}
