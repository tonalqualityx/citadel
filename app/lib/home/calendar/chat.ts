/**
 * Home screen Slice 10a: today's calendar in the chat's shape (ownerToday().calendar). Names
 * only: never an email address, never the invite text. Read only.
 */

import type { PrismaClient } from '@prisma/client';
import { CAL } from './rules';
import { isCalendarOwnerEmail } from './gate';
import { onDay, isDeclined, type CalEvent, type EventKind } from './classify';
import { answerLabel, safeText } from './copy';
import { pickJoin } from './join';
import { loadCalendarView, type CalendarView } from './load';
import { daysFor, kindOf } from './strip';
import type { ChatCalendar, ChatCalendarRow } from './types';

export const EMPTY_CHAT_CALENDAR: ChatCalendar = { rows: [], tomorrow_first: null };

function answerName(title: string): string | null {
  const m = /^answer\s+(.{1,80})$/i.exec(title.trim());
  return m ? safeText(m[1]) || null : null;
}

function rowFor(ev: CalEvent, view: CalendarView, kind: EventKind): ChatCalendarRow {
  const match = view.matches.get(ev.id);
  const title = safeText(ev.title) || (kind === 'meeting' ? 'A meeting' : 'Busy');
  const who = kind === 'answer' ? answerLabel(answerName(ev.title)) : kind === 'meeting' ? match?.label || title : title;
  const join = kind === 'meeting' ? pickJoin(ev)?.href ?? null : null;
  return {
    start: ev.starts_at.toISOString(),
    end: ev.ends_at.toISOString(),
    all_day: ev.all_day,
    who,
    title,
    kind,
    join_url: join && !join.includes('@') ? join : null,
    client: match?.client ? safeText(match.client.name) || null : null,
    lead: match?.lead != null,
  };
}

/** Pure: today's events and tomorrow's first meeting from a loaded view. */
export function chatCalendarFrom(view: CalendarView, now: Date, timeZone: string): ChatCalendar {
  const days = daysFor(now, timeZone);
  const live = view.events.filter((e) => !isDeclined(e));
  const todays = live
    .filter((e) => onDay(e, days.today))
    .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at.getTime() - b.starts_at.getTime())
    .slice(0, CAL.chatRows)
    .map((e) => rowFor(e, view, kindOf(e, view)));
  const first = live
    .filter((e) => !e.all_day && onDay(e, days.tomorrow) && kindOf(e, view) === 'meeting')
    .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())[0];
  return { rows: todays, tomorrow_first: first ? rowFor(first, view, 'meeting') : null };
}

/**
 * ownerToday's calendar. Empty when the owner's email is not the calendar's, and empty (not an error)
 * when the calendar cannot be read, so the Today answer never fails because of it.
 */
export async function ownerCalendar(db: PrismaClient, ownerId: string, now: Date, timeZone: string): Promise<ChatCalendar> {
  try {
    const owner = await db.user.findUnique({ where: { id: ownerId }, select: { email: true } });
    if (!owner || !isCalendarOwnerEmail(owner.email)) return EMPTY_CHAT_CALENDAR;
    const view = await loadCalendarView(db, ownerId, now, timeZone);
    return chatCalendarFrom(view, now, timeZone);
  } catch {
    return EMPTY_CHAT_CALENDAR;
  }
}
