import { describe, it, expect } from 'vitest';
import { clockLabel, dayBounds, weekdayName } from '../clock';
import { zonedDayBounds } from '../../load';

const Z = 'America/New_York';

describe('clockLabel', () => {
  it('has no am or pm from 7:00 to 18:59 and adds it outside', () => {
    const t = (iso: string) => clockLabel(new Date(iso), Z);
    expect(t('2026-11-11T19:00:00Z')).toBe('2:00');
    expect(t('2026-11-11T11:30:00Z')).toBe('6:30 am');
    expect(t('2026-11-11T12:00:00Z')).toBe('7:00');
    expect(t('2026-11-11T23:59:00Z')).toBe('6:59');
    expect(t('2026-11-12T00:00:00Z')).toBe('7:00 pm');
    expect(t('2026-11-12T01:00:00Z')).toBe('8:00 pm');
    expect(t('2026-11-11T05:00:00Z')).toBe('12:00 am');
    expect(t('2026-11-11T17:00:00Z')).toBe('12:00');
  });
  it('names the weekday', () => {
    expect(weekdayName(new Date('2026-11-11T19:00:00Z'), Z)).toBe('Wednesday');
  });
});

describe('dayBounds', () => {
  it('matches the loader across both daylight saving changes', () => {
    for (const iso of ['2026-11-11T16:40:00Z', '2026-11-01T12:00:00Z', '2026-03-08T12:00:00Z', '2026-03-09T03:00:00Z', '2026-11-02T04:30:00Z']) {
      const a = dayBounds(new Date(iso), Z);
      const b = zonedDayBounds(new Date(iso), Z);
      expect(a.start.toISOString()).toBe(b.start.toISOString());
      expect(a.end.toISOString()).toBe(b.end.toISOString());
    }
  });
});
