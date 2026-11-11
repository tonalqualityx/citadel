/**
 * Home Slice 4d: the act side of "Book 30 minutes". A tap writes only the request on his own home_owed_thread row (plus the
 * home_actions row the caller appends); the machine makes the event. Nothing here writes an EmailAsk, Task, EmailOutbox or
 * CalendarEvent row, and nothing is sent. The block has no attendees: the machine's argv is fixed.
 */
import type { HomeDb } from '../state';
import { pickSlot, slotSearchSpan, type Slot, type SlotEvent } from './slot';

export const BOOK_PICK_SELECT = { starts_at: true, ends_at: true, all_day: true } as const;

/** His switch (no settings row is off). */
export async function bookSwitchOn(db: HomeDb, userId: string): Promise<boolean> {
  const s = await db.homeKeeperSettings.findUnique({ where: { user_id: userId }, select: { book_blocks: true } });
  return s?.book_blocks === true;
}

/**
 * The first free half hour for him: CalendarEvent rows (the one calendar this app syncs) plus every slot another thread's
 * request or block already holds, so two taps never pick the same time. `exceptKey` leaves one row's own slot out.
 */
export async function pickBookSlot(db: HomeDb, userId: string, now: Date, timeZone: string, exceptKey?: string): Promise<Slot | null> {
  const span = slotSearchSpan(now);
  const [events, held] = await Promise.all([
    db.calendarEvent.findMany({
      where: { starts_at: { lt: span.to }, ends_at: { gt: span.from } },
      select: BOOK_PICK_SELECT,
    }),
    db.homeOwedThread.findMany({
      where: {
        user_id: userId,
        booked_start: { not: null },
        booked_end: { not: null },
        book_undo_requested_at: null,
        ...(exceptKey ? { thread_key: { not: exceptKey } } : {}),
      },
      select: { booked_start: true, booked_end: true },
    }),
  ]);
  const all: SlotEvent[] = [
    ...events,
    ...held.map((h) => ({ starts_at: h.booked_start as Date, ends_at: h.booked_end as Date, all_day: false })),
  ];
  return pickSlot(all, now, timeZone);
}

export type RequestBookResult =
  | { ok: true; slot: Slot; before: BookBefore }
  | { ok: false; reason: 'book_off' | 'book_not_ready' | 'already_booked' | 'no_free_slot' };

/** What Undo needs: the request fields as they were (a tap only starts from a row with no request and no block). */
export interface BookBefore {
  had_row: boolean;
}

/**
 * Record a tap: the picked slot and the request on his own row. Needs the switch, a needs-thought row, and no request or block
 * already there. None found writes nothing and says no_free_slot.
 */
export async function requestBook(db: HomeDb, userId: string, key: string, now: Date, timeZone: string): Promise<RequestBookResult> {
  if (!(await bookSwitchOn(db, userId))) return { ok: false, reason: 'book_off' };
  const where = { user_id_thread_key: { user_id: userId, thread_key: key } };
  const row = await db.homeOwedThread.findUnique({ where, select: { state: true, book_requested_at: true, booked_event_id: true, book_undo_requested_at: true } });
  if (!row || row.state !== 'needs_thought') return { ok: false, reason: 'book_not_ready' };
  if (row.book_requested_at || row.booked_event_id || row.book_undo_requested_at) return { ok: false, reason: 'already_booked' };
  const slot = await pickBookSlot(db, userId, now, timeZone);
  if (!slot) return { ok: false, reason: 'no_free_slot' };
  await db.homeOwedThread.update({
    where,
    data: { book_requested_at: now, booked_start: slot.start, booked_end: slot.end, book_attempts: 0, book_error: null },
  });
  return { ok: true, slot, before: { had_row: true } };
}

export type UndoBookOutcome = 'cancelled' | 'delete_requested' | 'nothing';

/**
 * Undo of a tap, inside its 24 hours. Before the event exists it just clears the request. After, it sets
 * book_undo_requested_at so the machine deletes that ONE event and confirms. Never touches the calendar.
 */
export async function undoBook(db: HomeDb, userId: string, key: string, now: Date): Promise<UndoBookOutcome> {
  const where = { user_id_thread_key: { user_id: userId, thread_key: key } };
  const row = await db.homeOwedThread.findUnique({ where, select: { book_requested_at: true, booked_event_id: true, book_undo_requested_at: true } });
  if (!row) return 'nothing';
  if (row.booked_event_id) {
    if (!row.book_undo_requested_at) await db.homeOwedThread.update({ where, data: { book_undo_requested_at: now } });
    return 'delete_requested';
  }
  if (row.book_requested_at) {
    await db.homeOwedThread.update({
      where,
      data: { book_requested_at: null, booked_start: null, booked_end: null, book_attempts: 0, book_error: null },
    });
    return 'cancelled';
  }
  return 'nothing';
}
