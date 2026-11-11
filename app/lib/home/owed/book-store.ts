/**
 * Home Slice 4d: the machine's side of "Book 30 minutes" (GET /api/bast-chat/worker/owed/bookings is the dry run and writes
 * nothing; POST saves what the machine did). Writes only the owner's home_owed_thread booking columns. Never an EmailAsk, Task,
 * EmailOutbox or CalendarEvent row, and nothing is sent.
 */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { itemKeySchema, parseItemKey } from '../item-key';
import { ownerOnHome } from '../keeper/run';
import { bookSwitchOn, pickBookSlot } from './book';
import { cleanBookName } from './book-copy';
import { SLOT } from './slot';

/** The calendar and account the block goes on. Fixed. */
export const BOOK_CALENDAR = 'primary';
export const BOOK_ACCOUNT = 'mike@becomeindelible.com';
/** A request that failed this many times is dropped, so the button comes back. */
export const BOOK_MAX_ATTEMPTS = 3;
export const BOOK_POST_MAX_ITEMS = 10;
export const BOOK_POST_MAX_BYTES = 64 * 1024;
const SEARCH_DAYS = 5;

export interface BookCreate {
  thread_key: string;
  title: string;
  description: string;
  start: string;
  end: string;
  calendar: 'primary';
  account: string;
}
export interface BookDelete {
  thread_key: string;
  event_id: string;
}
export interface BookingsGet {
  skipped?: 'home_off' | 'book_off';
  create: BookCreate[];
  delete: BookDelete[];
  window?: { from: string; to: string };
}

const iso = z.string().datetime({ offset: true });
export const bookingsBodySchema = z
  .object({
    created: z.array(z.object({ thread_key: itemKeySchema, event_id: z.string().min(1).max(255), start: iso, end: iso }).strict()).max(BOOK_POST_MAX_ITEMS).default([]),
    conflicts: z.array(z.object({ thread_key: itemKeySchema }).strict()).max(BOOK_POST_MAX_ITEMS).default([]),
    deleted: z.array(z.object({ thread_key: itemKeySchema, event_id: z.string().min(1).max(255) }).strict()).max(BOOK_POST_MAX_ITEMS).default([]),
    failed: z.array(z.object({ thread_key: itemKeySchema, error: z.string().max(2000) }).strict()).max(BOOK_POST_MAX_ITEMS).default([]),
  })
  .strict();
export type BookingsBody = z.output<typeof bookingsBodySchema>;

/** The dry run: what the machine should create and delete. Writes nothing. */
export async function listBookings(db: PrismaClient, ownerId: string, now: Date): Promise<BookingsGet> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { skipped: 'home_off', create: [], delete: [] };
  if (!(await bookSwitchOn(db, ownerId))) return { skipped: 'book_off', create: [], delete: [] };

  const rows = await db.homeOwedThread.findMany({
    where: {
      user_id: ownerId,
      OR: [
        { book_requested_at: { not: null }, booked_event_id: null, book_undo_requested_at: null, book_attempts: { lt: BOOK_MAX_ATTEMPTS } },
        { booked_event_id: { not: null }, book_undo_requested_at: { not: null } },
      ],
    },
    select: { thread_key: true, book_requested_at: true, booked_event_id: true, booked_start: true, booked_end: true, book_undo_requested_at: true },
    orderBy: { book_requested_at: 'asc' },
    take: 50,
  });

  const create: BookCreate[] = [];
  const del: BookDelete[] = [];
  const taken: { start: Date; end: Date }[] = [];
  for (const r of rows) {
    if (r.booked_event_id) {
      if (r.book_undo_requested_at) del.push({ thread_key: r.thread_key, event_id: r.booked_event_id });
      continue;
    }
    const key = parseItemKey(r.thread_key);
    if (!key || key.kind !== 'thread') continue;
    const newest = await db.emailAsk.findFirst({
      where: { account: key.account, state: 'open', OR: [{ thread_id: key.thread_id }, { thread_id: null, message_id: key.thread_id }] },
      orderBy: { received_at: 'desc' },
      select: { from_name: true, from_email: true, deep_link: true },
    });
    if (!newest) continue;
    // The stored slot stands while it is still at least 15 minutes away; otherwise (or after a conflict cleared it) pick again, in memory only.
    let slot: { start: Date; end: Date } | null = null;
    if (r.booked_start && r.booked_end && r.booked_start.getTime() >= now.getTime() + SLOT.leadMs) slot = { start: r.booked_start, end: r.booked_end };
    else slot = await pickBookSlot(db, ownerId, now, timezone, r.thread_key);
    if (!slot) continue;
    // Two requests in one run never share a time.
    if (taken.some((t) => slot!.start < t.end && slot!.end > t.start)) continue;
    taken.push(slot);
    create.push({
      thread_key: r.thread_key,
      title: `Answer ${cleanBookName(newest.from_name, newest.from_email)}`,
      description: newest.deep_link,
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      calendar: BOOK_CALENDAR,
      account: BOOK_ACCOUNT,
    });
  }
  return {
    create,
    delete: del,
    window: { from: now.toISOString(), to: new Date(now.getTime() + SEARCH_DAYS * 86_400_000).toISOString() },
  };
}

export interface BookingsSaveResult {
  skipped?: 'home_off';
  saved: { thread_key: string; outcome: 'created' | 'conflict' | 'deleted' | 'failed' }[];
  /** event_id is echoed for a refused create so the machine can remove an event nobody is waiting for. */
  refused: { thread_key: string; reason: string; event_id?: string }[];
}

export async function saveBookings(db: PrismaClient, ownerId: string, body: BookingsBody, now: Date): Promise<BookingsSaveResult> {
  const { ok } = await ownerOnHome(db, ownerId);
  if (!ok) return { skipped: 'home_off', saved: [], refused: [] };
  return db.$transaction(
    async (tx) => {
      const saved: BookingsSaveResult['saved'] = [];
      const refused: BookingsSaveResult['refused'] = [];
      const rowOf = (key: string) =>
        tx.homeOwedThread.findUnique({
          where: { user_id_thread_key: { user_id: ownerId, thread_key: key } },
          select: { book_requested_at: true, booked_event_id: true, book_undo_requested_at: true, book_attempts: true },
        });
      const whereOf = (key: string) => ({ user_id_thread_key: { user_id: ownerId, thread_key: key } });
      const seen = new Set<string>();
      const first = (key: string): boolean => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      };

      for (const c of body.created) {
        if (!first(c.thread_key)) {
          refused.push({ thread_key: c.thread_key, reason: 'duplicate', event_id: c.event_id });
          continue;
        }
        const start = new Date(c.start);
        const end = new Date(c.end);
        const row = await rowOf(c.thread_key);
        if (!row || !row.book_requested_at || row.booked_event_id || row.book_undo_requested_at) {
          refused.push({ thread_key: c.thread_key, reason: 'no_request', event_id: c.event_id });
          continue;
        }
        if (end.getTime() - start.getTime() !== SLOT.minutes * 60_000) {
          refused.push({ thread_key: c.thread_key, reason: 'bad_slot', event_id: c.event_id });
          continue;
        }
        await tx.homeOwedThread.update({
          where: whereOf(c.thread_key),
          data: { booked_event_id: c.event_id, booked_start: start, booked_end: end, booked_at: now, book_attempts: 0, book_error: null },
        });
        saved.push({ thread_key: c.thread_key, outcome: 'created' });
      }

      for (const c of body.conflicts) {
        if (!first(c.thread_key)) {
          refused.push({ thread_key: c.thread_key, reason: 'duplicate' });
          continue;
        }
        const row = await rowOf(c.thread_key);
        if (!row || !row.book_requested_at || row.booked_event_id) {
          refused.push({ thread_key: c.thread_key, reason: 'no_request' });
          continue;
        }
        await tx.homeOwedThread.update({ where: whereOf(c.thread_key), data: { booked_start: null, booked_end: null } });
        saved.push({ thread_key: c.thread_key, outcome: 'conflict' });
      }

      for (const d of body.deleted) {
        if (!first(d.thread_key)) {
          refused.push({ thread_key: d.thread_key, reason: 'duplicate' });
          continue;
        }
        const row = await rowOf(d.thread_key);
        if (!row || row.booked_event_id !== d.event_id) {
          refused.push({ thread_key: d.thread_key, reason: 'no_such_event' });
          continue;
        }
        if (!row.book_undo_requested_at) {
          refused.push({ thread_key: d.thread_key, reason: 'not_requested' });
          continue;
        }
        await tx.homeOwedThread.update({
          where: whereOf(d.thread_key),
          data: {
            book_requested_at: null, booked_event_id: null, booked_start: null, booked_end: null, booked_at: null,
            book_undo_requested_at: null, book_attempts: 0, book_error: null,
          },
        });
        saved.push({ thread_key: d.thread_key, outcome: 'deleted' });
      }

      for (const f of body.failed) {
        if (!first(f.thread_key)) {
          refused.push({ thread_key: f.thread_key, reason: 'duplicate' });
          continue;
        }
        const row = await rowOf(f.thread_key);
        const pendingCreate = !!row && !!row.book_requested_at && !row.booked_event_id;
        const pendingDelete = !!row && !!row.booked_event_id && !!row.book_undo_requested_at;
        if (!row || (!pendingCreate && !pendingDelete)) {
          refused.push({ thread_key: f.thread_key, reason: 'no_request' });
          continue;
        }
        const attempts = row.book_attempts + 1;
        const error = f.error.slice(0, 300);
        // A create that keeps failing is dropped (the button comes back); a delete is kept, the machine tries again.
        const drop = pendingCreate && attempts >= BOOK_MAX_ATTEMPTS;
        await tx.homeOwedThread.update({
          where: whereOf(f.thread_key),
          data: drop
            ? { book_requested_at: null, booked_start: null, booked_end: null, book_attempts: 0, book_error: error }
            : { book_attempts: attempts, book_error: error },
        });
        saved.push({ thread_key: f.thread_key, outcome: 'failed' });
      }
      return { saved, refused };
    },
    { timeout: 30_000 },
  );
}
