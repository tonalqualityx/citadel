// Clarity Phase 8 (composition) — pure helpers for the calendar event context popover
// (Mike 07-28: "calendar events are clickable context cards"). No React, no Date.now() —
// every function takes its inputs explicitly so it's unit-testable without a clock or DOM.
import type { CalendarAttendee, TodayCalendarMeeting } from '@/lib/hooks/use-today';

export type LinkSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string };

// Deliberately conservative: bare http(s) URLs only. Descriptions are attacker-controllable
// (any external meeting organizer) — this NEVER renders raw HTML (no dangerouslySetInnerHTML
// anywhere in the popover); an HTML-formatted description renders its tags as literal text,
// which is the correct trade-off, not a bug to "fix" later.
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

/** Splits plain text into text/link runs so the popover can render real anchors for bare
 *  URLs without ever parsing/rendering HTML. */
export function linkifySegments(text: string): LinkSegment[] {
  if (!text) return [];
  const segments: LinkSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ kind: 'text', value: text.slice(lastIndex, start) });
    segments.push({ kind: 'link', value: match[0] });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ kind: 'text', value: text.slice(lastIndex) });
  return segments;
}

const KNOWN_RESPONSE_LABELS: Record<string, string> = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
};

/** Google's response_status is passed through untranslated end to end (see calendar-sync
 *  route/registry); this is the ONE place it's mapped to a display label — any value this
 *  map doesn't recognize (needsAction, null, or a future Google value) reads as "no reply",
 *  never a raw enum string leaking into the UI. */
export function attendeeResponseLabel(status: string | null | undefined): string {
  if (!status) return 'no reply';
  return KNOWN_RESPONSE_LABELS[status] ?? 'no reply';
}

/** The Join button's target — only when meet_url is a real https URL. A bare truthy check
 *  isn't enough: a malformed/blank value must never render a clickable-looking dead link. */
export function joinUrl(meeting: Pick<TodayCalendarMeeting, 'meet_url'>): string | null {
  const url = meeting.meet_url;
  if (!url || !url.startsWith('https://')) return null;
  return url;
}

/** "2:00 – 2:30 PM · 30 min" (drops the redundant leading AM/PM when both ends share one)
 *  or "11:45 AM – 12:15 PM · 30 min" (keeps both when they differ) — explicit timeZone
 *  always (the exact bug class Phase 3d fixed twice; never `toLocaleTimeString([])`). */
export function formatMeetingRange(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  const startStr = fmt(start);
  const endStr = fmt(end);
  const startPeriodMatch = startStr.match(/\s(AM|PM)$/);
  const endPeriodMatch = endStr.match(/\s(AM|PM)$/);
  const displayStart =
    startPeriodMatch && endPeriodMatch && startPeriodMatch[1] === endPeriodMatch[1]
      ? startStr.slice(0, startPeriodMatch.index)
      : startStr;
  return `${displayStart} – ${endStr} · ${minutes} min`;
}

export interface AttendeeSummary {
  accepted: number;
  declined: number;
  tentative: number;
  pending: number;
  total: number;
}

/** Counts by response bucket — "no reply" (declined via attendeeResponseLabel) folds
 *  needsAction/null/unknown into `pending`. */
export function attendeeSummary(attendees: CalendarAttendee[] | null | undefined): AttendeeSummary {
  const list = attendees ?? [];
  const summary: AttendeeSummary = { accepted: 0, declined: 0, tentative: 0, pending: 0, total: list.length };
  for (const a of list) {
    const label = attendeeResponseLabel(a.response_status);
    if (label === 'accepted') summary.accepted++;
    else if (label === 'declined') summary.declined++;
    else if (label === 'tentative') summary.tentative++;
    else summary.pending++;
  }
  return summary;
}
