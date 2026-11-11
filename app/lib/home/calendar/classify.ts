/**
 * Home screen Slice 10a: which calendar events belong on his day, and what kind each is.
 * Pure. All-day events are stored as UTC midnight dates, so they are compared by date text,
 * never by instant (a tomorrow all-day event would otherwise land on tonight's strip).
 */

import { getZonedDateString } from '@/lib/utils/time';
import { CALENDAR_OWNER_EMAIL } from './rules';

export interface CalEvent {
  /** CalendarEvent.id */
  id: string;
  /** Google's event id (what a 4d booked block points at). */
  event_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  all_day: boolean;
  description: string | null;
  meet_url: string | null;
  location: string | null;
  attendees: unknown;
}

export interface Attendee {
  /** Lowercase. */
  email: string;
  display_name: string | null;
  response_status: string | null;
  organizer: boolean;
  self: boolean;
}

export type EventKind = 'answer' | 'meeting' | 'block';

export function parseAttendees(json: unknown): Attendee[] {
  if (!Array.isArray(json)) return [];
  const out: Attendee[] = [];
  for (const a of json) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
    if (!email) continue;
    out.push({
      email,
      display_name: typeof r.display_name === 'string' && r.display_name.trim() ? r.display_name.trim() : null,
      response_status: typeof r.response_status === 'string' ? r.response_status : null,
      organizer: r.organizer === true,
      self: r.self === true,
    });
  }
  return out;
}

const NOT_PEOPLE = /@(resource|group)\.calendar\.google\.com$/;

/** The attendees other than him, without room and group calendars. */
export function others(event: Pick<CalEvent, 'attendees'>): Attendee[] {
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const a of parseAttendees(event.attendees)) {
    if (a.self || a.email === CALENDAR_OWNER_EMAIL || NOT_PEOPLE.test(a.email) || seen.has(a.email)) continue;
    seen.add(a.email);
    out.push(a);
  }
  return out;
}

/** His own entry says declined: the event shows nowhere. */
export function isDeclined(event: Pick<CalEvent, 'attendees'>): boolean {
  return parseAttendees(event.attendees).some((a) => (a.self || a.email === CALENDAR_OWNER_EMAIL) && a.response_status === 'declined');
}

export interface DayWindow {
  /** YYYY-MM-DD in his zone. */
  ymd: string;
  /** Zoned midnight, inclusive. */
  start: Date;
  /** Next zoned midnight, exclusive. */
  end: Date;
}

/** Whether an event sits on the day: timed events by overlap, all-day events by date text. */
export function onDay(event: CalEvent, day: DayWindow): boolean {
  if (event.all_day) {
    const from = event.starts_at.toISOString().slice(0, 10);
    const to = event.ends_at.toISOString().slice(0, 10);
    return from <= day.ymd && day.ymd < to;
  }
  return event.starts_at < day.end && event.ends_at > day.start;
}

export function dayWindow(start: Date, end: Date, timeZone: string): DayWindow {
  return { ymd: getZonedDateString(start, timeZone), start, end };
}

export interface KindContext {
  /** HomeOwedThread.booked_event_id values (Google event ids). */
  bookedIds: ReadonlySet<string>;
  /** The title named a client or project and no attendee matched one. */
  titleMatched?: boolean;
}

export function eventKind(event: CalEvent, ctx: KindContext): EventKind {
  if (ctx.bookedIds.has(event.event_id)) return 'answer';
  if (others(event).length > 0 || ctx.titleMatched) return 'meeting';
  return 'block';
}

/** Timed, not declined, kind meeting. Exported for 7e's two-meetings rule. */
export function isMeeting(event: CalEvent, ctx: KindContext): boolean {
  return !event.all_day && !isDeclined(event) && eventKind(event, ctx) === 'meeting';
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
