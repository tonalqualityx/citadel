import { describe, it, expect } from 'vitest';
import {
  ROCK_CAP,
  isValidQuarter,
  lastDayOfQuarter,
  currentQuarter,
  upcomingQuarters,
  rockStatus,
  rockDecisionLine,
  formatCalendarDateUtc,
  formatMonthDayUtc,
} from '../rock';

describe('rock helpers', () => {
  it('caps at seven', () => {
    expect(ROCK_CAP).toBe(7);
  });

  it('validates quarter format', () => {
    expect(isValidQuarter('2027-Q1')).toBe(true);
    expect(isValidQuarter('2027-Q4')).toBe(true);
    expect(isValidQuarter('2027-Q5')).toBe(false);
    expect(isValidQuarter('2027-Q0')).toBe(false);
    expect(isValidQuarter('27-Q1')).toBe(false);
    expect(isValidQuarter('2027Q1')).toBe(false);
    expect(isValidQuarter(null)).toBe(false);
  });

  it('finds the last day of each quarter as a UTC midnight', () => {
    expect(lastDayOfQuarter('2027-Q1').toISOString()).toBe('2027-03-31T00:00:00.000Z');
    expect(lastDayOfQuarter('2027-Q2').toISOString()).toBe('2027-06-30T00:00:00.000Z');
    expect(lastDayOfQuarter('2027-Q3').toISOString()).toBe('2027-09-30T00:00:00.000Z');
    expect(lastDayOfQuarter('2027-Q4').toISOString()).toBe('2027-12-31T00:00:00.000Z');
  });

  it('throws on an invalid quarter', () => {
    expect(() => lastDayOfQuarter('nope')).toThrow();
  });

  it('names the current quarter in UTC', () => {
    expect(currentQuarter(new Date('2026-11-25T12:00:00Z'))).toBe('2026-Q4');
    expect(currentQuarter(new Date('2027-01-01T00:00:00Z'))).toBe('2027-Q1');
    expect(currentQuarter(new Date('2026-03-31T23:59:59Z'))).toBe('2026-Q1');
    expect(currentQuarter(new Date('2026-07-01T00:00:00Z'))).toBe('2026-Q3');
  });

  it('lists the current quarter plus the next ones, rolling over the year', () => {
    expect(upcomingQuarters(3, new Date('2026-11-25T00:00:00Z'))).toEqual([
      '2026-Q4',
      '2027-Q1',
      '2027-Q2',
      '2027-Q3',
    ]);
    expect(upcomingQuarters(3, new Date('2026-02-01T00:00:00Z'))).toEqual([
      '2026-Q1',
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
    ]);
  });

  describe('rockStatus', () => {
    const now = new Date('2027-02-10T15:00:00Z');

    it('is null when not a rock', () => {
      expect(rockStatus({ rock_quarter: null, target_date: '2020-01-01' }, now)).toBeNull();
    });

    it('is done when completed, even if late', () => {
      expect(
        rockStatus(
          { rock_quarter: '2027-Q1', completed_at: '2027-02-01T00:00:00Z', target_date: '2027-01-01T00:00:00Z' },
          now
        )
      ).toBe('done');
    });

    it('is off track when the target date is before today', () => {
      expect(rockStatus({ rock_quarter: '2027-Q1', target_date: new Date('2027-02-09T00:00:00Z') }, now)).toBe(
        'off_track'
      );
    });

    it('is on track when the target date is today or later', () => {
      expect(rockStatus({ rock_quarter: '2027-Q1', target_date: new Date('2027-02-10T00:00:00Z') }, now)).toBe(
        'on_track'
      );
      expect(rockStatus({ rock_quarter: '2027-Q1', target_date: '2027-03-31T00:00:00Z' }, now)).toBe('on_track');
    });
  });

  describe('waiting on Mike', () => {
    const now = new Date('2027-02-20T12:00:00Z');
    const MIKE = '3ecfb7be-20bb-43cb-9b4d-31c44337dc81';
    const rock = { rock_quarter: '2027-Q1', target_date: new Date('2027-03-31T00:00:00Z') };
    const waiting = (daysAgo: number, owner = MIKE) => ({
      next_step_text: 'approve the ADA audit outline',
      next_step_owner_id: owner,
      next_step_at: new Date(now.getTime() - daysAgo * 86400000),
    });

    it('stays on track at 6 days', () => {
      expect(rockStatus(rock, now, waiting(6))).toBe('on_track');
      expect(rockDecisionLine(rock, now, waiting(6))).toBeNull();
    });

    it('goes off track at 8 days with a decision line', () => {
      expect(rockStatus(rock, now, waiting(8))).toBe('off_track');
      expect(rockDecisionLine(rock, now, waiting(8))).toBe(
        'Waiting on you since Feb 12: approve the ADA audit outline'
      );
    });

    it('ignores a next step owned by someone else', () => {
      const other = waiting(30, '00000000-0000-4000-8000-000000000000');
      expect(rockStatus(rock, now, other)).toBe('on_track');
      expect(rockDecisionLine(rock, now, other)).toBeNull();
    });

    it('lets done win', () => {
      const done = { ...rock, completed_at: new Date('2027-02-01T00:00:00Z') };
      expect(rockStatus(done, now, waiting(30))).toBe('done');
      expect(rockDecisionLine(done, now, waiting(30))).toBeNull();
    });

    it('is null for a milestone that is not a rock', () => {
      expect(rockStatus({ rock_quarter: null }, now, waiting(30))).toBeNull();
      expect(rockDecisionLine({ rock_quarter: null }, now, waiting(30))).toBeNull();
    });
  });

  describe('calendar date formatting', () => {
    it('shows a UTC-midnight date as the same calendar day in any timezone', () => {
      const original = process.env.TZ;
      process.env.TZ = 'America/New_York';
      try {
        const d = new Date('2027-03-31T00:00:00.000Z');
        expect(formatCalendarDateUtc(d)).toBe('Mar 31, 2027');
        expect(formatCalendarDateUtc('2027-03-31T00:00:00.000Z')).toBe('Mar 31, 2027');
        expect(formatMonthDayUtc(d)).toBe('Mar 31');
        expect(d.toISOString().split('T')[0]).toBe('2027-03-31');
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    });
  });
});
