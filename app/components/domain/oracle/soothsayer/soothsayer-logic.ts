// Clarity Phase 5 — The Soothsayer. Pure, dependency-free helpers (no React, no fetch) for
// the day-column labels and the one-line meeting-load summary — same discipline as
// oracle-logic.ts and time-shape-logic.ts.
import { formatDurationMinutes } from '@/lib/utils/time';

/** True when `dateStr` is the Soothsayer's own "today" (the first of its 7 days) — drives
 *  the today column's accent border. */
export function isSoothsayerToday(dateStr: string, todayDateStr: string): boolean {
  return dateStr === todayDateStr;
}

/** "Today" for the anchor day, else a short weekday + date ("Wed 7/23") — dateStr is
 *  already a resolved calendar-date string, so this only ever formats for DISPLAY, never
 *  re-resolves a timezone. */
export function dayColumnLabel(dateStr: string, todayDateStr: string): string {
  if (isSoothsayerToday(dateStr, todayDateStr)) return 'Today';
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}

/** The day column's one-line meeting load: "N meetings · Xh Ym" (buffers/prep already
 *  folded into meeting_minutes server-side — see /api/oracle/soothsayer's use of
 *  sumCommittedMinutesWithBuffer). "No meetings" reads as open runway, not a gap to fill. */
export function meetingLoadLine(meetingCount: number, meetingMinutes: number): string {
  if (meetingCount === 0) return 'No meetings';
  const noun = meetingCount === 1 ? 'meeting' : 'meetings';
  return `${meetingCount} ${noun} · ${formatDurationMinutes(meetingMinutes)}`;
}
