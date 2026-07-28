'use client';

import * as React from 'react';
import { Tooltip } from '@/components/ui/tooltip';
import { CalendarEventPopover } from '@/components/domain/oracle/today/CalendarEventPopover';
import { formatMeetingRange } from '@/components/domain/oracle/today/calendar-event-popover-logic';
import type { TodayCalendarMeeting } from '@/lib/hooks/use-today';

interface ClockStripProps {
  todayLabel: string; // "Today · Mon, Jul 27"
  meetings: TodayCalendarMeeting[];
  timezone: string;
}

// Clarity Phase 8 (composition) — Work mode's clock strip: meetings-only (no due-task
// counts, no capacity fill — that detail lives in Plan's week strip). Each meeting is
// clickable -> the same calendar-context popover TimeShape uses.
export function ClockStrip({ todayLabel, meetings, timezone }: ClockStripProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-warm px-1 pb-2 text-sm text-text-sub" data-testid="clock-strip">
      <span className="text-text-muted">{todayLabel}</span>
      {meetings.map((m) => (
        <div key={m.id} className="relative">
          <Tooltip content={`${m.title} · ${formatMeetingRange(m.start, m.end, timezone)}`}>
            <button
              type="button"
              onClick={() => setOpenId((v) => (v === m.id ? null : m.id))}
              className="flex items-center gap-1.5 rounded-full border border-border-warm px-2 py-0.5 text-text-main hover:border-[color:var(--accent)]"
              data-testid="clock-strip-meeting"
            >
              {formatMeetingRange(m.start, m.end, timezone).split(' · ')[0]} — {m.title}
            </button>
          </Tooltip>
          <CalendarEventPopover meeting={m} timezone={timezone} open={openId === m.id} onClose={() => setOpenId(null)} />
        </div>
      ))}
    </div>
  );
}
