import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
