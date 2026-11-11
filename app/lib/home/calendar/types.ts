/**
 * Home screen Slice 10a: shapes for today's calendar on the home screen. The browser gets a
 * time and a who for each row, and everything else only from the drawer's own GET. A full
 * email address never appears on a row or in the chat shape.
 */

import type { HomeRef } from '../types';
import type { HomeProjectItem } from '../projects/types';

/** One row on the strip: the time and who, nothing else. */
export interface HomeCalendarRow {
  /** CalendarEvent.id */
  id: string;
  /** "2:00", "6:30 am", "Now", or "Tomorrow 1:00". */
  time: string;
  who: string;
  muted: boolean;
  openable: boolean;
}

/** GET /api/home/calendar. All fields are empty when nothing is worth showing. */
export interface HomeCalendarStrip {
  upcoming: HomeCalendarRow[];
  later: HomeCalendarRow[];
  earlier: HomeCalendarRow[];
  all_day: string | null;
  tomorrow: HomeCalendarRow | null;
  /** A meeting under way or starting within 30 minutes, for the line above a pinned card. */
  soon: HomeCalendarRow | null;
}

export interface HomeCalendarLink {
  label: string;
  /** An https address, or null when the link opens another drawer (project_id set). */
  href: string | null;
  project_id: string | null;
}

/** GET /api/home/calendar/[id]. */
export interface HomeCalendarEventResponse {
  event: {
    id: string;
    title: string;
    when: string;
    location: string | null;
    join: { href: string; label: string } | null;
    invite_text: string | null;
    invite_links: { href: string; label: string }[];
  };
  client: HomeRef | null;
  also_with: string[];
  people: { name: string; detail: string | null; reply: string | null }[];
  matched_by: string;
  hints: { text: string; muted: boolean }[];
  items: HomeProjectItem[];
  more_items: number;
  more_project_id: string | null;
  links: HomeCalendarLink[];
}

export type CalendarKind = 'meeting' | 'block' | 'answer';

/** One event as the chat reads it. Names only: no address, no description. */
export interface ChatCalendarRow {
  /** ISO. */
  start: string;
  /** ISO. */
  end: string;
  all_day: boolean;
  who: string;
  title: string;
  kind: CalendarKind;
  join_url: string | null;
  client: string | null;
  lead: boolean;
}

/** ownerToday().calendar. */
export interface ChatCalendar {
  rows: ChatCalendarRow[];
  tomorrow_first: ChatCalendarRow | null;
}
