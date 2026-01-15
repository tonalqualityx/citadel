import { describe, it, expect } from 'vitest';
import { addBusinessDays, formatDateForInput } from '../time';

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
