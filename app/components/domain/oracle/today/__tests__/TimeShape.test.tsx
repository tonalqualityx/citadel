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
        meetings={[{ id: 'gcal-1', title: 'Client call', start: '2026-07-27T13:00:00.000Z', end: '2026-07-27T13:30:00.000Z' }]}
        focusLabels={[]}
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
        meetings={[{ id: 'gcal-1', title: 'Client call', start: '2026-07-27T13:00:00.000Z', end: '2026-07-27T13:30:00.000Z' }]}
        focusLabels={[]}
        linkedMeetingIds={new Set(['gcal-1'])}
        nowMs={NOW}
        meetingMinutes={30}
        dueTasksCount={0}
      />
    );

    const meetingBlock = document.querySelector('[data-testid="time-shape-block"][data-kind="meeting"]');
    expect(meetingBlock).toHaveAttribute('data-linked', 'true');
  });

  it('never renders two chips for the same commitment — the deduped focusLabels stay the caller\'s job', () => {
    // TimeShape itself only ever renders what's passed to it — this test documents that
    // contract: TodaySection is the one that excludes a linked pick's label before it
    // ever reaches here (see time-shape-logic.ts's excludeLinkedPicks + TodaySection.tsx).
    render(
      <TimeShape
        date={WINDOW_DATE}
        timezone={TZ}
        meetings={[{ id: 'gcal-1', title: 'Client call', start: '2026-07-27T13:00:00.000Z', end: '2026-07-27T13:30:00.000Z' }]}
        focusLabels={['Some other unlinked pick']}
        linkedMeetingIds={new Set(['gcal-1'])}
        nowMs={NOW}
        meetingMinutes={30}
        dueTasksCount={0}
      />
    );

    const meetingAndFocusBlocks = screen
      .getAllByTestId('time-shape-block')
      .filter((el) => ['meeting', 'focus'].includes(el.getAttribute('data-kind') ?? ''));
    // the meeting + the one unlinked focus block — never a 2nd chip for gcal-1
    expect(meetingAndFocusBlocks).toHaveLength(2);
  });
});
