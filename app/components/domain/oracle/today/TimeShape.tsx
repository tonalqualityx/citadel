'use client';

import { cn } from '@/lib/utils/cn';
import type { TodayCalendarMeeting } from '@/lib/hooks/use-today';
import {
  layoutMeetingBlocks,
  layoutBufferBlocks,
  layoutPrepBlocks,
  layoutFocusBlocks,
  computeNowLinePercent,
  dayCapacityFillPercent,
  isDayOverCapacity,
  getTimeShapeWindow,
} from './time-shape-logic';

const DAY_TRACK_START_HOUR = 8;
const DAY_TRACK_END_HOUR = 18;
const HOUR_MARKS = Array.from(
  { length: DAY_TRACK_END_HOUR - DAY_TRACK_START_HOUR + 1 },
  (_, i) => DAY_TRACK_START_HOUR + i
);

interface TimeShapeProps {
  date: string; // YYYY-MM-DD, in `timezone` below (Clarity Phase 3d — was UTC)
  // Clarity Phase 3d — the resolved requester's IANA timezone (from the /api/today/
  // calendar response). The display window is anchored to LOCAL wall-clock hours in
  // this zone, never UTC — the fix for "a 9am ET meeting shows at 13:00".
  timezone: string;
  meetings: TodayCalendarMeeting[];
  focusLabels: string[]; // uncompleted picks, in sort order
  nowMs: number;
  meetingMinutes: number;
  dueTasksCount: number;
}

function hourLabel(hour: number): string {
  if (hour === 12) return '12p';
  if (hour > 12) return `${hour - 12}`;
  return `${hour}a`;
}

// The day's real contours: calendar events (red-family, labeled — see the exception note
// below) and chosen focus blocks (blue, labeled) on one track. Empty track = open runway.
// Over-cap days tint the strip with the same warning encoding as the week strip — never red
// for THAT signal (evidence-bound: no red anywhere in the Oracle for capacity/aging/overdue).
//
// Clarity Phase 3b exception (Mike-directed, binding): meeting blocks themselves use the
// error/red token family, not neutral gray. The evidence-bound "no red" rule from the
// 2026-07-21 ADHD motivation research targets overdue/aging DISPLAYS (a red "3 days late"
// chip is punitive and demotivating) — it was never meant to cover a fixed, already-on-the-
// calendar commitment. Mike explicitly chose red/orange for meetings; this is a deliberate,
// separate design decision, not a regression of the aging/capacity rule above.
export function TimeShape({
  date,
  timezone,
  meetings,
  focusLabels,
  nowMs,
  meetingMinutes,
  dueTasksCount,
}: TimeShapeProps) {
  const window = getTimeShapeWindow(date, timezone, DAY_TRACK_START_HOUR, DAY_TRACK_END_HOUR);

  const meetingBlocks = layoutMeetingBlocks(meetings, window);
  // Clarity Phase 3b — every meeting costs a 15-minute recovery buffer after it ends
  // (Mike-directed: attention takes that break whether planned or not). Rendered as the
  // meeting's low-intensity "shadow"; also carved out of the runway so focus picks never
  // get laid into it (see layoutFocusBlocks' occupiedBlocks param).
  const bufferBlocks = layoutBufferBlocks(meetings, window);
  // Clarity Phase 5 — every meeting also costs a 20-minute prep window before it starts
  // (Mike-directed: same "attention takes it whether planned or not" reasoning as the
  // trailing buffer). Also carved out of the runway so focus picks never land there.
  const prepBlocks = layoutPrepBlocks(meetings, window);
  const focusBlocks = layoutFocusBlocks(focusLabels, [...meetingBlocks, ...bufferBlocks, ...prepBlocks], window);
  const nowPercent = computeNowLinePercent(nowMs, window);
  const fill = dayCapacityFillPercent(meetingMinutes, dueTasksCount);
  const overCap = isDayOverCapacity(fill);

  return (
    <div
      className={cn(
        'relative h-16 overflow-hidden rounded-lg border bg-surface',
        overCap ? 'border-[color:var(--warning)]' : 'border-border-warm'
      )}
      data-testid="time-shape"
      data-over-cap={overCap || undefined}
    >
      <div className="absolute inset-0 flex">
        {HOUR_MARKS.map((h, i) => (
          <span
            key={h}
            className={cn(
              'flex-1 pl-1 pt-0.5 text-[0.6rem] text-text-sub',
              i > 0 && 'border-l border-background-light'
            )}
          >
            {hourLabel(h)}
          </span>
        ))}
      </div>

      {meetingBlocks.map((b) => (
        <div
          key={b.id}
          className="absolute top-5 h-9 overflow-hidden rounded-md border px-1.5 py-0.5 text-[0.65rem] font-semibold"
          style={{
            left: `${b.leftPercent}%`,
            width: `${b.widthPercent}%`,
            backgroundColor: 'var(--error-subtle)',
            borderColor: 'var(--error)',
            color: 'var(--error)',
          }}
          data-testid="time-shape-block"
          data-kind="meeting"
        >
          <span className="block truncate">{b.label}</span>
        </div>
      ))}

      {bufferBlocks.map((b) => (
        <div
          key={b.id}
          className="absolute top-5 h-9 overflow-hidden rounded-md"
          style={{
            left: `${b.leftPercent}%`,
            width: `${b.widthPercent}%`,
            backgroundColor: 'var(--error-subtle)',
            opacity: 0.45,
          }}
          data-testid="time-shape-block"
          data-kind="buffer"
          title="recovery buffer"
        />
      ))}

      {prepBlocks.map((b) => (
        <div
          key={b.id}
          className="absolute top-5 h-9 overflow-hidden rounded-md"
          style={{
            left: `${b.leftPercent}%`,
            width: `${b.widthPercent}%`,
            backgroundColor: 'var(--error-subtle)',
            opacity: 0.3,
          }}
          data-testid="time-shape-block"
          data-kind="prep"
          title="prep time"
        />
      ))}

      {focusBlocks.map((b) => (
        <div
          key={b.id}
          className="absolute top-5 h-9 overflow-hidden rounded-md border px-1.5 py-0.5 text-[0.65rem] font-semibold"
          style={{
            left: `${b.leftPercent}%`,
            width: `${b.widthPercent}%`,
            backgroundColor: 'var(--accent-subtle)',
            borderColor: 'var(--accent)',
            color: 'var(--accent)',
          }}
          data-testid="time-shape-block"
          data-kind="focus"
        >
          <span className="block truncate">{b.label}</span>
          <span className="block truncate text-[0.6rem] font-normal opacity-75">focus</span>
        </div>
      ))}

      {nowPercent !== null && (
        <div
          className="absolute inset-y-0 w-0.5 opacity-70"
          style={{ left: `${nowPercent}%`, backgroundColor: 'var(--text-muted)' }}
          data-testid="time-shape-now-line"
        >
          <span className="absolute left-1 top-0 text-[0.6rem] font-semibold text-text-sub">now</span>
        </div>
      )}
    </div>
  );
}
