import { describe, it, expect } from 'vitest';
import { formatEstimateMinutes, arcEstimateDisplay } from '../arc-board-logic';

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
