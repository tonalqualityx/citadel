import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { ownedConversation } from '@/lib/bast-chat/events';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { ApiError } from '@/lib/api/errors';
import { REDACTED_TURN_TEXT } from '@/lib/triage-desk/scrub';

const bodySchema = z.object({ seq: z.number().int().positive() }).strict();

/**
 * POST /api/bast-chat/worker/conversations/:id/redact { seq }: 200 { seq, redacted: true }.
 * The owner pasted connection details into a turn (a pull key, a password); the stored turn becomes "[connection info received]" and is marked
 * redacted, so a session reading the card's conversation (GET /api/tasks/:id/conversation) gets no text for it. Text events only; the original
 * words are replaced, not kept. The chat lane's worker routes only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireChatWorker();
    const { id } = await params;
    const ownerId = await workerOwnerId();
    const conv = await ownedConversation(id, ownerId, prisma);
    const body = await chatWorkerBody(request, bodySchema);
    const ev = await prisma.bastChatEvent.findUnique({ where: { conversation_id_seq: { conversation_id: conv.id, seq: body.seq } }, select: { id: true, kind: true, payload: true } });
    if (!ev) throw new ApiError('No such turn.', 404, 'turn_missing');
    if (ev.kind !== 'text') throw new ApiError('Only a text turn can be redacted.', 400, 'turn_not_text');
    const payload = ev.payload && typeof ev.payload === 'object' && !Array.isArray(ev.payload) ? (ev.payload as Record<string, unknown>) : {};
    await prisma.bastChatEvent.update({ where: { id: ev.id }, data: { payload: { ...payload, text: REDACTED_TURN_TEXT, redacted: true } as Prisma.InputJsonValue } });
    return chatJson({ seq: body.seq, redacted: true });
  } catch (error) {
    return chatError(error);
  }
}
