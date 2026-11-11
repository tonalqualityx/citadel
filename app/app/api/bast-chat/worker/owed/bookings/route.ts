import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireChatWorker, chatWorkerBody } from '@/lib/bast-chat/worker-kit';
import { chatError, chatJson, workerOwnerId } from '@/lib/bast-chat/route-helpers';
import { BOOK_POST_MAX_BYTES, bookingsBodySchema, listBookings, saveBookings } from '@/lib/home/owed/book-store';

/**
 * GET /api/bast-chat/worker/owed/bookings (Slice 4d): the dry run of "Book 30 minutes". Writes nothing.
 * 200 `{create: [{thread_key, title, description, start, end, calendar: "primary", account: "mike@becomeindelible.com"}],
 * delete: [{thread_key, event_id}], window: {from, to}}`. `start` and `end` are ISO instants; `title` is "Answer {name}" (the
 * name is one plain line, at most 80 characters); `description` is the thread's Gmail link only. `window` is the span to read
 * calendar events over before creating (now to 5 days on). Or `{skipped: "home_off" | "book_off", create: [], delete: []}`.
 * Takes no user id.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const ownerId = await workerOwnerId();
    return chatJson(await listBookings(prisma, ownerId, new Date()));
  } catch (error) {
    return chatError(error);
  }
}

/**
 * POST /api/bast-chat/worker/owed/bookings: strict body `{created: [{thread_key, event_id, start, end}], conflicts: [{thread_key}],
 * deleted: [{thread_key, event_id}], failed: [{thread_key, error}]}`, at most 10 of each, at most 64 KB. A conflict clears the
 * picked slot so the next GET picks again. A result for a thread with no pending request is refused (a refused create echoes its
 * event_id so the machine can remove an event nobody is waiting for).
 * 200 `{saved: [{thread_key, outcome}], refused: [{thread_key, reason, event_id?}]}`, or `{skipped: "home_off", saved: [], refused: []}`.
 * Writes only the owner's home_owed_thread booking columns. Never an email ask, task, outbox or calendar event row; nothing is sent.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireChatWorker();
    const body = await chatWorkerBody(request, bookingsBodySchema, BOOK_POST_MAX_BYTES);
    const ownerId = await workerOwnerId();
    return chatJson(await saveBookings(prisma, ownerId, body, new Date()));
  } catch (error) {
    return chatError(error);
  }
}
