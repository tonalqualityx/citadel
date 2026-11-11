/**
 * Home screen Slice 10a: today's calendar as rows of a time and a who. Pure over the events,
 * his 4d booked ids and each event's match label (match.ts). Nothing else reaches a row.
 */

import { CAL } from './rules';
import { clockLabel, dayBounds, zonedParts } from './clock';
import { dayWindow, eventKind, isDeclined, minutesBetween, onDay, type CalEvent, type DayWindow, type EventKind } from './classify';
import { NOW_WORD, allDayLine, answerLabel, safeText, tomorrowTime, untilText } from './copy';
import type { HomeCalendarRow, HomeCalendarStrip } from './types';

/** What match.ts says about one event. */
export interface EventWho {
  /** The row's who, for a meeting. */
  label: string;
  /** A client, a lead or the title matched (the event is not a plain block of his own). */
  matched: boolean;
}

export interface StripInput {
  now: Date;
  timeZone: string;
  /** Events that may fall on today or tomorrow (the strip filters). */
  events: CalEvent[];
  bookedIds: ReadonlySet<string>;
  /** Keyed by CalendarEvent.id. */
  who: ReadonlyMap<string, EventWho>;
}

export interface Days {
  today: DayWindow;
  tomorrow: DayWindow;
}

export function daysFor(now: Date, timeZone: string): Days {
  const t = dayBounds(now, timeZone);
  const n = dayBounds(new Date(t.end.getTime() + 3_600_000), timeZone);
  return { today: dayWindow(t.start, t.end, timeZone), tomorrow: dayWindow(n.start, n.end, timeZone) };
}

export function emptyStrip(): HomeCalendarStrip {
  return { upcoming: [], later: [], earlier: [], all_day: null, tomorrow: null, soon: null };
}

/** The name in "Answer Jessica" (the title the 4d booker writes), or null. */
function answerName(title: string): string | null {
  const m = /^answer\s+(.{1,80})$/i.exec(title.trim());
  return m ? safeText(m[1]) || null : null;
}

export function kindOf(ev: CalEvent, input: Pick<StripInput, 'bookedIds' | 'who'>): EventKind {
  return eventKind(ev, { bookedIds: input.bookedIds, titleMatched: input.who.get(ev.id)?.matched === true });
}

function whoFor(ev: CalEvent, kind: EventKind, who: ReadonlyMap<string, EventWho>): string {
  if (kind === 'answer') return answerLabel(answerName(ev.title));
  if (kind === 'meeting') return who.get(ev.id)?.label || safeText(ev.title) || 'A meeting';
  return safeText(ev.title) || 'Busy';
}

function rowFor(ev: CalEvent, input: StripInput, time: string, kind: EventKind): HomeCalendarRow {
  let who = whoFor(ev, kind, input.who);
  if (kind === 'block' && minutesBetween(ev.starts_at, ev.ends_at) > CAL.longBlockMinutes) {
    who = `${who}, ${untilText(clockLabel(ev.ends_at, input.timeZone))}`;
  }
  return { id: ev.id, time, who, muted: kind !== 'meeting', openable: kind !== 'block' };
}

export function buildStrip(input: StripInput): HomeCalendarStrip {
  const { now, timeZone } = input;
  const days = daysFor(now, timeZone);
  const live = input.events.filter((e) => !isDeclined(e));

  const timed = live.filter((e) => !e.all_day && onDay(e, days.today)).sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
  const allDay = live.filter((e) => e.all_day && onDay(e, days.today));

  const earlier: HomeCalendarRow[] = [];
  const rest: { ev: CalEvent; row: HomeCalendarRow; kind: EventKind }[] = [];
  for (const ev of timed) {
    const kind = kindOf(ev, input);
    const ended = ev.ends_at <= now;
    const underway = ev.starts_at <= now && !ended;
    const row = rowFor(ev, input, underway ? NOW_WORD : clockLabel(ev.starts_at, timeZone), kind);
    if (ended) earlier.push(row);
    else rest.push({ ev, row, kind });
  }
  const upcoming = rest.slice(0, CAL.upcoming).map((r) => r.row);
  const later = rest.slice(CAL.upcoming).map((r) => r.row);

  let tomorrow: HomeCalendarRow | null = null;
  if (zonedParts(now, timeZone).h >= CAL.tomorrowHour) {
    const first = live
      .filter((e) => !e.all_day && onDay(e, days.tomorrow) && kindOf(e, input) === 'meeting')
      .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())[0];
    if (first) tomorrow = { ...rowFor(first, input, tomorrowTime(clockLabel(first.starts_at, timeZone)), 'meeting'), muted: true };
  }

  if (upcoming.length === 0 && !tomorrow) return emptyStrip();

  const soonItem = rest.find(
    (r) => r.kind === 'meeting' && (r.ev.starts_at <= now || (r.ev.starts_at.getTime() - now.getTime()) / 60_000 <= CAL.soonMinutes),
  );
  const soon = soonItem
    ? { ...soonItem.row, time: soonItem.ev.starts_at <= now ? NOW_WORD : clockLabel(soonItem.ev.starts_at, timeZone), muted: false }
    : null;

  return { upcoming, later, earlier, all_day: allDayLine(allDay.map((e) => e.title)), tomorrow, soon };
}

/** Today's events the strip would consider, for callers that need the same filter (drawer id check, chat). */
export function eventsInView(events: CalEvent[], now: Date, timeZone: string): CalEvent[] {
  const days = daysFor(now, timeZone);
  return events.filter((e) => !isDeclined(e) && (onDay(e, days.today) || onDay(e, days.tomorrow)));
}

