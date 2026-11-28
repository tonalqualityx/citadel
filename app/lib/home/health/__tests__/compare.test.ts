import { describe, it, expect } from 'vitest';
import { MIN_HISTORY_DAYS, needsALook, twelveWeekAverage, weeklyTotals, windowStart } from '../compare';

const TODAY = '2026-11-28';
const daysBack = (n: number): string => {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe('twelveWeekAverage', () => {
  it('averages the 84 days before today and leaves today and older days out', () => {
    const points = [
      { day: TODAY, value: 1000 }, // today: never part of its own usual
      { day: daysBack(85), value: 1000 }, // outside the window
      ...Array.from({ length: 10 }, (_, i) => ({ day: daysBack(i + 1), value: 100 })),
    ];
    expect(windowStart(TODAY)).toBe(daysBack(84));
    expect(twelveWeekAverage(points, TODAY)).toEqual({ average: 100, days: 10 });
  });

  it('gives no usual with less than a week of history', () => {
    const points = Array.from({ length: MIN_HISTORY_DAYS - 1 }, (_, i) => ({ day: daysBack(i + 1), value: 5 }));
    expect(twelveWeekAverage(points, TODAY)).toEqual({ average: null, days: MIN_HISTORY_DAYS - 1 });
  });
});

describe('needsALook', () => {
  it('flags a move the bad way of more than a quarter and at least the floor', () => {
    expect(needsALook(1300, 1000, 'up_is_bad', 200)).toBe(true);
    expect(needsALook(1200, 1000, 'up_is_bad', 200)).toBe(false); // exactly a fifth: normal
    expect(needsALook(1300, 1000, 'up_is_bad', 500)).toBe(false); // under the floor
    expect(needsALook(700, 1000, 'up_is_bad', 1)).toBe(false); // the good way
    expect(needsALook(2, 4, 'down_is_bad', 1)).toBe(true);
    expect(needsALook(5, 4, 'down_is_bad', 1)).toBe(false);
  });

  it('never flags without a usual, and treats any rise past the floor from zero as news', () => {
    expect(needsALook(10, null, 'up_is_bad', 1)).toBe(false);
    expect(needsALook(2, 0, 'up_is_bad', 2)).toBe(true);
    expect(needsALook(1, 0, 'up_is_bad', 2)).toBe(false);
  });
});

describe('weeklyTotals', () => {
  it('counts each event in its week before this one, leaving this week out', () => {
    const totals = weeklyTotals([TODAY, daysBack(6), daysBack(7), daysBack(13), daysBack(14), daysBack(83), daysBack(84)], TODAY);
    expect(totals).toHaveLength(12);
    expect(totals[0]).toBe(2); // 7 and 13 days back
    expect(totals[1]).toBe(1); // 14 days back
    expect(totals[10]).toBe(1); // 83 days back
    expect(totals[11]).toBe(1); // 84 days back
    expect(totals.reduce((s, n) => s + n, 0)).toBe(5);
  });
});
