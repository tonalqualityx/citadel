import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { ownerOnHome } from '@/lib/home/keeper/run';
import { candidatesFor, reconcileOn } from '@/lib/home/reconcile/load';
import { CANDIDATES_MAX_BYTES, candidatesBodySchema } from '@/lib/home/reconcile/schema';

/**
 * POST /api/bast-chat/worker/reconcile/candidates (Slice 9a): what each sent message could be about. Writes nothing.
 * Strict body `{messages: [{message_key, account, thread_id, thread_rfc_ids: [], to: [{email, name}], cc: [], subject, sent_at}]}`, at most
 * 10 messages, at most 64 KB. Answers per message `{message_key, client: {id, name} | null, tasks: [at most 8: {id, title, mine, status, tags,
 * protected, client, project, open_items, basis, free_to_change}], sessions: [{session_key, kind: "ask", title, text, asked_at} |
 * {key, kind: "work", title, started_at, last_event_at, span_minutes}], waits, projects, retainer: {hours} | null, tracked_hint}`.
 * Or `{skipped: "home_off" | "reconcile_off", messages: []}`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, candidatesBodySchema, CANDIDATES_MAX_BYTES);
    const ownerId = await workerOwnerId();
    const { ok } = await ownerOnHome(prisma, ownerId);
    if (!ok) return chatJson({ skipped: 'home_off', messages: [] });
    if (!(await reconcileOn(prisma, ownerId))) return chatJson({ skipped: 'reconcile_off', messages: [] });
    const now = new Date();
    const messages = [];
    for (const m of body.messages) messages.push(await candidatesFor(prisma, ownerId, m, now));
    return chatJson({ messages });
  } catch (error) {
    return chatError(error);
  }
}
