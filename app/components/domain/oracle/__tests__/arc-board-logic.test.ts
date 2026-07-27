import { describe, it, expect } from 'vitest';
import {
  formatEstimateMinutes,
  arcEstimateDisplay,
  nextTouchInputValue,
  isNextTouchOverdue,
} from '../arc-board-logic';

describe('formatEstimateMinutes', () => {
  it('renders 0 as "0m"', () => {
    expect(formatEstimateMinutes(0)).toBe('0m');
  });

  it('renders under an hour as just minutes', () => {
    expect(formatEstimateMinutes(45)).toBe('45m');
  });

  it('renders an exact hour with no minutes suffix', () => {
    expect(formatEstimateMinutes(120)).toBe('2h');
  });

  it('renders hours + minutes together', () => {
    expect(formatEstimateMinutes(90)).toBe('1h 30m');
  });

  it('rounds a fractional minute value', () => {
    expect(formatEstimateMinutes(90.4)).toBe('1h 30m');
  });

  it('never renders negative — clamps to 0', () => {
    expect(formatEstimateMinutes(-10)).toBe('0m');
  });
});

describe('arcEstimateDisplay', () => {
  it('shows the computed total with "estimated" when there is no override', () => {
    expect(arcEstimateDisplay(90, null)).toEqual({ text: '~1h 30m estimated', isOverride: false });
  });

  it('prefers the override, labeled "(set by hand)", when set', () => {
    expect(arcEstimateDisplay(90, 120)).toEqual({ text: '~2h (set by hand)', isOverride: true });
  });

  it('an override of 0 still counts as set (not falsy-skipped)', () => {
    expect(arcEstimateDisplay(90, 0)).toEqual({ text: '~0m (set by hand)', isOverride: true });
  });
});

describe('nextTouchInputValue', () => {
  it('returns "" when unset', () => {
    expect(nextTouchInputValue(null)).toBe('');
  });

  it('slices an ISO timestamp down to YYYY-MM-DD', () => {
    expect(nextTouchInputValue('2026-08-01T00:00:00.000Z')).toBe('2026-08-01');
  });
});

describe('isNextTouchOverdue', () => {
  const now = new Date('2026-07-27T12:00:00.000Z').getTime();

  it('is false when unset', () => {
    expect(isNextTouchOverdue(null, now)).toBe(false);
  });

  it('is false for a future date', () => {
    expect(isNextTouchOverdue('2026-08-01T00:00:00.000Z', now)).toBe(false);
  });

  it('is true for a past date', () => {
    expect(isNextTouchOverdue('2026-07-01T00:00:00.000Z', now)).toBe(true);
  });
});
