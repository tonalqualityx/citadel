import { describe, it, expect } from 'vitest';
import { calculateBillingEstimates } from '../billing';

describe('calculateBillingEstimates', () => {
  it('returns actual time when no energy estimate', () => {
    const result = calculateBillingEstimates({
      time_spent_minutes: 120,
    });
    expect(result).toEqual({ low: 120, mid: 120, high: 120, actual: 120 });
  });

  it('applies mystery factor only (no battery specified, defaults to average_drain)', () => {
    const result = calculateBillingEstimates({
      time_spent_minutes: 45,
      energy_estimate: 3, // 60 min
      mystery_factor: 'average', // 1.61
    });

    // low = 60, high = 60 * 1.61 * 1.1 (default battery) = 106
    const expectedHigh = Math.round(60 * 1.61 * 1.1);
    expect(result.low).toBe(60);
    expect(result.high).toBe(expectedHigh);
    expect(result.mid).toBe(Math.round((60 + expectedHigh) / 2));
    expect(result.actual).toBe(45);
  });

  it('applies battery multiplier (high_drain)', () => {
    const result = calculateBillingEstimates({
      time_spent_minutes: 0,
      energy_estimate: 3, // 60 min
      mystery_factor: 'average', // 1.61
      battery_impact: 'high_drain', // 1.61
    });

    const expectedHigh = Math.round(60 * 1.61 * 1.61);
    expect(result.low).toBe(60);
    expect(result.high).toBe(expectedHigh);
    expect(result.mid).toBe(Math.round((60 + expectedHigh) / 2));
  });

  it('applies energizing battery (multiplier 1.0)', () => {
    const result = calculateBillingEstimates({
      time_spent_minutes: 0,
      energy_estimate: 3, // 60 min
      mystery_factor: 'none', // 1.0
      battery_impact: 'energizing', // 1.0
    });

    // low = 60, high = 60 * 1.0 * 1.0 = 60
    expect(result.low).toBe(60);
    expect(result.high).toBe(60);
    expect(result.mid).toBe(60);
  });

  it('applies average_drain battery explicitly', () => {
    const result = calculateBillingEstimates({
      time_spent_minutes: 0,
      energy_estimate: 3, // 60 min
      mystery_factor: 'none', // 1.0
      battery_impact: 'average_drain', // 1.1
    });

    // low = 60, high = 60 * 1.0 * 1.1 = 66
    expect(result.low).toBe(60);
    expect(result.high).toBe(66);
  });

  it('handles no mystery factor (defaults to none)', () => {
    const result = calculateBillingEstimates({
      time_spent_minutes: 0,
      energy_estimate: 4, // 120 min
      battery_impact: 'high_drain', // 1.61
    });

    // mystery defaults to 'none' = 1.0, battery = 1.61
    const expectedHigh = Math.round(120 * 1.0 * 1.61);
    expect(result.low).toBe(120);
    expect(result.high).toBe(expectedHigh);
  });
});
