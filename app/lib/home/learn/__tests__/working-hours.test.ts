import { describe, it, expect } from 'vitest';
import { addDaysYmd, previousWeek, weekdaysInRange, workingHoursBetween, ymdInZone } from '../working-hours';

const TZ = 'America/New_York';
// November 2026: the 13th is a Friday, the 16th a Monday. EST is UTC-5 from November 1.
const at = (day: string, hh: number, mm = 0) => new Date(new Date(`${day}T00:00:00Z`).getTime() + ((hh + 5) * 60 + mm) * 60_000);

describe('workingHoursBetween', () => {
  it('Friday 16:00 to Monday 10:00 is 2 hours', () => {
    expect(workingHoursBetween(at('2026-11-13', 16), at('2026-11-16', 10), TZ)).toBe(2);
  });
  it('counts only 09:00 to 17:00 inside one day', () => {
    expect(workingHoursBetween(at('2026-11-10', 7), at('2026-11-10', 11), TZ)).toBe(2);
    expect(workingHoursBetween(at('2026-11-10', 12), at('2026-11-10', 20), TZ)).toBe(5);
  });
  it('a whole Tuesday to Wednesday is 8 hours plus the morning', () => {
    expect(workingHoursBetween(at('2026-11-10', 9), at('2026-11-11', 10), TZ)).toBe(9);
  });
  it('a weekend alone is zero, and a reversed range is zero', () => {
    expect(workingHoursBetween(at('2026-11-14', 10), at('2026-11-15', 16), TZ)).toBe(0);
    expect(workingHoursBetween(at('2026-11-12', 12), at('2026-11-12', 10), TZ)).toBe(0);
  });
});

describe('day helpers', () => {
  it('previousWeek of a Monday is the Monday to Sunday before', () => {
    expect(previousWeek('2026-11-23')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(previousWeek('2026-11-26')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });
  it('weekdaysInRange skips weekends', () => {
    expect(weekdaysInRange('2026-11-16', '2026-11-22')).toHaveLength(5);
    expect(weekdaysInRange('2026-11-14', '2026-11-15')).toHaveLength(0);
  });
  it('addDaysYmd crosses a month', () => {
    expect(addDaysYmd('2026-11-30', 1)).toBe('2026-12-01');
  });
  it('ymdInZone uses his wall clock', () => {
    expect(ymdInZone(new Date('2026-11-17T03:30:00Z'), TZ)).toBe('2026-11-16');
  });
});
