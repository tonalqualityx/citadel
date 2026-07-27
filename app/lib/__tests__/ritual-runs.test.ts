import { describe, it, expect } from 'vitest';
import { isRitualSatisfied, isNoOpDay, ritualGateCopy, RITUAL_GATE_COPY } from '../ritual-runs';

describe('isRitualSatisfied', () => {
  it('is false with no row at all', () => {
    expect(isRitualSatisfied(null)).toBe(false);
    expect(isRitualSatisfied(undefined)).toBe(false);
  });

  it('is false when neither ran_at nor bailed_at is set', () => {
    expect(isRitualSatisfied({ ran_at: null, bailed_at: null })).toBe(false);
  });

  it('is true once ran_at is set', () => {
    expect(isRitualSatisfied({ ran_at: '2026-07-27T09:00:00.000Z', bailed_at: null })).toBe(true);
  });

  it('is true once bailed_at is set', () => {
    expect(isRitualSatisfied({ ran_at: null, bailed_at: '2026-07-27T09:00:00.000Z' })).toBe(true);
  });

  it('is true when both are set (bailed, then the ritual ran later)', () => {
    expect(
      isRitualSatisfied({ ran_at: '2026-07-27T11:00:00.000Z', bailed_at: '2026-07-27T09:00:00.000Z' })
    ).toBe(true);
  });
});

describe('isNoOpDay', () => {
  it('is true with zero picks and no crisis', () => {
    expect(isNoOpDay(0, false)).toBe(true);
  });

  it('is false with any picks', () => {
    expect(isNoOpDay(1, false)).toBe(false);
  });

  it('is false with a crisis even if zero picks', () => {
    expect(isNoOpDay(0, true)).toBe(false);
  });
});

describe('ritualGateCopy', () => {
  it('returns the softened no-op copy on a no-op day', () => {
    expect(ritualGateCopy(true)).toBe(RITUAL_GATE_COPY.noOp);
  });

  it('returns the normal copy otherwise', () => {
    expect(ritualGateCopy(false)).toBe(RITUAL_GATE_COPY.normal);
  });
});
