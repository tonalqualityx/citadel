import { describe, it, expect } from 'vitest';
import {
  addBusinessDays,
  formatDateForInput,
  getStartOfDayForTimezone,
  getStartOfWeekForTimezone,
  getZonedDateString,
  getStartOfDateStringForTimezone,
  getDayBoundsForTimezone,
} from '../time';

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

describe('getZonedDateString', () => {
  it('returns the UTC calendar day for a mid-day UTC instant regardless of timezone offset direction', () => {
    // Noon UTC is always the same calendar day in both an ET (behind) and Karachi (ahead) read.
    const noon = new Date('2026-07-21T12:00:00.000Z');
    expect(getZonedDateString(noon, 'America/New_York')).toBe('2026-07-21');
    expect(getZonedDateString(noon, 'Asia/Karachi')).toBe('2026-07-21');
  });

  it('the 8pm-ET boundary case: an instant already tomorrow in UTC is still "today" in ET', () => {
    // 8:00pm EDT on 2026-07-21 = 2026-07-22T00:00:00.000Z (July, UTC-4).
    const eightPmET = new Date('2026-07-22T00:00:00.000Z');
    expect(getZonedDateString(eightPmET, 'America/New_York')).toBe('2026-07-21');
    // The naive/buggy UTC-day read would say '2026-07-22' — proving this isn't a no-op.
    expect(getZonedDateString(eightPmET, 'UTC')).toBe('2026-07-22');
  });

  it('mirror case in a zone AHEAD of UTC (Asia/Karachi, UTC+5, no DST): rolls over EARLIER than UTC', () => {
    // 12:30am PKT on 2026-07-22 = 2026-07-21T19:30:00.000Z (Karachi is UTC+5 with no DST).
    const justAfterMidnightKarachi = new Date('2026-07-21T19:30:00.000Z');
    expect(getZonedDateString(justAfterMidnightKarachi, 'Asia/Karachi')).toBe('2026-07-22');
    // Same instant is still '2026-07-21' in UTC and in ET (15:30 EDT) — proving the
    // rollover direction is genuinely per-zone, not just always "add a day".
    expect(getZonedDateString(justAfterMidnightKarachi, 'UTC')).toBe('2026-07-21');
    expect(getZonedDateString(justAfterMidnightKarachi, 'America/New_York')).toBe('2026-07-21');
  });

  it('falls back to the UTC calendar day when timezone is missing', () => {
    const d = new Date('2026-07-21T23:00:00.000Z');
    expect(getZonedDateString(d, null)).toBe('2026-07-21');
    expect(getZonedDateString(d, undefined)).toBe('2026-07-21');
  });

  it('falls back to the UTC calendar day for an invalid timezone', () => {
    const d = new Date('2026-07-21T23:00:00.000Z');
    expect(getZonedDateString(d, 'Not/Real')).toBe('2026-07-21');
  });
});

describe('getStartOfDateStringForTimezone', () => {
  it('returns the correct UTC instant for ET midnight in EDT (UTC-4)', () => {
    // Midnight EDT on 2026-07-21 = 2026-07-21T04:00:00.000Z.
    const result = getStartOfDateStringForTimezone('2026-07-21', 'America/New_York');
    expect(result.toISOString()).toBe('2026-07-21T04:00:00.000Z');
  });

  it('returns the correct UTC instant for Karachi midnight (UTC+5, no DST)', () => {
    // Midnight PKT on 2026-07-21 = 2026-07-20T19:00:00.000Z.
    const result = getStartOfDateStringForTimezone('2026-07-21', 'Asia/Karachi');
    expect(result.toISOString()).toBe('2026-07-20T19:00:00.000Z');
  });

  it('round-trips through getZonedDateString: the returned instant reads back as the same date in the same zone', () => {
    const result = getStartOfDateStringForTimezone('2026-11-03', 'America/New_York');
    expect(getZonedDateString(result, 'America/New_York')).toBe('2026-11-03');
  });

  it('falls back to literal UTC midnight when timezone is missing', () => {
    const result = getStartOfDateStringForTimezone('2026-07-21', null);
    expect(result.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });

  it('falls back to literal UTC midnight for an invalid timezone', () => {
    const result = getStartOfDateStringForTimezone('2026-07-21', 'Not/Real');
    expect(result.toISOString()).toBe('2026-07-21T00:00:00.000Z');
  });
});

describe('getDayBoundsForTimezone', () => {
  it('the 8pm-ET boundary case: an 8pm ET event on the date belongs INSIDE that date\'s window even though it is UTC-tomorrow', () => {
    const { start, end } = getDayBoundsForTimezone('2026-07-21', 'America/New_York');
    const eightPmET = new Date('2026-07-22T00:00:00.000Z'); // 8:00pm EDT, 2026-07-21
    expect(eightPmET.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(eightPmET.getTime()).toBeLessThanOrEqual(end.getTime());
    // And it must NOT belong to the next date's window.
    const nextDay = getDayBoundsForTimezone('2026-07-22', 'America/New_York');
    expect(eightPmET.getTime()).toBeLessThan(nextDay.start.getTime());
  });

  it('mirror case: Asia/Karachi day bounds correctly exclude an instant that is ET-boundary but not Karachi-boundary', () => {
    // 8pm ET 2026-07-21 (= 2026-07-22T00:00:00Z) is 5am PKT on 2026-07-22 — Karachi's
    // OWN 2026-07-22 window, not 2026-07-21's.
    const karachiJul21 = getDayBoundsForTimezone('2026-07-21', 'Asia/Karachi');
    const karachiJul22 = getDayBoundsForTimezone('2026-07-22', 'Asia/Karachi');
    const eightPmET = new Date('2026-07-22T00:00:00.000Z');
    expect(eightPmET.getTime()).toBeGreaterThan(karachiJul21.end.getTime());
    expect(eightPmET.getTime()).toBeGreaterThanOrEqual(karachiJul22.start.getTime());
    expect(eightPmET.getTime()).toBeLessThanOrEqual(karachiJul22.end.getTime());
  });

  it('spans exactly 24 hours minus 1ms on a non-DST-transition day', () => {
    const { start, end } = getDayBoundsForTimezone('2026-07-21', 'America/New_York');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('falls back to literal UTC day bounds when timezone is missing', () => {
    const { start, end } = getDayBoundsForTimezone('2026-07-21', null);
    expect(start.toISOString()).toBe('2026-07-21T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-21T23:59:59.999Z');
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
