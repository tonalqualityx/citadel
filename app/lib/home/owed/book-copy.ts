/**
 * Home Slice 4d: every string Mike reads about "Book 30 minutes". Pure. Plain words, no dash, none of the three banned words
 * (copy-guard covers lib/home).
 */
import { weekdayIn } from './clock';

/** The home_actions.action of the tap. */
export const BOOK_ACTION = 'book_block';

export const BOOK_COPY = {
  off: 'Booking time is not turned on.',
  notReady: 'Book 30 minutes is for a row where Bast has written its read.',
  noThread: 'That thread is not waiting on a reply any more.',
  alreadyBooked: 'There is already a block for this one.',
  undone: 'Taken off your calendar.',
  undoneBeforeBooked: 'Cancelled. Nothing was put on your calendar.',
} as const;

/** "Thursday at 2:00": the weekday and the 12 hour clock without am or pm, in his zone. */
export function bookWhen(at: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).formatToParts(at);
  } catch {
    timeZone = 'America/New_York';
    parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).formatToParts(at);
  }
  const h = parts.find((p) => p.type === 'hour')?.value ?? '';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${weekdayIn(at, timeZone)} at ${h}:${m}`;
}

/** The line under Handled for you and the toast. */
export const bookLine = (who: string, at: Date, timeZone: string): string =>
  `Put 30 minutes on your calendar ${bookWhen(at, timeZone)} to answer ${who}.`;

/** The row's own words once the event exists. */
export const bookedLine = (at: Date, timeZone: string): string => `Booked ${bookWhen(at, timeZone)}`;

/** The name as it goes into the calendar title: one plain line, no markup, no dash, at most 80 characters. */
export function cleanBookName(raw: string | null | undefined, email: string): string {
  const base = (raw ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/["<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const name = base || (email.split('@')[0] ?? '').replace(/\s+/g, ' ').trim() || 'them';
  return name.slice(0, 80).trim() || 'them';
}
