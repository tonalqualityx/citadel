import { NextRequest, NextResponse } from 'next/server';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { heartbeatSchema, recordHeartbeat } from '@/lib/bast-chat/heartbeat';
import { chatError, chatJson } from '@/lib/bast-chat/route-helpers';

/** POST /api/bast-chat/worker/heartbeat: strict body (HeartbeatBody). Runs no purge. 200 {ok:true}. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    return chatJson(await recordHeartbeat(await chatWorkerBody(request, heartbeatSchema.strict())));
  } catch (error) {
    return chatError(error);
  }
}
