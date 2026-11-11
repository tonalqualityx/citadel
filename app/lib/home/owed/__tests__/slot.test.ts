import { describe, it, expect } from 'vitest';
import { pickSlot, type SlotEvent } from '../slot';

const TZ = 'America/New_York';
/** Eastern standard time is UTC-5 (November 2026, after the 1 November change). */
const at = (day: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, day, h + 5, mi));
const ev = (start: Date, end: Date, all_day = false): SlotEvent => ({ starts_at: start, ends_at: end, all_day });
const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d);
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ }).format(d);

describe('pickSlot', () => {
  it('starts at 10:00 on an empty morning', () => {
    const s = pickSlot([], at(10, 8), TZ)!;
    expect(hhmm(s.start)).toBe('10:00');
    expect(s.end.getTime() - s.start.getTime()).toBe(30 * 60_000);
  });

  it('is at least 15 minutes from now, on a quarter hour', () => {
    expect(hhmm(pickSlot([], at(10, 10, 0), TZ)!.start)).toBe('10:15');
    expect(hhmm(pickSlot([], at(10, 10, 1), TZ)!.start)).toBe('10:30');
    expect(hhmm(pickSlot([], at(10, 13, 46), TZ)!.start)).toBe('14:15');
  });

  it('keeps 20 minutes before and 30 minutes after a timed meeting', () => {
    const meeting = ev(at(10, 10, 40), at(10, 11, 0));
    // 10:00 to 10:30 would touch the 20 minute margin (10:20); the first clear start is 11:30.
    expect(hhmm(pickSlot([meeting], at(10, 8), TZ)!.start)).toBe('11:30');
    // A start at 10:00 with a meeting at 10:50 ends 10:30, 20 minutes clear.
    expect(hhmm(pickSlot([ev(at(10, 10, 50), at(10, 11, 30))], at(10, 8), TZ)!.start)).toBe('10:00');
    // A meeting that ends 10:00 blocks until 10:30.
    expect(hhmm(pickSlot([ev(at(10, 9, 0), at(10, 10, 0))], at(10, 8), TZ)!.start)).toBe('10:30');
  });

  it('an all-day event does not block', () => {
    expect(hhmm(pickSlot([ev(at(10, 0), at(11, 0), true)], at(10, 8), TZ)!.start)).toBe('10:00');
  });

  it('the half hour ends by 17:00, then it is the next business day', () => {
    const s = pickSlot([], at(10, 16, 40), TZ)!;
    expect(dayOf(s.start)).toBe('Wed');
    expect(hhmm(s.start)).toBe('10:00');
    expect(hhmm(pickSlot([], at(10, 16, 10), TZ)!.start)).toBe('16:30');
  });

  it('a Friday evening goes to Monday; a Saturday goes to Monday', () => {
    expect(dayOf(pickSlot([], at(13, 18), TZ)!.start)).toBe('Mon');
    expect(dayOf(pickSlot([], at(14, 12), TZ)!.start)).toBe('Mon');
  });

  it('looks at two business days and then gives up', () => {
    const wall = (d: number) => ev(at(d, 9, 0), at(d, 18, 0));
    // Tuesday 8:00: Tuesday and Wednesday are full, Thursday is not looked at.
    expect(pickSlot([wall(10), wall(11)], at(10, 8), TZ)).toBeNull();
    expect(dayOf(pickSlot([wall(10)], at(10, 8), TZ)!.start)).toBe('Wed');
  });

  it('works across the other side of a time change (EDT, UTC-4)', () => {
    const now = new Date(Date.UTC(2026, 5, 10, 12, 0)); // Wednesday 8:00 Eastern daylight
    expect(hhmm(pickSlot([], now, TZ)!.start)).toBe('10:00');
  });
});
