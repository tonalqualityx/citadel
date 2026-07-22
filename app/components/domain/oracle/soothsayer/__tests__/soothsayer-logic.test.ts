import { describe, it, expect } from 'vitest';
import { isSoothsayerToday, dayColumnLabel, meetingLoadLine } from '../soothsayer-logic';

describe('isSoothsayerToday', () => {
  it('is true when the date matches the window\'s anchor day', () => {
    expect(isSoothsayerToday('2026-07-22', '2026-07-22')).toBe(true);
  });

  it('is false for any other day', () => {
    expect(isSoothsayerToday('2026-07-23', '2026-07-22')).toBe(false);
  });
});

describe('dayColumnLabel', () => {
  it('labels the anchor day "Today"', () => {
    expect(dayColumnLabel('2026-07-22', '2026-07-22')).toBe('Today');
  });

  it('labels a forward day as a short weekday + date', () => {
    // 2026-07-23 is a Thursday.
    expect(dayColumnLabel('2026-07-23', '2026-07-22')).toBe('Thu, 7/23');
  });
});

describe('meetingLoadLine', () => {
  it('reads "No meetings" for a fully open day', () => {
    expect(meetingLoadLine(0, 0)).toBe('No meetings');
  });

  it('singularizes "meeting" for exactly one', () => {
    expect(meetingLoadLine(1, 45)).toBe('1 meeting · 45m');
  });

  it('pluralizes for more than one, formatting hours+minutes', () => {
    expect(meetingLoadLine(3, 150)).toBe('3 meetings · 2h 30m');
  });
});
