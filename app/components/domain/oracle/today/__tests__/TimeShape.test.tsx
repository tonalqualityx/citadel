import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { TimeShape } from '../TimeShape';

const WINDOW_DATE = '2026-07-27';
const TZ = 'America/New_York';
const NOW = new Date('2026-07-27T13:00:00.000Z').getTime();

describe('TimeShape — timeline dedup (Clarity Phase 7 P2, spec G3)', () => {
  it('renders the meeting chip WITHOUT the linked styling when no pick is linked to it', () => {
    render(
      <TimeShape
        date={WINDOW_DATE}
        timezone={TZ}
        meetings={[{ id: 'gcal-1', title: 'Client call', start: '2026-07-27T13:00:00.000Z', end: '2026-07-27T13:30:00.000Z', description: null, meet_url: null, location: null, attendees: null }]}
        nowMs={NOW}
        meetingMinutes={30}
        dueTasksCount={0}
      />
    );

    const meetingBlock = document.querySelector('[data-testid="time-shape-block"][data-kind="meeting"]');
    expect(meetingBlock).not.toHaveAttribute('data-linked');
  });

  it('renders the meeting chip WITH the linked styling when its id is in linkedMeetingIds', () => {
    render(
      <TimeShape
        date={WINDOW_DATE}
        timezone={TZ}
        meetings={[{ id: 'gcal-1', title: 'Client call', start: '2026-07-27T13:00:00.000Z', end: '2026-07-27T13:30:00.000Z', description: null, meet_url: null, location: null, attendees: null }]}
        linkedMeetingIds={new Set(['gcal-1'])}
        nowMs={NOW}
        meetingMinutes={30}
        dueTasksCount={0}
      />
    );

    const meetingBlock = document.querySelector('[data-testid="time-shape-block"][data-kind="meeting"]');
    expect(meetingBlock).toHaveAttribute('data-linked', 'true');
  });
});

// Clarity Phase 7 (repair, 2026-07-27) — Mike's binding correction: the timeline is a
// clock, not a to-do list. It used to spread every unscheduled pick across the day's open
// runway as a fabricated "focus" block (a fake time that pick was never actually assigned).
// There is no longer any prop for that at all — the ONLY way anything unscheduled can
// appear here is via a rendered meeting's own "linked" styling above. These tests prove
// the fabrication path is actually gone, not just unused.
describe('TimeShape — no fabricated times (Clarity Phase 7 repair)', () => {
  it('renders the meeting (+ its buffer/prep shadows) but never a "focus" block for anything unscheduled', () => {
    render(
      <TimeShape
        date={WINDOW_DATE}
        timezone={TZ}
        meetings={[{ id: 'gcal-1', title: 'Client call', start: '2026-07-27T13:00:00.000Z', end: '2026-07-27T13:30:00.000Z', description: null, meet_url: null, location: null, attendees: null }]}
        linkedMeetingIds={new Set(['gcal-1'])}
        nowMs={NOW}
        meetingMinutes={30}
        dueTasksCount={0}
      />
    );

    expect(document.querySelector('[data-testid="time-shape-block"][data-kind="focus"]')).not.toBeInTheDocument();
    const kinds = screen.getAllByTestId('time-shape-block').map((el) => el.getAttribute('data-kind'));
    expect(kinds).toContain('meeting');
    expect(kinds).not.toContain('focus');
  });

  it('renders an empty (meeting-free) open runway with zero blocks — never a fabricated block to "fill" it', () => {
    render(
      <TimeShape
        date={WINDOW_DATE}
        timezone={TZ}
        meetings={[]}
        nowMs={NOW}
        meetingMinutes={0}
        dueTasksCount={0}
      />
    );

    expect(screen.queryAllByTestId('time-shape-block')).toHaveLength(0);
  });
});

// Clarity Phase 8 (composition) — calendar events are clickable context cards (Mike 07-28).
describe('TimeShape — clickable meeting context popover (Clarity Phase 8)', () => {
  const meetingWithContext = {
    id: 'gcal-ctx',
    title: 'BRIC board',
    start: '2026-07-27T13:00:00.000Z',
    end: '2026-07-27T13:30:00.000Z',
    description: 'Quarterly review',
    meet_url: 'https://meet.google.com/e2e-fixture',
    location: 'Springfield VT',
    attendees: [{ email: 'dan@example.com', display_name: 'Dan', response_status: 'accepted' }],
  };

  it('a meeting block wraps a real button (no dead click, G11)', () => {
    render(
      <TimeShape date={WINDOW_DATE} timezone={TZ} meetings={[meetingWithContext]} nowMs={NOW} meetingMinutes={30} dueTasksCount={0} />
    );
    expect(screen.getByTestId('time-shape-meeting-trigger').tagName).toBe('BUTTON');
    // The outer positioned wrapper (left/width, the element existing e2e position
    // assertions read .style.left off) still carries the shared time-shape-block testid.
    expect(document.querySelector('[data-testid="time-shape-block"][data-kind="meeting"]')).not.toBeNull();
  });

  it('carries a hover title with the meeting title + time range', () => {
    render(
      <TimeShape date={WINDOW_DATE} timezone={TZ} meetings={[meetingWithContext]} nowMs={NOW} meetingMinutes={30} dueTasksCount={0} />
    );
    expect(screen.getByTestId('time-shape-meeting-trigger')).toHaveAttribute('title', expect.stringContaining('BRIC board'));
  });

  it('clicking the block opens the popover with the meeting details; clicking again closes it', () => {
    render(
      <TimeShape date={WINDOW_DATE} timezone={TZ} meetings={[meetingWithContext]} nowMs={NOW} meetingMinutes={30} dueTasksCount={0} />
    );
    expect(screen.queryByTestId('calendar-event-popover')).not.toBeInTheDocument();

    const trigger = screen.getByTestId('time-shape-meeting-trigger');
    fireEvent.click(trigger);
    const popover = screen.getByTestId('calendar-event-popover');
    expect(popover).toHaveTextContent('BRIC board');
    expect(popover).toHaveTextContent('Springfield VT');
    expect(screen.getByTestId('calendar-event-join')).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByTestId('calendar-event-popover')).not.toBeInTheDocument();
  });
});
