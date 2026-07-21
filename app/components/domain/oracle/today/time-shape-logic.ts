// Clarity Phase 3 — The Oracle Face: the Today time-shape track. Pure, dependency-free
// layout math (no React, no fetch) so block placement, the now-line, and the capacity
// encoding are unit-testable without rendering anything — same discipline as
// components/domain/oracle/oracle-logic.ts.
//
// "One capacity encoding" per the mockup's own design note: blue = chosen focus, gray =
// fixed events, gold = packed/over-cap — and the SAME fill/packed math backs the day track
// AND the week strip (see dayCapacityFillPercent/isDayOverCapacity below), never two
// competing implementations.

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface MeetingInput {
  id: string;
  title: string;
  start: string | Date;
  end: string | Date;
}

export interface TimeShapeBlock {
  id: string;
  kind: 'meeting' | 'focus';
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

/** The gray meeting blocks, clipped to the window, in start order. */
export function layoutMeetingBlocks(meetings: MeetingInput[], window: TimeWindow): TimeShapeBlock[] {
  const blocks: TimeShapeBlock[] = [];
  for (const m of meetings) {
    const layout = computeBlockLayout({ start: m.start, end: m.end }, window);
    if (!layout) continue;
    blocks.push({ id: m.id, kind: 'meeting', label: m.title, ...layout });
  }
  return blocks.sort((a, b) => a.leftPercent - b.leftPercent);
}

interface Gap {
  startMs: number;
  endMs: number;
}

/** The open-runway gaps left in the window once meeting blocks are carved out. */
function freeGaps(meetingBlocks: TimeShapeBlock[], window: TimeWindow): Gap[] {
  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();
  const windowSpan = windowEndMs - windowStartMs;
  if (windowSpan <= 0) return [];

  // Convert meeting blocks (already in window-relative percent) back to absolute ms
  // boundaries, merged in case of overlap, then invert to get the gaps between them.
  const sorted = [...meetingBlocks].sort((a, b) => a.leftPercent - b.leftPercent);
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
 * Places the day's focus (Today pick) blocks into the open runway between meetings, in
 * `labels` order. Today picks carry no stored duration (the binding schema has none), so
 * this is a deliberate, documented simplification: each gap gets a number of slots
 * proportional to its share of total free time (largest remainder absorbs any rounding),
 * and within a gap the slots split it evenly — never spilling across a meeting boundary.
 * If there's no free runway at all, focus blocks are simply omitted (never overlaid on a
 * meeting) — a fully-booked day just shows its meetings.
 */
export function layoutFocusBlocks(
  labels: string[],
  meetingBlocks: TimeShapeBlock[],
  window: TimeWindow
): TimeShapeBlock[] {
  if (labels.length === 0) return [];
  const gaps = freeGaps(meetingBlocks, window);
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
