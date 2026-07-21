import { describe, it, expect } from 'vitest';
import {
  computeBlockLayout,
  computeNowLinePercent,
  layoutMeetingBlocks,
  layoutFocusBlocks,
  dayCapacityFillPercent,
  isDayOverCapacity,
} from '../time-shape-logic';

const WINDOW = {
  start: new Date('2026-07-21T08:00:00.000Z'),
  end: new Date('2026-07-21T18:00:00.000Z'),
};

describe('computeBlockLayout', () => {
  it('places a block fully inside the window proportionally', () => {
    const layout = computeBlockLayout(
      { start: '2026-07-21T09:00:00.000Z', end: '2026-07-21T10:00:00.000Z' },
      WINDOW
    );
    expect(layout).not.toBeNull();
    expect(layout!.leftPercent).toBeCloseTo(10, 1); // 1hr into a 10hr window
    expect(layout!.widthPercent).toBeCloseTo(10, 1); // 1hr wide
  });

  it('clips a block that starts before the window', () => {
    const layout = computeBlockLayout(
      { start: '2026-07-21T06:00:00.000Z', end: '2026-07-21T09:00:00.000Z' },
      WINDOW
    );
    expect(layout!.leftPercent).toBeCloseTo(0, 1);
    expect(layout!.widthPercent).toBeCloseTo(10, 1); // only 8-9am counted
  });

  it('clips a block that ends after the window', () => {
    const layout = computeBlockLayout(
      { start: '2026-07-21T17:00:00.000Z', end: '2026-07-21T20:00:00.000Z' },
      WINDOW
    );
    expect(layout!.widthPercent).toBeCloseTo(10, 1); // only 5-6pm counted
  });

  it('returns null for a block entirely before the window', () => {
    const layout = computeBlockLayout(
      { start: '2026-07-21T05:00:00.000Z', end: '2026-07-21T06:00:00.000Z' },
      WINDOW
    );
    expect(layout).toBeNull();
  });

  it('returns null for a block entirely after the window', () => {
    const layout = computeBlockLayout(
      { start: '2026-07-21T19:00:00.000Z', end: '2026-07-21T20:00:00.000Z' },
      WINDOW
    );
    expect(layout).toBeNull();
  });

  it('enforces a minimum visible width for a very short block', () => {
    const layout = computeBlockLayout(
      { start: '2026-07-21T09:00:00.000Z', end: '2026-07-21T09:00:01.000Z' },
      WINDOW
    );
    expect(layout!.widthPercent).toBeGreaterThanOrEqual(1.5);
  });
});

describe('computeNowLinePercent', () => {
  it('places the now-line proportionally inside the window', () => {
    const nowMs = new Date('2026-07-21T13:00:00.000Z').getTime(); // 5hrs into a 10hr window
    expect(computeNowLinePercent(nowMs, WINDOW)).toBeCloseTo(50, 1);
  });

  it('is null before the window opens', () => {
    const nowMs = new Date('2026-07-21T06:00:00.000Z').getTime();
    expect(computeNowLinePercent(nowMs, WINDOW)).toBeNull();
  });

  it('is null after the window closes', () => {
    const nowMs = new Date('2026-07-21T20:00:00.000Z').getTime();
    expect(computeNowLinePercent(nowMs, WINDOW)).toBeNull();
  });
});

describe('layoutMeetingBlocks', () => {
  it('lays out multiple meetings sorted by start time', () => {
    const blocks = layoutMeetingBlocks(
      [
        { id: 'm2', title: 'Sales', start: '2026-07-21T14:00:00.000Z', end: '2026-07-21T14:30:00.000Z' },
        { id: 'm1', title: 'Chris — call', start: '2026-07-21T09:30:00.000Z', end: '2026-07-21T10:00:00.000Z' },
      ],
      WINDOW
    );
    expect(blocks.map((b) => b.id)).toEqual(['m1', 'm2']);
    expect(blocks.every((b) => b.kind === 'meeting')).toBe(true);
  });

  it('omits meetings outside the window entirely', () => {
    const blocks = layoutMeetingBlocks(
      [{ id: 'm1', title: 'Late night', start: '2026-07-21T22:00:00.000Z', end: '2026-07-21T23:00:00.000Z' }],
      WINDOW
    );
    expect(blocks).toHaveLength(0);
  });
});

describe('layoutFocusBlocks', () => {
  it('fills the open runway around meetings without overlapping them', () => {
    const meetingBlocks = layoutMeetingBlocks(
      [{ id: 'm1', title: 'Chris — call', start: '2026-07-21T12:00:00.000Z', end: '2026-07-21T13:00:00.000Z' }],
      WINDOW
    );
    const focusBlocks = layoutFocusBlocks(['BRIC review', 'Clarity Phase 3'], meetingBlocks, WINDOW);

    expect(focusBlocks).toHaveLength(2);
    // Neither focus block should overlap the meeting's [40%, 50%] span.
    for (const fb of focusBlocks) {
      const fbEnd = fb.leftPercent + fb.widthPercent;
      const overlapsMeeting = fb.leftPercent < 50 && fbEnd > 40;
      expect(overlapsMeeting).toBe(false);
    }
  });

  it('returns nothing when there is no free runway', () => {
    const meetingBlocks = layoutMeetingBlocks(
      [{ id: 'm1', title: 'All day', start: '2026-07-21T08:00:00.000Z', end: '2026-07-21T18:00:00.000Z' }],
      WINDOW
    );
    const focusBlocks = layoutFocusBlocks(['Something'], meetingBlocks, WINDOW);
    expect(focusBlocks).toHaveLength(0);
  });

  it('returns nothing when there are no labels to place', () => {
    expect(layoutFocusBlocks([], [], WINDOW)).toHaveLength(0);
  });

  it('places a single focus block across the entire empty window', () => {
    const focusBlocks = layoutFocusBlocks(['Deep work'], [], WINDOW);
    expect(focusBlocks).toHaveLength(1);
    expect(focusBlocks[0].leftPercent).toBeCloseTo(0, 0);
    expect(focusBlocks[0].widthPercent).toBeCloseTo(100, 0);
  });
});

describe('dayCapacityFillPercent / isDayOverCapacity', () => {
  it('computes a low fill for a light day', () => {
    const fill = dayCapacityFillPercent(60, 0); // 1hr of meetings, 8hr day
    expect(fill).toBeCloseTo(60 / 480, 5);
    expect(isDayOverCapacity(fill)).toBe(false);
  });

  it('flags a packed day as over capacity', () => {
    const fill = dayCapacityFillPercent(300, 3); // 5hrs meetings + 3 due tasks
    expect(isDayOverCapacity(fill)).toBe(true);
  });

  it('clamps fill at 100% for a wildly overbooked day', () => {
    const fill = dayCapacityFillPercent(1000, 10);
    expect(fill).toBe(1);
  });

  it('is exactly at the packed threshold boundary', () => {
    const fill = dayCapacityFillPercent(384, 0); // 384/480 = 0.8 exactly
    expect(fill).toBeCloseTo(0.8, 5);
    expect(isDayOverCapacity(fill)).toBe(true);
  });
});
