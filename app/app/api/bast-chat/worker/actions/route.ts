import { NextRequest, NextResponse } from 'next/server';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { recordAction, recordActionSchema } from '@/lib/bast-chat/actions';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';

/**
 * POST /api/bast-chat/worker/actions: record an applied write (before and after) or a handoff proposal.
 * 201 {id, status, undo_until}. The write already happened by the time it is recorded, so it is always recorded;
 * the write cap is counted here and refused on the NEXT write (assertChatWriteAllowed, and writes_left in the inbox).
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
