import { describe, it, expect } from 'vitest';
import {
  addBusinessDays,
  addCalendarDays,
  addHours,
  computeDueAt,
  businessDaysLate,
  calendarDaysSince,
  isWithinSendWindow,
  nextSendWindowStart,
  zonedParts,
  zonedTimeToUtc,
  isBusinessDay,
  startOfZonedDay,
  endOfZonedDay,
} from './business-days';

// Local helper: build an instant from an Eastern wall-clock time.
const et = (y: number, m: number, d: number, h = 0, mi = 0) => zonedTimeToUtc(y, m, d, h, mi);
const iso = (d: Date) => d.toISOString();

describe('zone conversion', () => {
  it('reads Eastern parts across the DST change', () => {
    // 2026-11-01 is a Sunday; clocks fall back at 02:00 EDT -> 01:00 EST.
    expect(zonedParts(new Date('2026-10-31T21:00:00Z'))).toMatchObject({ day: 31, hour: 17, weekday: 6 });
    expect(zonedParts(new Date('2026-11-01T22:00:00Z'))).toMatchObject({ day: 1, hour: 17, weekday: 0 });
  });

  it('round-trips wall-clock times', () => {
    expect(iso(et(2026, 10, 30, 17))).toBe('2026-10-30T21:00:00.000Z'); // EDT, UTC-4
    expect(iso(et(2026, 11, 2, 17))).toBe('2026-11-02T22:00:00.000Z'); // EST, UTC-5
  });
});

describe('addBusinessDays', () => {
  it('lands on 17:00 Eastern on the Nth business day after the start day', () => {
    // Mon 2026-10-19 10:00 + 2 bd = Wed 17:00
    expect(iso(addBusinessDays(et(2026, 10, 19, 10), 2))).toBe(iso(et(2026, 10, 21, 17)));
  });

  it('skips weekends', () => {
    // Thu 2026-10-22 09:00 + 3 bd = Tue 10-27 17:00
    expect(iso(addBusinessDays(et(2026, 10, 22, 9), 3))).toBe(iso(et(2026, 10, 27, 17)));
  });

  it('counts a start after 17:00 from the next business day', () => {
    // Mon 18:00 + 1 bd: base is Tue, so Wed 17:00
    expect(iso(addBusinessDays(et(2026, 10, 19, 18), 1))).toBe(iso(et(2026, 10, 21, 17)));
    // Fri 17:30 + 1 bd: base is Mon, so Tue 17:00
    expect(iso(addBusinessDays(et(2026, 10, 23, 17, 30), 1))).toBe(iso(et(2026, 10, 27, 17)));
  });

  it('treats a start exactly at 17:00 as after hours', () => {
    expect(iso(addBusinessDays(et(2026, 10, 19, 17, 0), 1))).toBe(iso(et(2026, 10, 21, 17)));
  });

  it('counts a weekend start from the next business day', () => {
    // Sat 2026-10-24 + 1 bd: base is Mon 10-26, so Tue 10-27 17:00
    expect(iso(addBusinessDays(et(2026, 10, 24, 12), 1))).toBe(iso(et(2026, 10, 27, 17)));
  });

  it('zero business days is 17:00 on the base day', () => {
    expect(iso(addBusinessDays(et(2026, 10, 19, 9), 0))).toBe(iso(et(2026, 10, 19, 17)));
  });

  it('keeps 17:00 Eastern across the 2026-11-01 clock change', () => {
    // Fri 2026-10-30 16:00 EDT + 1 bd = Mon 11-02 17:00 EST = 22:00Z (not 21:00Z).
    const due = addBusinessDays(et(2026, 10, 30, 16), 1);
    expect(iso(due)).toBe('2026-11-02T22:00:00.000Z');
    expect(zonedParts(due)).toMatchObject({ month: 11, day: 2, hour: 17 });
  });

  it('keeps 17:00 for a multi-day span that crosses the change', () => {
    // Thu 10-29 + 5 bd: Fri 30, Mon 2, Tue 3, Wed 4, Thu 5 -> Thu Nov 5 17:00 EST
    const due = addBusinessDays(et(2026, 10, 29, 9), 5);
    expect(iso(due)).toBe('2026-11-05T22:00:00.000Z');
  });

  it('does the same in spring (2026-03-08 change)', () => {
    // Fri 2026-03-06 10:00 EST + 1 bd = Mon 03-09 17:00 EDT = 21:00Z
    expect(iso(addBusinessDays(et(2026, 3, 6, 10), 1))).toBe('2026-03-09T21:00:00.000Z');
  });

  it('rejects negatives and fractions', () => {
    expect(() => addBusinessDays(new Date(), -1)).toThrow();
    expect(() => addBusinessDays(new Date(), 1.5)).toThrow();
  });
});

describe('calendar days and hours', () => {
  it('keeps the wall-clock hour across the change', () => {
    // Sat 10-31 12:00 EDT + 1 calendar day = Sun 11-01 12:00 EST (25 hours later)
    const due = addCalendarDays(et(2026, 10, 31, 12), 1);
    expect(iso(due)).toBe('2026-11-01T17:00:00.000Z');
    expect(due.getTime() - et(2026, 10, 31, 12).getTime()).toBe(25 * 3_600_000);
  });

  it('hours are exact elapsed time', () => {
    const start = et(2026, 10, 31, 12);
    expect(addHours(start, 48).getTime() - start.getTime()).toBe(48 * 3_600_000);
  });

  it('computeDueAt dispatches on the unit', () => {
    const s = et(2026, 10, 19, 10);
    expect(iso(computeDueAt(s, 48, 'hours'))).toBe(iso(addHours(s, 48)));
    expect(iso(computeDueAt(s, 7, 'calendar_days'))).toBe(iso(addCalendarDays(s, 7)));
    expect(iso(computeDueAt(s, 2, 'business_days'))).toBe(iso(addBusinessDays(s, 2)));
  });
});

describe('businessDaysLate', () => {
  it('is zero on the due day and before', () => {
    expect(businessDaysLate(et(2026, 10, 20, 17), et(2026, 10, 20, 23))).toBe(0);
    expect(businessDaysLate(et(2026, 10, 20, 17), et(2026, 10, 19, 9))).toBe(0);
  });

  it('counts business days after the due day', () => {
    // due Tue 10-20; Fri 10-23 is 3 days late
    expect(businessDaysLate(et(2026, 10, 20, 17), et(2026, 10, 23, 9))).toBe(3);
  });

  it('skips weekends', () => {
    // due Fri 10-23; Tue 10-27 is 2 late (Mon, Tue)
    expect(businessDaysLate(et(2026, 10, 23, 17), et(2026, 10, 27, 9))).toBe(2);
    // a Sunday adds nothing
    expect(businessDaysLate(et(2026, 10, 23, 17), et(2026, 10, 25, 9))).toBe(0);
  });

  it('is stable across the clock change', () => {
    // due Fri 10-30; Wed 11-04 is 3 late (Mon, Tue, Wed)
    expect(businessDaysLate(et(2026, 10, 30, 17), et(2026, 11, 4, 9))).toBe(3);
  });
});

describe('calendarDaysSince', () => {
  it('counts civil days in the zone', () => {
    expect(calendarDaysSince(et(2026, 10, 13, 23), et(2026, 10, 21, 1))).toBe(8);
    expect(calendarDaysSince(et(2026, 10, 21, 1), et(2026, 10, 13, 1))).toBe(0);
  });
});

describe('send window', () => {
  it('is open 08:00 to 18:00 on business days', () => {
    expect(isWithinSendWindow(et(2026, 10, 21, 8, 0))).toBe(true);
    expect(isWithinSendWindow(et(2026, 10, 21, 17, 59))).toBe(true);
    expect(isWithinSendWindow(et(2026, 10, 21, 18, 0))).toBe(false);
    expect(isWithinSendWindow(et(2026, 10, 21, 7, 59))).toBe(false);
    expect(isWithinSendWindow(et(2026, 10, 24, 10, 0))).toBe(false); // Saturday
  });

  it('moves a closed window to the next opening', () => {
    expect(iso(nextSendWindowStart(et(2026, 10, 21, 6)))).toBe(iso(et(2026, 10, 21, 8)));
    expect(iso(nextSendWindowStart(et(2026, 10, 21, 19)))).toBe(iso(et(2026, 10, 22, 8)));
    expect(iso(nextSendWindowStart(et(2026, 10, 23, 19)))).toBe(iso(et(2026, 10, 26, 8)));
    expect(iso(nextSendWindowStart(et(2026, 10, 24, 10)))).toBe(iso(et(2026, 10, 26, 8)));
  });

  it('returns the same instant when already open', () => {
    const d = et(2026, 10, 21, 9);
    expect(nextSendWindowStart(d)).toBe(d);
  });
});

describe('day helpers', () => {
  it('knows business days', () => {
    expect(isBusinessDay(et(2026, 10, 21, 12))).toBe(true);
    expect(isBusinessDay(et(2026, 11, 1, 12))).toBe(false);
  });

  it('bounds the civil day, even on the 25-hour day', () => {
    const start = startOfZonedDay(et(2026, 11, 1, 12));
    const end = endOfZonedDay(et(2026, 11, 1, 12));
    expect(iso(start)).toBe('2026-11-01T04:00:00.000Z'); // midnight EDT
    expect(iso(end)).toBe('2026-11-02T04:59:59.999Z'); // 25 hours later, midnight EST minus 1ms
  });
});
