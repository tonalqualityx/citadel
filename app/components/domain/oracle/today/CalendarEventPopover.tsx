'use client';

import * as React from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { TodayCalendarMeeting } from '@/lib/hooks/use-today';
import {
  linkifySegments,
  attendeeResponseLabel,
  joinUrl,
  formatMeetingRange,
  attendeeSummary,
} from './calendar-event-popover-logic';

interface CalendarEventPopoverProps {
  meeting: TodayCalendarMeeting;
  timezone: string;
  open: boolean;
  onClose: () => void;
  anchorClassName?: string;
}

const RESPONSE_COLOR: Record<string, string> = {
  accepted: 'text-[color:var(--success)]',
  declined: 'text-text-muted',
};

const MAX_ATTENDEES_SHOWN = 8;

// Clarity Phase 8 (composition) — calendar events are clickable context cards (Mike 07-28).
// Pattern copied from CronHealthLine's CronChip popover (a local absolutely-positioned panel,
// no portal) rather than the Radix Dialog primitive: components/ui/drawer.tsx's forceMount
// Dialog layers already caused a documented Escape-routing bug (see IntakeDrawer.tsx) — a
// third permanently-mounted dialog layer on this page isn't worth reintroducing that class
// of bug for a lightweight context popover.
export function CalendarEventPopover({ meeting, timezone, open, onClose, anchorClassName }: CalendarEventPopoverProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  const join = joinUrl(meeting);
  const summary = attendeeSummary(meeting.attendees);
  const shownAttendees = (meeting.attendees ?? []).slice(0, MAX_ATTENDEES_SHOWN);
  const overflowCount = (meeting.attendees?.length ?? 0) - shownAttendees.length;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${meeting.title} details`}
      className={cn(
        'absolute z-20 mt-1 w-80 rounded-md border border-border-warm bg-surface p-3 text-left shadow-md',
        anchorClassName
      )}
      data-testid="calendar-event-popover"
    >
      <p className="text-sm font-semibold text-text-main">{meeting.title}</p>
      <p className="mt-0.5 text-xs text-text-sub">{formatMeetingRange(meeting.start, meeting.end, timezone)}</p>

      {meeting.location && (
        <p className="mt-2 flex items-center gap-1 text-xs text-text-sub">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
          {meeting.location}
        </p>
      )}

      {meeting.description && (
        <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-text-sub">
          {linkifySegments(meeting.description).map((seg, i) =>
            seg.kind === 'link' ? (
              <a
                key={i}
                href={seg.value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--accent)] underline"
              >
                {seg.value}
              </a>
            ) : (
              <span key={i}>{seg.value}</span>
            )
          )}
        </div>
      )}

      {meeting.attendees && meeting.attendees.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-text-sub">
            {summary.accepted} of {summary.total} accepted
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {shownAttendees.map((a) => (
              <li
                key={a.email}
                className="flex items-center justify-between gap-2 text-xs"
                data-testid="calendar-event-attendee"
              >
                <span className="truncate text-text-main">{a.display_name ?? a.email}</span>
                <span className={cn('shrink-0', RESPONSE_COLOR[attendeeResponseLabel(a.response_status)] ?? 'text-text-sub')}>
                  {attendeeResponseLabel(a.response_status)}
                </span>
              </li>
            ))}
          </ul>
          {overflowCount > 0 && (
            <p className="mt-1 text-xs text-text-sub">+ {overflowCount} more</p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {join && (
          <Button asChild variant="primary" size="sm" data-testid="calendar-event-join">
            <a href={join} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Join
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
