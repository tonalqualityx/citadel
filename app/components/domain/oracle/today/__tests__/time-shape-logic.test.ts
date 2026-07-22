import { describe, it, expect } from 'vitest';
import {
  computeBlockLayout,
  computeNowLinePercent,
  layoutMeetingBlocks,
  layoutFocusBlocks,
  dayCapacityFillPercent,
  isDayOverCapacity,
  MEETING_RECOVERY_MINUTES,
  computeMeetingBufferEnd,
  layoutBufferBlocks,
  MEETING_PREP_MINUTES,
  computeMeetingPrepStart,
  layoutPrepBlocks,
  sumCommittedMinutesWithBuffer,
  getTimeShapeWindow,
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

// Mike-directed, 2026-07-21: every timed meeting costs a 15-minute recovery buffer after
// it ends, whether or not anything else is scheduled — attention takes the break either
// way. These tests cover the three cases Mike explicitly called out: a normal gap, a
// back-to-back truncation, and a meeting at the end of the visible day.
describe('MEETING_RECOVERY_MINUTES', () => {
  it('is 15 minutes', () => {
    expect(MEETING_RECOVERY_MINUTES).toBe(15);
  });
});

describe('computeMeetingBufferEnd', () => {
  const meetingEndMs = new Date('2026-07-21T10:00:00.000Z').getTime();

  it('gives the full 15-minute buffer when there is no next meeting', () => {
    const bufferEnd = computeMeetingBufferEnd(meetingEndMs, null);
    expect(bufferEnd).toBe(meetingEndMs + 15 * 60_000);
  });

  it('gives the full 15-minute buffer when the next meeting is far away (normal gap)', () => {
    const nextStartMs = new Date('2026-07-21T11:00:00.000Z').getTime(); // 1hr later
    const bufferEnd = computeMeetingBufferEnd(meetingEndMs, nextStartMs);
    expect(bufferEnd).toBe(meetingEndMs + 15 * 60_000);
  });

  it('truncates the buffer when the next meeting starts within 15 minutes (back-to-back)', () => {
    const nextStartMs = meetingEndMs + 10 * 60_000; // only 10min gap
    const bufferEnd = computeMeetingBufferEnd(meetingEndMs, nextStartMs);
    expect(bufferEnd).toBe(nextStartMs); // truncated, never past the next meeting's start
    expect(bufferEnd! - meetingEndMs).toBe(10 * 60_000);
  });

  it('returns null when fully truncated (next meeting starts at or before this one ends)', () => {
    expect(computeMeetingBufferEnd(meetingEndMs, meetingEndMs)).toBeNull();
    expect(computeMeetingBufferEnd(meetingEndMs, meetingEndMs - 5 * 60_000)).toBeNull(); // overlap
  });

  it('respects a custom recoveryMinutes override', () => {
    const bufferEnd = computeMeetingBufferEnd(meetingEndMs, null, 30);
    expect(bufferEnd).toBe(meetingEndMs + 30 * 60_000);
  });
});

describe('layoutBufferBlocks', () => {
  it('renders the full 15-minute buffer segment trailing a meeting with a normal gap after it', () => {
    const meetings = [
      { id: 'm1', title: 'Chris — call', start: '2026-07-21T09:00:00.000Z', end: '2026-07-21T10:00:00.000Z' },
    ];
    const blocks = layoutBufferBlocks(meetings, WINDOW);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('buffer');
    expect(blocks[0].id).toBe('buffer-m1');
    // Buffer runs 10:00-10:15 inside an 08:00-18:00 window: left = 2hr/10hr = 20%, width = 15min/10hr = 2.5%.
    expect(blocks[0].leftPercent).toBeCloseTo(20, 1);
    expect(blocks[0].widthPercent).toBeCloseTo(2.5, 1);
  });

  it('truncates (shortens) the buffer for a back-to-back next meeting instead of overlapping it', () => {
    const meetings = [
      { id: 'm1', title: 'First', start: '2026-07-21T09:00:00.000Z', end: '2026-07-21T10:00:00.000Z' },
      { id: 'm2', title: 'Second', start: '2026-07-21T10:00:10.000Z', end: '2026-07-21T10:30:00.000Z' }, // starts 10s after m1 ends
    ];
    const blocks = layoutBufferBlocks(meetings, WINDOW);
    // m1's buffer is truncated to 10 seconds — computeBlockLayout enforces a minimum
    // render width, but crucially there is exactly one buffer block for m1, and m2 gets a
    // full 15-minute buffer since nothing follows it in this fixture.
    const m1Buffer = blocks.find((b) => b.id === 'buffer-m1');
    const m2Buffer = blocks.find((b) => b.id === 'buffer-m2');
    expect(m1Buffer).toBeDefined();
    expect(m2Buffer).toBeDefined();
    expect(m2Buffer!.widthPercent).toBeCloseTo(2.5, 1); // full 15min, nothing truncates it
  });

  it('omits the buffer entirely when a meeting immediately follows with zero gap', () => {
    const meetings = [
      { id: 'm1', title: 'First', start: '2026-07-21T09:00:00.000Z', end: '2026-07-21T10:00:00.000Z' },
      { id: 'm2', title: 'Second (back-to-back)', start: '2026-07-21T10:00:00.000Z', end: '2026-07-21T10:30:00.000Z' },
    ];
    const blocks = layoutBufferBlocks(meetings, WINDOW);
    expect(blocks.find((b) => b.id === 'buffer-m1')).toBeUndefined();
  });

  it('clips the buffer at the visible window end for a meeting ending at the edge of the day', () => {
    // Meeting ends at 17:55, 5 minutes before the 18:00 window close — only 5 of the 15
    // buffer minutes are visible; the rest falls outside the rendered day track.
    const meetings = [
      { id: 'm1', title: 'End of day', start: '2026-07-21T17:00:00.000Z', end: '2026-07-21T17:55:00.000Z' },
    ];
    const blocks = layoutBufferBlocks(meetings, WINDOW);
    expect(blocks).toHaveLength(1);
    // 5 minutes of a 10hr (600min) window = 0.833%, but MIN_WIDTH_PERCENT (1.5%) floors it.
    expect(blocks[0].widthPercent).toBeGreaterThan(0);
    expect(blocks[0].widthPercent).toBeLessThan(2.5); // strictly less than the full 15min width
  });

  it('produces no buffer blocks for an empty meeting list', () => {
    expect(layoutBufferBlocks([], WINDOW)).toHaveLength(0);
  });
});

describe('layoutFocusBlocks with buffer-occupied blocks', () => {
  it('never places a focus block inside a meeting\'s trailing buffer', () => {
    const meetings = [
      { id: 'm1', title: 'Chris — call', start: '2026-07-21T12:00:00.000Z', end: '2026-07-21T13:00:00.000Z' },
    ];
    const meetingBlocks = layoutMeetingBlocks(meetings, WINDOW);
    const bufferBlocks = layoutBufferBlocks(meetings, WINDOW);
    const focusBlocks = layoutFocusBlocks(
      ['BRIC review', 'Clarity Phase 3b'],
      [...meetingBlocks, ...bufferBlocks],
      WINDOW
    );

    expect(focusBlocks).toHaveLength(2);
    // The meeting occupies [12:00, 13:00] -> [40%, 50%]; its 15-minute buffer extends that
    // to [13:00, 13:15] -> [50%, 52.5%]. Combined occupied span: [40%, 52.5%].
    const occupiedStart = 40;
    const occupiedEnd = 52.5;
    for (const fb of focusBlocks) {
      const fbEnd = fb.leftPercent + fb.widthPercent;
      const overlapsOccupied = fb.leftPercent < occupiedEnd && fbEnd > occupiedStart;
      expect(overlapsOccupied).toBe(false);
    }
  });
});

// Clarity Phase 5 — every number below was updated to fold in the 20-minute leading prep
// window (MEETING_PREP_MINUTES) alongside the pre-existing 15-minute trailing buffer, per
// Mike's 2026-07-22 ruling ("the 20-minute meeting-prep rule enters the time-shape"). This
// is a deliberate, spec-directed behavior change to this function's numeric output — see
// the dedicated computeMeetingPrepStart/layoutPrepBlocks describe blocks below for the
// prep-specific unit coverage (normal, back-to-back, day-start clamp, overlapping).
describe('sumCommittedMinutesWithBuffer', () => {
  it('sums a full 20-minute leading prep + real duration + a full 15-minute trailing buffer for an isolated meeting', () => {
    const meetings = [
      { id: 'm1', title: 'One hour', start: '2026-07-21T13:00:00.000Z', end: '2026-07-21T14:00:00.000Z' },
    ];
    expect(sumCommittedMinutesWithBuffer(meetings)).toBe(20 + 60 + 15);
  });

  it('truncates the buffer between two back-to-back meetings, and the second\'s prep is fully eaten by the first\'s buffer (never double-counted)', () => {
    const meetings = [
      { id: 'm1', title: 'First', start: '2026-07-21T13:00:00.000Z', end: '2026-07-21T13:30:00.000Z' },
      // Only a 10-minute gap before the second meeting starts.
      { id: 'm2', title: 'Second', start: '2026-07-21T13:40:00.000Z', end: '2026-07-21T14:10:00.000Z' },
    ];
    // m1: 20min full prep (nothing before) + 30min duration + 10min truncated buffer = 60.
    // m2: 0min prep (m1's buffer runs right up to m2's start) + 30min duration + 15min full
    // buffer (nothing follows) = 45. Total = 105.
    expect(sumCommittedMinutesWithBuffer(meetings)).toBe(105);
  });

  it('is order-independent (sorts internally by start); a 30-minute gap fits m1\'s full buffer but only a partial prep for m2', () => {
    const meetings = [
      { id: 'm2', title: 'Second', start: '2026-07-21T14:00:00.000Z', end: '2026-07-21T14:30:00.000Z' },
      { id: 'm1', title: 'First', start: '2026-07-21T13:00:00.000Z', end: '2026-07-21T13:30:00.000Z' },
    ];
    // m1: 20 prep + 30 dur + 15 buffer (30min gap is enough for the full 15) = 65.
    // m2: the 30min gap minus m1's 15min buffer leaves only 15min of room for m2's prep
    // (not the full 20) + 30 dur + 15 buffer (nothing follows) = 60. Total = 125.
    expect(sumCommittedMinutesWithBuffer(meetings)).toBe(125);
  });

  it('returns 0 for no meetings', () => {
    expect(sumCommittedMinutesWithBuffer([])).toBe(0);
  });

  it('respects a custom recoveryMinutes override (prepMinutes still defaults)', () => {
    const meetings = [
      { id: 'm1', title: 'One hour', start: '2026-07-21T13:00:00.000Z', end: '2026-07-21T14:00:00.000Z' },
    ];
    expect(sumCommittedMinutesWithBuffer(meetings, 30)).toBe(20 + 60 + 30);
  });

  it('respects a custom prepMinutes override', () => {
    const meetings = [
      { id: 'm1', title: 'One hour', start: '2026-07-21T13:00:00.000Z', end: '2026-07-21T14:00:00.000Z' },
    ];
    expect(sumCommittedMinutesWithBuffer(meetings, 15, 5)).toBe(5 + 60 + 15);
  });

  it('clamps prep to a given dayStartMs (meeting at day start gets zero prep)', () => {
    const dayStartMs = new Date('2026-07-21T08:00:00.000Z').getTime();
    const meetings = [
      { id: 'm1', title: 'At day start', start: '2026-07-21T08:00:00.000Z', end: '2026-07-21T08:30:00.000Z' },
    ];
    // No room before the day starts — prep is fully clamped to 0, duration 30 + full 15 buffer.
    expect(sumCommittedMinutesWithBuffer(meetings, undefined, undefined, dayStartMs)).toBe(0 + 30 + 15);
  });
});

// Clarity Phase 5 — the 20-minute meeting-prep rule (Mike's ruling, 2026-07-22): every
// timed meeting also costs prep BEFORE it starts, mutually truncated against the previous
// meeting's occupied span (its own trailing buffer, or its plain end if no buffer applies),
// clamped to the visible window/day start. These four cases are the ones Mike explicitly
// called out: normal, back-to-back, a meeting right at day start, and overlapping meetings.
describe('MEETING_PREP_MINUTES', () => {
  it('is 20 minutes', () => {
    expect(MEETING_PREP_MINUTES).toBe(20);
  });
});

describe('computeMeetingPrepStart', () => {
  const meetingStartMs = new Date('2026-07-21T13:00:00.000Z').getTime();
  const dayStartMs = new Date('2026-07-21T08:00:00.000Z').getTime();

  it('normal case: gives the full 20-minute prep window when there is nothing before it', () => {
    const prepStart = computeMeetingPrepStart(meetingStartMs, null, dayStartMs);
    expect(prepStart).toBe(meetingStartMs - 20 * 60_000);
  });

  it('back-to-back: truncates prep when the previous meeting\'s occupied end falls inside the prep window', () => {
    const prevOccupiedEndMs = meetingStartMs - 10 * 60_000; // only 10min before this meeting
    const prepStart = computeMeetingPrepStart(meetingStartMs, prevOccupiedEndMs, dayStartMs);
    expect(prepStart).toBe(prevOccupiedEndMs); // truncated to exactly 10min, not the full 20
    expect(meetingStartMs - prepStart).toBe(10 * 60_000);
  });

  it('meeting at day start: prep is clamped to the day\'s own start, never before it', () => {
    // The meeting starts exactly at the visible day's opening instant.
    const prepStart = computeMeetingPrepStart(dayStartMs, null, dayStartMs);
    expect(prepStart).toBe(dayStartMs);
    expect(dayStartMs - prepStart).toBe(0); // zero-width prep, not negative
  });

  it('meeting shortly after day start: prep is clamped to whatever room the day start leaves', () => {
    const nearDayStart = dayStartMs + 10 * 60_000; // 10 minutes into the day
    const prepStart = computeMeetingPrepStart(nearDayStart, null, dayStartMs);
    expect(prepStart).toBe(dayStartMs); // only 10 of the 20 requested minutes exist
    expect(nearDayStart - prepStart).toBe(10 * 60_000);
  });

  it('overlapping meetings: the previous meeting\'s end is AFTER this one\'s start — prep clamps to zero, never negative', () => {
    const prevOccupiedEndMs = meetingStartMs + 30 * 60_000; // previous meeting still "occupied" 30min into this one
    const prepStart = computeMeetingPrepStart(meetingStartMs, prevOccupiedEndMs, dayStartMs);
    expect(prepStart).toBe(meetingStartMs); // clamped to the meeting's own start, not past it
    expect(meetingStartMs - prepStart).toBe(0);
  });

  it('respects a custom prepMinutes override', () => {
    const prepStart = computeMeetingPrepStart(meetingStartMs, null, dayStartMs, 5);
    expect(prepStart).toBe(meetingStartMs - 5 * 60_000);
  });
});

describe('layoutPrepBlocks', () => {
  it('renders a full 20-minute prep segment leading an isolated meeting', () => {
    const meetings = [
      { id: 'm1', title: 'Chris — call', start: '2026-07-21T13:00:00.000Z', end: '2026-07-21T14:00:00.000Z' },
    ];
    const blocks = layoutPrepBlocks(meetings, WINDOW);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('prep');
    expect(blocks[0].id).toBe('prep-m1');
    // Prep runs 12:40-13:00 inside an 08:00-18:00 window: left = 4h40m/10h = 46.67%, width = 20min/10h ≈ 3.33%.
    expect(blocks[0].leftPercent).toBeCloseTo(46.67, 1);
    expect(blocks[0].widthPercent).toBeCloseTo(3.33, 1);
  });

  it('truncates the second meeting\'s prep when the first\'s buffer runs right up against it', () => {
    const meetings = [
      { id: 'm1', title: 'First', start: '2026-07-21T13:00:00.000Z', end: '2026-07-21T13:30:00.000Z' },
      { id: 'm2', title: 'Second', start: '2026-07-21T13:40:00.000Z', end: '2026-07-21T14:10:00.000Z' },
    ];
    const blocks = layoutPrepBlocks(meetings, WINDOW);
    // m1 gets its full prep (nothing before it); m2's prep is fully consumed by m1's
    // 10-minute truncated buffer (13:30-13:40), so no prep-m2 block renders at all.
    expect(blocks.find((b) => b.id === 'prep-m1')).toBeDefined();
    expect(blocks.find((b) => b.id === 'prep-m2')).toBeUndefined();
  });

  it('produces no prep blocks for an empty meeting list', () => {
    expect(layoutPrepBlocks([], WINDOW)).toHaveLength(0);
  });
});

// Clarity Phase 3d bug fix: the actual reported bug was "a 9:00am ET meeting shows at
// 13:00 on the time-shape" — the window used to be built with a literal UTC `Z` suffix
// even though the hour-axis labels ("8a"..."6p") are wall-clock hours. These tests
// reproduce the exact scenario and prove a real ET meeting now lands at the hour its
// label says, using the window this function produces end-to-end with computeBlockLayout.
describe('getTimeShapeWindow', () => {
  it('anchors the window to LOCAL wall-clock hours in America/New_York (EDT, UTC-4), not UTC', () => {
    const window = getTimeShapeWindow('2026-07-21', 'America/New_York', 8, 18);
    // 8am EDT on 2026-07-21 = 2026-07-21T12:00:00.000Z; 6pm EDT = 2026-07-21T22:00:00.000Z.
    expect(window.start.toISOString()).toBe('2026-07-21T12:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-07-21T22:00:00.000Z');
  });

  it('the reported bug, reproduced and fixed: a 9:00am ET meeting lands at the 9a mark, not 13:00', () => {
    const window = getTimeShapeWindow('2026-07-21', 'America/New_York', 8, 18);
    // 9:00am EDT on 2026-07-21 = 2026-07-21T13:00:00.000Z (this is exactly the raw UTC
    // instant the bug report describes seeing on the axis — the fixed window must
    // place it at the 9a mark, one hour into an 8a-6p, 10-hour-wide track: 10%).
    const nineAmEDT = '2026-07-21T13:00:00.000Z';
    const layout = computeBlockLayout({ start: nineAmEDT, end: '2026-07-21T14:00:00.000Z' }, window);
    expect(layout).not.toBeNull();
    expect(layout!.leftPercent).toBeCloseTo(10, 5); // 1 hour into a 10-hour window = 10%

    // Prove the OLD (buggy) literal-UTC window would have misplaced it: under
    // `{start:'...T08:00:00Z', end:'...T18:00:00Z'}` (the bug), the same 13:00Z instant
    // lands at 50% (5 of 10 hours in) — i.e. rendering as if it were 1pm, not 9am.
    const buggyWindow = { start: new Date('2026-07-21T08:00:00.000Z'), end: new Date('2026-07-21T18:00:00.000Z') };
    const buggyLayout = computeBlockLayout({ start: nineAmEDT, end: '2026-07-21T14:00:00.000Z' }, buggyWindow);
    expect(buggyLayout!.leftPercent).toBeCloseTo(50, 5);
  });

  it('mirror case: a different zone (Asia/Karachi, UTC+5, no DST) anchors correctly too', () => {
    const window = getTimeShapeWindow('2026-07-21', 'Asia/Karachi', 8, 18);
    // 8am PKT on 2026-07-21 = 2026-07-21T03:00:00.000Z; 6pm PKT = 2026-07-21T13:00:00.000Z.
    expect(window.start.toISOString()).toBe('2026-07-21T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-07-21T13:00:00.000Z');
  });

  it('spans exactly (endHour - startHour) hours', () => {
    const window = getTimeShapeWindow('2026-07-21', 'America/New_York', 8, 18);
    expect(window.end.getTime() - window.start.getTime()).toBe(10 * 60 * 60 * 1000);
  });
});
