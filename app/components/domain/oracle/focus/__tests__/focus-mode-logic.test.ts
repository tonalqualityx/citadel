import { describe, it, expect } from 'vitest';
import {
  elapsedMinutes,
  elapsedSeconds,
  remainingSeconds,
  isTimeUp,
  formatClock,
  isValidParkNote,
  formatParkNoteText,
  FOCUS_DURATION_PRESETS_MINUTES,
} from '../focus-mode-logic';

const START = new Date('2026-07-27T09:00:00.000Z').getTime();

describe('elapsedMinutes / elapsedSeconds', () => {
  it('computes whole elapsed minutes', () => {
    expect(elapsedMinutes(START, START + 5 * 60_000)).toBe(5);
  });

  it('clamps to 0 rather than going negative', () => {
    expect(elapsedMinutes(START, START - 60_000)).toBe(0);
    expect(elapsedSeconds(START, START - 1000)).toBe(0);
  });
});

describe('remainingSeconds / isTimeUp', () => {
  it('counts down for a fixed duration', () => {
    const choice = { kind: 'fixed' as const, minutes: 25 };
    expect(remainingSeconds(choice, START, START + 60_000)).toBe(25 * 60 - 60);
  });

  it('never goes negative once past the declared duration', () => {
    const choice = { kind: 'fixed' as const, minutes: 25 };
    expect(remainingSeconds(choice, START, START + 26 * 60_000)).toBe(0);
    expect(isTimeUp(choice, START, START + 26 * 60_000)).toBe(true);
  });

  it('is not time-up before the duration elapses', () => {
    const choice = { kind: 'fixed' as const, minutes: 25 };
    expect(isTimeUp(choice, START, START + 60_000)).toBe(false);
  });

  it('open-ended has no remaining time and is never "time up"', () => {
    const choice = { kind: 'open-ended' as const };
    expect(remainingSeconds(choice, START, START + 999_000)).toBeNull();
    expect(isTimeUp(choice, START, START + 999_000)).toBe(false);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(0)).toBe('0:00');
  });

  it('never renders negative', () => {
    expect(formatClock(-30)).toBe('0:00');
  });
});

describe('isValidParkNote', () => {
  it('rejects both fields empty', () => {
    expect(isValidParkNote({ whereLeftOff: '', nextStep: '  ' })).toBe(false);
  });

  it('accepts either field non-empty', () => {
    expect(isValidParkNote({ whereLeftOff: 'halfway through the form', nextStep: '' })).toBe(true);
    expect(isValidParkNote({ whereLeftOff: '', nextStep: 'send the email' })).toBe(true);
  });
});

describe('formatParkNoteText', () => {
  it('includes both fields when present', () => {
    const text = formatParkNoteText({ whereLeftOff: 'halfway', nextStep: 'finish it' }, START);
    expect(text).toContain('Where I left off: halfway');
    expect(text).toContain('Next step: finish it');
  });

  it('omits an empty field entirely rather than rendering a blank label', () => {
    const text = formatParkNoteText({ whereLeftOff: 'halfway', nextStep: '' }, START);
    expect(text).toContain('Where I left off: halfway');
    expect(text).not.toContain('Next step:');
  });
});

describe('FOCUS_DURATION_PRESETS_MINUTES', () => {
  it('is 25/45/90 per spec', () => {
    expect(FOCUS_DURATION_PRESETS_MINUTES).toEqual([25, 45, 90]);
  });
});
