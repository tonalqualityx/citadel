import { describe, it, expect } from 'vitest';
import { computeSnoozeUntil, isArcSnoozed } from '../arc-snooze';

const NOW = Date.parse('2026-07-22T15:00:00.000Z'); // a Wednesday

describe('computeSnoozeUntil', () => {
  it('1d adds exactly one day', () => {
    const until = computeSnoozeUntil('1d', NOW);
    expect(until.getTime()).toBe(NOW + 24 * 60 * 60 * 1000);
  });

  it('3d adds exactly three days', () => {
    const until = computeSnoozeUntil('3d', NOW);
    expect(until.getTime()).toBe(NOW + 3 * 24 * 60 * 60 * 1000);
  });

  it('next_week resolves to the coming Monday', () => {
    const until = computeSnoozeUntil('next_week', NOW);
    expect(until.getUTCDay()).toBe(1); // Monday
    expect(until.getTime()).toBeGreaterThan(NOW);
  });

  it('next_week from a Sunday resolves to the very next day', () => {
    const sunday = Date.parse('2026-07-26T12:00:00.000Z'); // Sunday
    const until = computeSnoozeUntil('next_week', sunday);
    expect(until.getUTCDay()).toBe(1);
    expect(until.getUTCDate()).toBe(27);
  });

  it('next_week from a Monday resolves to the FOLLOWING Monday, not today', () => {
    const monday = Date.parse('2026-07-27T12:00:00.000Z'); // Monday
    const until = computeSnoozeUntil('next_week', monday);
    expect(until.getUTCDay()).toBe(1);
    expect(until.getUTCDate()).toBe(3); // Aug 3, the following Monday
  });

  it('a custom date option uses the given ISO date as-is', () => {
    const until = computeSnoozeUntil({ customDate: '2026-08-15T00:00:00.000Z' });
    expect(until.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });
});

describe('isArcSnoozed', () => {
  it('is false when snoozed_until is null/undefined', () => {
    expect(isArcSnoozed(null, NOW)).toBe(false);
    expect(isArcSnoozed(undefined, NOW)).toBe(false);
  });

  it('is true when snoozed_until is in the future', () => {
    expect(isArcSnoozed(new Date(NOW + 60_000), NOW)).toBe(true);
  });

  it('is false once snoozed_until has passed', () => {
    expect(isArcSnoozed(new Date(NOW - 60_000), NOW)).toBe(false);
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(isArcSnoozed(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true);
  });

  it('is false for an invalid date string (fails closed, never throws)', () => {
    expect(isArcSnoozed('not-a-date', NOW)).toBe(false);
  });
});
