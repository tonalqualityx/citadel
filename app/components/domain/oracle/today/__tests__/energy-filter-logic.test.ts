import { describe, it, expect } from 'vitest';
import { matchesEnergyFilter, filterPicksByEnergy } from '../energy-filter-logic';

function pick(task: { energy_estimate: number | null; battery_impact: string | null; mystery_factor: string | null } | null) {
  return { item_type: task ? 'task' : 'arc', task };
}

describe('matchesEnergyFilter', () => {
  it('"all" always matches', () => {
    expect(matchesEnergyFilter(pick(null), 'all')).toBe(true);
    expect(matchesEnergyFilter(pick({ energy_estimate: 8, battery_impact: 'high_drain', mystery_factor: 'none' }), 'all')).toBe(true);
  });

  it('non-task picks (arc/session/lead/note) always pass through, regardless of filter', () => {
    expect(matchesEnergyFilter(pick(null), 'low_energy')).toBe(true);
    expect(matchesEnergyFilter(pick(null), 'deep_work')).toBe(true);
  });

  describe('low_energy', () => {
    it('matches energy_estimate <= 3', () => {
      expect(matchesEnergyFilter(pick({ energy_estimate: 3, battery_impact: 'average_drain', mystery_factor: 'none' }), 'low_energy')).toBe(true);
      expect(matchesEnergyFilter(pick({ energy_estimate: 4, battery_impact: 'average_drain', mystery_factor: 'none' }), 'low_energy')).toBe(false);
    });

    it('matches battery_impact=energizing regardless of energy_estimate', () => {
      expect(matchesEnergyFilter(pick({ energy_estimate: 8, battery_impact: 'energizing', mystery_factor: 'none' }), 'low_energy')).toBe(true);
    });

    it('a task with no signal at all does not match', () => {
      expect(matchesEnergyFilter(pick({ energy_estimate: null, battery_impact: 'average_drain', mystery_factor: 'none' }), 'low_energy')).toBe(false);
    });
  });

  describe('deep_work', () => {
    it('matches energy_estimate >= 6', () => {
      expect(matchesEnergyFilter(pick({ energy_estimate: 6, battery_impact: 'average_drain', mystery_factor: 'none' }), 'deep_work')).toBe(true);
      expect(matchesEnergyFilter(pick({ energy_estimate: 5, battery_impact: 'average_drain', mystery_factor: 'none' }), 'deep_work')).toBe(false);
    });

    it('matches mystery_factor=significant regardless of energy_estimate', () => {
      expect(matchesEnergyFilter(pick({ energy_estimate: 1, battery_impact: 'average_drain', mystery_factor: 'significant' }), 'deep_work')).toBe(true);
    });

    it('a task with no signal at all does not match', () => {
      expect(matchesEnergyFilter(pick({ energy_estimate: null, battery_impact: 'average_drain', mystery_factor: 'none' }), 'deep_work')).toBe(false);
    });
  });
});

describe('filterPicksByEnergy', () => {
  it('returns the same array reference-equivalent list for "all"', () => {
    const picks = [pick(null), pick({ energy_estimate: 1, battery_impact: 'average_drain', mystery_factor: 'none' })];
    expect(filterPicksByEnergy(picks, 'all')).toEqual(picks);
  });

  it('filters down to only matching picks for a real filter', () => {
    const low = pick({ energy_estimate: 2, battery_impact: 'average_drain', mystery_factor: 'none' });
    const high = pick({ energy_estimate: 8, battery_impact: 'high_drain', mystery_factor: 'none' });
    const arc = pick(null);
    expect(filterPicksByEnergy([low, high, arc], 'low_energy')).toEqual([low, arc]);
  });
});
