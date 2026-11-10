import { NextRequest, NextResponse } from 'next/server';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { recordAction, recordActionSchema } from '@/lib/bast-chat/actions';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';

/**
 * POST /api/bast-chat/worker/actions: record a handoff proposal, and nothing else (201 {id, status, undo_until}).
 * Applied, filed and failed records are refused with 400: Citadel writes the record of every change itself when
 * the chat's key changes a task (see lib/bast-chat/task-record.ts, header X-Bast-Chat-Action on the task routes).
 * A proposal only stores `proposed`: release is Mike's tap, under his own session (actions/:id/release).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, recordActionSchema);
    const r = await recordAction(body, await workerOwnerId());
    return chatJson({ id: r.id, status: r.status, undo_until: r.undo_until ? r.undo_until.toISOString() : null }, 201);
  } catch (error) {
    return chatError(error);
  }
}
