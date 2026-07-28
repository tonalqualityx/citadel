'use client';

import * as React from 'react';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { TodayCalendarMeeting } from '@/lib/hooks/use-today';
import { CalendarEventPopover } from './CalendarEventPopover';
import { formatMeetingRange } from './calendar-event-popover-logic';
import {
  layoutMeetingBlocks,
  layoutBufferBlocks,
  layoutPrepBlocks,
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
  // Clarity Phase 7 (P2, spec G3; repair 2026-07-27) — the timeline dedup: meeting ids
  // that have a Today pick linked to them (TodayPick.calendar_event_id). That meeting's
  // own chip renders "styled as linked" (a small link glyph) instead of a separate block —
  // the ONLY way an unscheduled/uncalendared pick may appear on this clock at all. There is
  // deliberately no `focusLabels` prop anymore: fabricating a time slot for a pick with no
  // real calendar_event_id (spreading it proportionally across the day's open runway) was
  // the actual "fake times" bug Mike flagged — the timeline is a clock, not a to-do list.
  linkedMeetingIds?: Set<string>;
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
  linkedMeetingIds,
  nowMs,
  meetingMinutes,
  dueTasksCount,
}: TimeShapeProps) {
  // Clarity Phase 8 (composition) — clock-strip/track events are clickable context cards
  // (Mike 07-28). Self-contained: TimeShape owns which meeting's popover (if any) is open
  // rather than threading state through every caller (TodaySection today, PlanView later) —
  // this widget already owns its own layout math, so it's the natural owner of "which block
  // is expanded" too.
  const [openMeetingId, setOpenMeetingId] = React.useState<string | null>(null);
  const meetingById = React.useMemo(() => new Map(meetings.map((m) => [m.id, m])), [meetings]);

  const window = getTimeShapeWindow(date, timezone, DAY_TRACK_START_HOUR, DAY_TRACK_END_HOUR);

  const meetingBlocks = layoutMeetingBlocks(meetings, window);
  // Clarity Phase 3b — every meeting costs a 15-minute recovery buffer after it ends
  // (Mike-directed: attention takes that break whether planned or not). Rendered as the
  // meeting's low-intensity "shadow".
  const bufferBlocks = layoutBufferBlocks(meetings, window);
  // Clarity Phase 5 — every meeting also costs a 20-minute prep window before it starts
  // (Mike-directed: same "attention takes it whether planned or not" reasoning as the
  // trailing buffer).
  const prepBlocks = layoutPrepBlocks(meetings, window);
  const nowPercent = computeNowLinePercent(nowMs, window);
  const fill = dayCapacityFillPercent(meetingMinutes, dueTasksCount);
  const overCap = isDayOverCapacity(fill);

  return (
    <div
      className={cn(
        // Clarity Phase 8 (composition) — overflow was `hidden`; changed to `visible` so a
        // meeting block's popover (an absolutely-positioned child) isn't clipped by the
        // track's own rounded border. Blocks are laid out within [0,100]% of the window by
        // construction (see layoutMeetingBlocks), so this doesn't reintroduce visible
        // spillover of the blocks themselves.
        'relative h-16 overflow-visible rounded-lg border bg-surface',
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

      {meetingBlocks.map((b) => {
        // Clarity Phase 7 (P2, spec G3) — this meeting has a Today pick linked to it
        // (same commitment); it renders as the ONE merged chip instead of a duplicate.
        const isLinked = linkedMeetingIds?.has(b.id) ?? false;
        const meeting = meetingById.get(b.id);
        return (
          <div
            key={b.id}
            className="absolute top-5 h-9"
            style={{ left: `${b.leftPercent}%`, width: `${b.widthPercent}%` }}
            data-testid="time-shape-block"
            data-kind="meeting"
            data-linked={isLinked || undefined}
          >
            <button
              type="button"
              onClick={() => meeting && setOpenMeetingId((v) => (v === b.id ? null : b.id))}
              title={meeting ? `${meeting.title} · ${formatMeetingRange(meeting.start, meeting.end, timezone)}` : b.label}
              className={cn(
                'flex h-full w-full items-center overflow-hidden rounded-md border px-1.5 py-0.5 text-[0.65rem] font-semibold transition-opacity hover:opacity-80',
                isLinked && 'ring-1 ring-inset ring-[color:var(--accent)]'
              )}
              style={{
                backgroundColor: 'var(--error-subtle)',
                borderColor: 'var(--error)',
                color: 'var(--error)',
              }}
              data-testid="time-shape-meeting-trigger"
            >
              <span className="flex items-center gap-0.5 truncate">
                {isLinked && <Link2 className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />}
                <span className="truncate">{b.label}</span>
              </span>
            </button>
            {meeting && (
              <CalendarEventPopover
                meeting={meeting}
                timezone={timezone}
                open={openMeetingId === b.id}
                onClose={() => setOpenMeetingId(null)}
              />
            )}
          </div>
        );
      })}

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
