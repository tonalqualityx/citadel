import { NextResponse } from 'next/server';
import { requireChatWorker } from '@/lib/bast-chat/worker-kit';
import { buildInbox } from '@/lib/bast-chat/inbox';
import { chatError, chatJson } from '@/lib/bast-chat/route-helpers';

/** GET /api/bast-chat/worker/inbox: {messages, stops, settings} for the chat daemon (the shape of its types.ts). */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    return chatJson(await buildInbox());
  } catch (error) {
    return chatError(error);
  }
}
