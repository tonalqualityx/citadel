import { describe, it, expect } from 'vitest';
import { addBusinessDays, formatDateForInput, getStartOfDayForTimezone, getStartOfWeekForTimezone } from '../time';

describe('addBusinessDays', () => {
  it('adds business days correctly when no weekends are crossed', () => {
    // Monday to Wednesday
    const monday = new Date('2026-01-12T00:00:00');
    const result = addBusinessDays(monday, 2);
    expect(result.toDateString()).toBe('Wed Jan 14 2026');
  });

  it('skips weekends when adding business days', () => {
    // Friday + 1 business day = Monday
    const friday = new Date('2026-01-16T00:00:00');
    const result = addBusinessDays(friday, 1);
    expect(result.toDateString()).toBe('Mon Jan 19 2026');
  });

  it('handles adding 4 business days (crosses weekend)', () => {
    // Thursday + 4 business days = Wednesday (next week)
    const thursday = new Date('2026-01-15T00:00:00');
    const result = addBusinessDays(thursday, 4);
    expect(result.toDateString()).toBe('Wed Jan 21 2026');
  });

  it('handles starting on Saturday', () => {
    // Saturday + 1 business day = Tuesday (skips Sat, Sun, counts Mon)
    const saturday = new Date('2026-01-17T00:00:00');
    const result = addBusinessDays(saturday, 1);
    expect(result.toDateString()).toBe('Tue Jan 20 2026');
  });

  it('handles starting on Sunday', () => {
    // Sunday + 1 business day = Tuesday (skips Sun, counts Mon)
    const sunday = new Date('2026-01-18T00:00:00');
    const result = addBusinessDays(sunday, 1);
    expect(result.toDateString()).toBe('Tue Jan 20 2026');
  });

  it('handles zero business days', () => {
    const date = new Date('2026-01-14T00:00:00');
    const result = addBusinessDays(date, 0);
    expect(result.toDateString()).toBe(date.toDateString());
  });

  it('handles large number of business days', () => {
    // 20 business days = 4 weeks
    const date = new Date('2026-01-12T00:00:00');
    const result = addBusinessDays(date, 20);
    expect(result.toDateString()).toBe('Mon Feb 09 2026');
  });

  it('handles adding business days from Wednesday crossing weekend', () => {
    // Wednesday + 4 business days = Tuesday (next week)
    const wednesday = new Date('2026-01-14T00:00:00');
    const result = addBusinessDays(wednesday, 4);
    expect(result.toDateString()).toBe('Tue Jan 20 2026');
  });

  it('preserves time information', () => {
    const date = new Date('2026-01-12T14:30:45');
    const result = addBusinessDays(date, 1);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(45);
  });

  it('does not modify the original date object', () => {
    const original = new Date('2026-01-12T00:00:00');
    const originalStr = original.toDateString();
    addBusinessDays(original, 5);
    expect(original.toDateString()).toBe(originalStr);
  });
});

describe('formatDateForInput', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date('2026-01-14T12:30:00');
    expect(formatDateForInput(date)).toBe('2026-01-14');
  });

  it('pads single-digit months and days', () => {
    const date = new Date('2026-03-05T00:00:00');
    expect(formatDateForInput(date)).toBe('2026-03-05');
  });

  it('handles December 31st', () => {
    const date = new Date('2026-12-31T23:59:59');
    expect(formatDateForInput(date)).toBe('2026-12-31');
  });

  it('handles January 1st', () => {
    const date = new Date('2026-01-01T00:00:00');
    expect(formatDateForInput(date)).toBe('2026-01-01');
  });

  it('handles leap year date', () => {
    const date = new Date('2024-02-29T00:00:00');
    expect(formatDateForInput(date)).toBe('2024-02-29');
  });

  it('ignores time component', () => {
    const morning = new Date('2026-06-15T06:00:00');
    const evening = new Date('2026-06-15T18:00:00');
    expect(formatDateForInput(morning)).toBe(formatDateForInput(evening));
    expect(formatDateForInput(morning)).toBe('2026-06-15');
  });
});

describe('getStartOfDayForTimezone', () => {
  it('returns a Date object', () => {
    const result = getStartOfDayForTimezone('America/New_York');
    expect(result).toBeInstanceOf(Date);
  });

  it('returns midnight UTC when timezone is UTC', () => {
    const result = getStartOfDayForTimezone('UTC');
    const now = new Date();
    const expectedMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    // Allow 2 seconds tolerance for test execution time
    expect(Math.abs(result.getTime() - expectedMidnight.getTime())).toBeLessThan(2000);
  });

  it('returns correct UTC offset for America/New_York (UTC-5 or UTC-4)', () => {
    const result = getStartOfDayForTimezone('America/New_York');
    // Midnight in New York is either 04:00 UTC (EDT) or 05:00 UTC (EST)
    const utcHour = result.getUTCHours();
    expect([4, 5]).toContain(utcHour);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
  });

  it('returns correct UTC offset for Asia/Tokyo (UTC+9, no DST)', () => {
    const result = getStartOfDayForTimezone('Asia/Tokyo');
    // Midnight Tokyo = 15:00 UTC previous day
    expect(result.getUTCHours()).toBe(15);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it('returns a date earlier than or equal to now', () => {
    const now = new Date();
    const result = getStartOfDayForTimezone('America/Los_Angeles');
    expect(result.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('returns a date within the last 24 hours', () => {
    const now = new Date();
    const result = getStartOfDayForTimezone('Pacific/Auckland');
    const diff = now.getTime() - result.getTime();
    expect(diff).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(diff).toBeGreaterThanOrEqual(0);
  });

  it('falls back to server local time when timezone is null', () => {
    const result = getStartOfDayForTimezone(null);
    const serverMidnight = new Date();
    serverMidnight.setHours(0, 0, 0, 0);
    expect(result.getTime()).toBe(serverMidnight.getTime());
  });

  it('falls back to server local time when timezone is undefined', () => {
    const result = getStartOfDayForTimezone(undefined);
    const serverMidnight = new Date();
    serverMidnight.setHours(0, 0, 0, 0);
    expect(result.getTime()).toBe(serverMidnight.getTime());
  });

  it('falls back to server local time for invalid timezone', () => {
    const result = getStartOfDayForTimezone('Invalid/Timezone');
    const serverMidnight = new Date();
    serverMidnight.setHours(0, 0, 0, 0);
    expect(result.getTime()).toBe(serverMidnight.getTime());
  });

  it('handles half-hour offset timezone (Asia/Kolkata UTC+5:30)', () => {
    const result = getStartOfDayForTimezone('Asia/Kolkata');
    // Midnight Kolkata = 18:30 UTC previous day
    expect(result.getUTCHours()).toBe(18);
    expect(result.getUTCMinutes()).toBe(30);
  });
});

describe('getStartOfWeekForTimezone', () => {
  it('returns a Date object', () => {
    const result = getStartOfWeekForTimezone('America/New_York');
    expect(result).toBeInstanceOf(Date);
  });

  it('returns a Monday in the specified timezone', () => {
    const result = getStartOfWeekForTimezone('UTC');
    const dayStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
    }).format(result);
    expect(dayStr).toBe('Mon');
  });

  it('returns a date within the last 7 days', () => {
    const now = new Date();
    const result = getStartOfWeekForTimezone('Europe/London');
    const diff = now.getTime() - result.getTime();
    expect(diff).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    expect(diff).toBeGreaterThanOrEqual(0);
  });

  it('falls back for null timezone', () => {
    const result = getStartOfWeekForTimezone(null);
    expect(result).toBeInstanceOf(Date);
  });

  it('falls back for invalid timezone', () => {
    const result = getStartOfWeekForTimezone('Not/Real');
    expect(result).toBeInstanceOf(Date);
  });
});
