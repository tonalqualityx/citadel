// Clarity Phase 3 — The Oracle Face: the Today time-shape track. Pure, dependency-free
// layout math (no React, no fetch) so block placement, the now-line, and the capacity
// encoding are unit-testable without rendering anything — same discipline as
// components/domain/oracle/oracle-logic.ts.
//
// "One capacity encoding" per the mockup's own design note: blue = chosen focus, gray =
// fixed events, gold = packed/over-cap — and the SAME fill/packed math backs the day track
// AND the week strip (see dayCapacityFillPercent/isDayOverCapacity below), never two
// competing implementations.

import { getStartOfDateStringForTimezone } from '@/lib/utils/time';

export interface TimeWindow {
  start: Date;
  end: Date;
}

/**
 * Clarity Phase 3d bug fix: the time-shape day track's display [start,end) window,
 * anchored to `startHour`/`endHour` LOCAL WALL-CLOCK hours in `timezone` — not UTC.
 * This is the actual fix for "a 9am ET meeting renders at 13:00": the window used to
 * be built with a literal `T08:00:00.000Z`/`T18:00:00.000Z` (UTC) suffix even though
 * the hour-axis labels ("8a"..."6p") are wall-clock hours, so every block's position
 * was off by whatever the timezone's UTC offset happened to be.
 *
 * Adding whole hours in milliseconds from a correctly-computed local-midnight anchor
 * is exact for a normal 8am-6pm window — the one known edge case (a DST transition,
 * which in the US always lands at 2am local, i.e. INSIDE a midnight-anchored 0-8h
 * span) would shift this window's boundary by an hour on the ~2 days/year that
 * happens, which is an accepted, documented simplification, not a silent bug: it's
 * outside this task's scope (getDayBoundsForTimezone below is not subject to it, since
 * a full [midnight, next-midnight) span is correct BY DEFINITION regardless of how
 * many real hours it spans on a transition day).
 */
export function getTimeShapeWindow(
  dateStr: string,
  timezone: string,
  startHour: number,
  endHour: number
): TimeWindow {
  const midnight = getStartOfDateStringForTimezone(dateStr, timezone);
  return {
    start: new Date(midnight.getTime() + startHour * 60 * 60_000),
    end: new Date(midnight.getTime() + endHour * 60 * 60_000),
  };
}

export interface MeetingInput {
  id: string;
  title: string;
  start: string | Date;
  end: string | Date;
}

export interface TimeShapeBlock {
  id: string;
  kind: 'meeting' | 'focus' | 'buffer';
  label: string;
  leftPercent: number;
  widthPercent: number;
}

const MIN_WIDTH_PERCENT = 1.5;

function toMs(d: string | Date): number {
  return typeof d === 'string' ? new Date(d).getTime() : d.getTime();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Maps a [start,end] instant onto a window as a left/width percent pair, clipping to the
 * window's bounds. Returns null when the interval doesn't overlap the window at all (the
 * caller simply omits it — empty track = open runway, never a zero-width ghost block).
 */
export function computeBlockLayout(
  interval: { start: string | Date; end: string | Date },
  window: TimeWindow
): { leftPercent: number; widthPercent: number } | null {
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();
  const windowSpan = windowEndMs - windowStartMs;
  if (windowSpan <= 0) return null;

  const startMs = clamp(toMs(interval.start), windowStartMs, windowEndMs);
  const endMs = clamp(toMs(interval.end), windowStartMs, windowEndMs);
  if (endMs <= windowStartMs || startMs >= windowEndMs || endMs <= startMs) return null;

  const leftPercent = ((startMs - windowStartMs) / windowSpan) * 100;
  const widthPercent = Math.max(((endMs - startMs) / windowSpan) * 100, MIN_WIDTH_PERCENT);

  return { leftPercent: clamp(leftPercent, 0, 100), widthPercent: clamp(widthPercent, 0, 100 - leftPercent) };
}

/** The now-line's left-percent position within the window, or null once "now" falls
 *  outside it (no now-line rendered before the window opens or after it closes). */
export function computeNowLinePercent(nowMs: number, window: TimeWindow): number | null {
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();
  const windowSpan = windowEndMs - windowStartMs;
  if (windowSpan <= 0) return null;
  if (nowMs < windowStartMs || nowMs > windowEndMs) return null;
  return clamp(((nowMs - windowStartMs) / windowSpan) * 100, 0, 100);
}

/** The red-family meeting blocks (Mike-directed exception to the no-red rule — see
 *  TimeShape.tsx's comment), clipped to the window, in start order. */
export function layoutMeetingBlocks(meetings: MeetingInput[], window: TimeWindow): TimeShapeBlock[] {
  const blocks: TimeShapeBlock[] = [];
  for (const m of meetings) {
    const layout = computeBlockLayout({ start: m.start, end: m.end }, window);
    if (!layout) continue;
    blocks.push({ id: m.id, kind: 'meeting', label: m.title, ...layout });
  }
  return blocks.sort((a, b) => a.leftPercent - b.leftPercent);
}

// ============================================
// Recovery buffer (Mike-directed, 2026-07-21) — every timed meeting costs 15 minutes of
// attention AFTER it ends too, whether or not anything else is scheduled. Single source
// for both the server-side committed-load sum (route.ts imports sumCommittedMinutesWithBuffer
// below — this file has no React/fetch, same "pure, dependency-free" discipline as the rest
// of it, so it's safe to import from a server route) and the client-side buffer/gap layout.
// All-day events never reach these functions — the calendar route excludes them from
// `meetings` before this file ever sees them, so there's no all-day special-case here.
// ============================================

export const MEETING_RECOVERY_MINUTES = 15;

/**
 * The trailing buffer's end instant after a single meeting: meetingEnd + recoveryMinutes,
 * truncated at the next meeting's start if that falls inside the recovery window (never
 * double-counted, never pushes a subsequent event). Returns null when there's no buffer
 * left at all (a next meeting starting at-or-before this meeting's own end — fully
 * truncated, e.g. back-to-back or overlapping).
 */
export function computeMeetingBufferEnd(
  meetingEndMs: number,
  nextMeetingStartMs: number | null,
  recoveryMinutes: number = MEETING_RECOVERY_MINUTES
): number | null {
  const uncappedEnd = meetingEndMs + recoveryMinutes * 60_000;
  const bufferEndMs = nextMeetingStartMs !== null ? Math.min(uncappedEnd, nextMeetingStartMs) : uncappedEnd;
  return bufferEndMs > meetingEndMs ? bufferEndMs : null;
}

/**
 * The visual buffer segments trailing each meeting, clipped to the window (a buffer
 * running past the visible day's end is simply clipped shorter by computeBlockLayout, same
 * as any other interval — no special-casing needed). Meetings are sorted by start
 * internally so "next meeting" truncation is correct regardless of input order.
 */
export function layoutBufferBlocks(
  meetings: MeetingInput[],
  window: TimeWindow,
  recoveryMinutes: number = MEETING_RECOVERY_MINUTES
): TimeShapeBlock[] {
  const sorted = [...meetings].sort((a, b) => toMs(a.start) - toMs(b.start));
  const blocks: TimeShapeBlock[] = [];

  sorted.forEach((m, i) => {
    const endMs = toMs(m.end);
    const nextStartMs = i + 1 < sorted.length ? toMs(sorted[i + 1].start) : null;
    const bufferEndMs = computeMeetingBufferEnd(endMs, nextStartMs, recoveryMinutes);
    if (bufferEndMs === null) return; // fully truncated — nothing to render

    const layout = computeBlockLayout({ start: new Date(endMs), end: new Date(bufferEndMs) }, window);
    if (!layout) return;
    blocks.push({ id: `buffer-${m.id}`, kind: 'buffer', label: '', ...layout });
  });

  return blocks;
}

/**
 * Per-day committed-load minutes: real meeting duration + its truncated recovery buffer,
 * summed across the day's timed meetings. Backs both the day track's fill/over-cap tint
 * and the week strip's packed-day tint (via dayCapacityFillPercent below) — server-side
 * callers (the /api/today/calendar route, for `meeting_minutes`) and this file share this
 * one implementation so the two never drift.
 */
export function sumCommittedMinutesWithBuffer(
  meetings: MeetingInput[],
  recoveryMinutes: number = MEETING_RECOVERY_MINUTES
): number {
  const sorted = [...meetings]
    .map((m) => ({ startMs: toMs(m.start), endMs: toMs(m.end) }))
    .sort((a, b) => a.startMs - b.startMs);

  let totalMs = 0;
  sorted.forEach((m, i) => {
    const duration = Math.max(0, m.endMs - m.startMs);
    const nextStartMs = i + 1 < sorted.length ? sorted[i + 1].startMs : null;
    const bufferEndMs = computeMeetingBufferEnd(m.endMs, nextStartMs, recoveryMinutes);
    const bufferMs = bufferEndMs !== null ? bufferEndMs - m.endMs : 0;
    totalMs += duration + bufferMs;
  });

  return totalMs / 60_000;
}

interface Gap {
  startMs: number;
  endMs: number;
}

/** The open-runway gaps left in the window once occupied blocks are carved out.
 *  `occupiedBlocks` is meeting blocks AND their trailing recovery-buffer blocks combined
 *  (see layoutBufferBlocks below) — the merge-overlap step below naturally treats a
 *  meeting immediately followed by its buffer (or two back-to-back meetings' buffers) as
 *  one continuous occupied span, so a focus block can never land inside a buffer. */
function freeGaps(occupiedBlocks: TimeShapeBlock[], window: TimeWindow): Gap[] {
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();
  const windowSpan = windowEndMs - windowStartMs;
  if (windowSpan <= 0) return [];

  // Convert occupied blocks (already in window-relative percent) back to absolute ms
  // boundaries, merged in case of overlap, then invert to get the gaps between them.
  const sorted = [...occupiedBlocks].sort((a, b) => a.leftPercent - b.leftPercent);
  const merged: Gap[] = [];
  for (const b of sorted) {
    const startMs = windowStartMs + (b.leftPercent / 100) * windowSpan;
    const endMs = startMs + (b.widthPercent / 100) * windowSpan;
    const last = merged[merged.length - 1];
    if (last && startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, endMs);
    } else {
      merged.push({ startMs, endMs });
    }
  }

  const gaps: Gap[] = [];
  let cursor = windowStartMs;
  for (const m of merged) {
    if (m.startMs > cursor) gaps.push({ startMs: cursor, endMs: m.startMs });
    cursor = Math.max(cursor, m.endMs);
  }
  if (cursor < windowEndMs) gaps.push({ startMs: cursor, endMs: windowEndMs });

  return gaps.filter((g) => g.endMs > g.startMs);
}

/**
 * Places the day's focus (Today pick) blocks into the open runway between occupied
 * blocks (meetings + their trailing recovery buffers — see layoutBufferBlocks), in
 * `labels` order. Today picks carry no stored duration (the binding schema has none), so
 * this is a deliberate, documented simplification: each gap gets a number of slots
 * proportional to its share of total free time (largest remainder absorbs any rounding),
 * and within a gap the slots split it evenly — never spilling across a meeting or buffer
 * boundary. If there's no free runway at all, focus blocks are simply omitted (never
 * overlaid on a meeting or its buffer) — a fully-booked day just shows its meetings.
 */
export function layoutFocusBlocks(
  labels: string[],
  occupiedBlocks: TimeShapeBlock[],
  window: TimeWindow
): TimeShapeBlock[] {
  if (labels.length === 0) return [];
  const gaps = freeGaps(occupiedBlocks, window);
  if (gaps.length === 0) return [];

  const totalFree = gaps.reduce((sum, g) => sum + (g.endMs - g.startMs), 0);
  if (totalFree <= 0) return [];

  // Proportional slot count per gap (largest-remainder rounding so the slots sum exactly
  // to labels.length).
  const raw = gaps.map((g) => (labels.length * (g.endMs - g.startMs)) / totalFree);
  const floors = raw.map(Math.floor);
  let remaining = labels.length - floors.reduce((a, b) => a + b, 0);
  const remainders = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((a, b) => b.frac - a.frac);
  const slotsPerGap = [...floors];
  for (let k = 0; k < remaining; k++) {
    slotsPerGap[remainders[k % remainders.length].i] += 1;
  }
  remaining = 0;

  const windowStartMs = window.start.getTime();
  const windowSpan = window.end.getTime() - windowStartMs;
  const blocks: TimeShapeBlock[] = [];
  let labelIdx = 0;

  gaps.forEach((gap, gapIdx) => {
    const slots = slotsPerGap[gapIdx];
    if (slots <= 0) return;
    const gapSpan = gap.endMs - gap.startMs;
    const slotSpan = gapSpan / slots;
    for (let s = 0; s < slots && labelIdx < labels.length; s++, labelIdx++) {
      const startMs = gap.startMs + s * slotSpan;
      const endMs = startMs + slotSpan;
      const leftPercent = clamp(((startMs - windowStartMs) / windowSpan) * 100, 0, 100);
      const widthPercent = clamp(((endMs - startMs) / windowSpan) * 100, MIN_WIDTH_PERCENT, 100 - leftPercent);
      blocks.push({
        id: `focus-${labelIdx}`,
        kind: 'focus',
        label: labels[labelIdx],
        leftPercent,
        widthPercent,
      });
    }
  });

  return blocks;
}

// ============================================
// Single capacity encoding (day track + week strip)
// ============================================

export const WORKDAY_MINUTES = 480; // 8 hours
export const MINUTES_PER_DUE_TASK = 60; // heuristic weight for an open-due task's day cost
export const DAY_CAPACITY_WARNING_THRESHOLD = 0.8; // >=80% filled reads as packed/over-cap

/** Fraction (0..1) of a workday's capacity already spoken for. Shared by the day track's
 *  over-cap tint and the week strip's packed days — one encoding, one implementation. */
export function dayCapacityFillPercent(
  meetingMinutes: number,
  dueTasksCount: number,
  workdayMinutes: number = WORKDAY_MINUTES
): number {
  if (workdayMinutes <= 0) return 0;
  const committed = meetingMinutes + dueTasksCount * MINUTES_PER_DUE_TASK;
  return clamp(committed / workdayMinutes, 0, 1);
}

export function isDayOverCapacity(fillPercent: number): boolean {
  return fillPercent >= DAY_CAPACITY_WARNING_THRESHOLD;
}
