import { describe, it, expect } from 'vitest';
import {
  MYSTERY_MULTIPLIERS,
  BATTERY_MULTIPLIERS,
  getMysteryMultiplier,
  getBatteryMultiplier,
  calculateEstimatedMinutes,
  energyToMinutes,
  calculateProjectEstimates,
} from '../energy';

describe('MYSTERY_MULTIPLIERS', () => {
  it('has correct values aligned with UI', () => {
    expect(MYSTERY_MULTIPLIERS.none).toBe(1.0);
    expect(MYSTERY_MULTIPLIERS.average).toBe(1.61);
    expect(MYSTERY_MULTIPLIERS.significant).toBe(2.5);
    expect(MYSTERY_MULTIPLIERS.no_idea).toBe(4.2);
  });
});

describe('BATTERY_MULTIPLIERS', () => {
  it('has correct values', () => {
    expect(BATTERY_MULTIPLIERS.average_drain).toBe(1.1);
    expect(BATTERY_MULTIPLIERS.high_drain).toBe(1.61);
    expect(BATTERY_MULTIPLIERS.energizing).toBe(1.0);
  });
});

describe('getMysteryMultiplier', () => {
  it('returns correct multiplier for each factor', () => {
    expect(getMysteryMultiplier('none')).toBe(1.0);
    expect(getMysteryMultiplier('average')).toBe(1.61);
    expect(getMysteryMultiplier('significant')).toBe(2.5);
    expect(getMysteryMultiplier('no_idea')).toBe(4.2);
  });
});

describe('getBatteryMultiplier', () => {
  it('returns correct multiplier for each impact', () => {
    expect(getBatteryMultiplier('average_drain')).toBe(1.1);
    expect(getBatteryMultiplier('high_drain')).toBe(1.61);
    expect(getBatteryMultiplier('energizing')).toBe(1.0);
  });
});

describe('calculateEstimatedMinutes', () => {
  it('returns null for null energy estimate', () => {
    expect(calculateEstimatedMinutes(null, 'none')).toBeNull();
  });

  it('returns null for undefined energy estimate', () => {
    expect(calculateEstimatedMinutes(undefined, 'none')).toBeNull();
  });

  it('calculates with mystery only (default battery = average_drain)', () => {
    // energy 3 = 60 min, mystery none = 1.0, battery average_drain = 1.1
    expect(calculateEstimatedMinutes(3, 'none')).toBe(Math.round(60 * 1.0 * 1.1));
  });

  it('calculates with mystery and explicit battery', () => {
    // energy 3 = 60 min, mystery average = 1.61, battery high_drain = 1.61
    expect(calculateEstimatedMinutes(3, 'average', 'high_drain')).toBe(Math.round(60 * 1.61 * 1.61));
  });

  it('calculates with energizing battery (multiplier 1.0)', () => {
    // energy 3 = 60 min, mystery none = 1.0, battery energizing = 1.0
    expect(calculateEstimatedMinutes(3, 'none', 'energizing')).toBe(60);
  });

  it('calculates with high mystery and high drain', () => {
    // energy 5 = 240 min, mystery no_idea = 4.2, battery high_drain = 1.61
    expect(calculateEstimatedMinutes(5, 'no_idea', 'high_drain')).toBe(Math.round(240 * 4.2 * 1.61));
  });

  it('rounds to nearest integer', () => {
    // energy 1 = 15 min, mystery average = 1.61, battery average_drain = 1.1
    // 15 * 1.61 * 1.1 = 26.565 → 27
    expect(calculateEstimatedMinutes(1, 'average', 'average_drain')).toBe(Math.round(15 * 1.61 * 1.1));
  });
});

describe('calculateProjectEstimates', () => {
  it('includes battery impact in max calculation for incomplete tasks', () => {
    const tasks = [
      {
        status: 'in_progress',
        energy_estimate: 3, // 60 min
        mystery_factor: 'average' as const, // 1.61
        battery_impact: 'high_drain' as const, // 1.61
        estimated_minutes: null,
      },
    ];

    const result = calculateProjectEstimates(tasks);

    // Min = 60 min = 1 hr
    expect(result.estimatedHoursMin).toBe(1);
    // Max = 60 * 1.61 * 1.61 = 155.5... → round to 156 min = 2.6 hrs
    const expectedMax = Math.round(60 * 1.61 * 1.61);
    expect(result.estimatedHoursMax).toBe(Math.round(expectedMax / 60 * 10) / 10);
  });

  it('defaults battery to average_drain when not specified', () => {
    const tasks = [
      {
        status: 'not_started',
        energy_estimate: 3, // 60 min
        mystery_factor: 'none' as const, // 1.0
        estimated_minutes: null,
      },
    ];

    const result = calculateProjectEstimates(tasks);

    // Min = 60 min = 1 hr
    expect(result.estimatedHoursMin).toBe(1);
    // Max = 60 * 1.0 * 1.1 = 66 min = 1.1 hrs
    expect(result.estimatedHoursMax).toBe(1.1);
  });

  it('uses energizing battery (1.0) correctly', () => {
    const tasks = [
      {
        status: 'not_started',
        energy_estimate: 3, // 60 min
        mystery_factor: 'none' as const,
        battery_impact: 'energizing' as const, // 1.0
        estimated_minutes: null,
      },
    ];

    const result = calculateProjectEstimates(tasks);

    // Min = 60, Max = 60 * 1.0 * 1.0 = 60
    expect(result.estimatedHoursMin).toBe(1);
    expect(result.estimatedHoursMax).toBe(1);
    expect(result.estimatedRange).toBe('1 hrs');
  });

  it('excludes done and abandoned tasks from incomplete calculations', () => {
    const tasks = [
      {
        status: 'done',
        energy_estimate: 3,
        mystery_factor: 'no_idea' as const,
        battery_impact: 'high_drain' as const,
        estimated_minutes: null,
      },
    ];

    const result = calculateProjectEstimates(tasks);

    // Completed task should contribute to completedEnergyMinutes, not incomplete
    expect(result.completedTaskCount).toBe(1);
    expect(result.completedEnergyMinutes).toBe(60); // baseMinutes for energy 3
  });
});
