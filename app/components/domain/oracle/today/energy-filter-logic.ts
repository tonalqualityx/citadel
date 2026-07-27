// Clarity Phase 3 (Seeing Stone Reckoning, spec Q9/G10) — Today's energy filter chips.
// Pure, dependency-free (no React) per the repo's logic/dumb-component convention. A
// VIEW filter only — it never reorders or mutates stored picks, only decides what's
// rendered — same discipline as the list/board lens toggle.

export type EnergyFilterValue = 'all' | 'low_energy' | 'deep_work';

export const ENERGY_FILTER_OPTIONS: { value: EnergyFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'low_energy', label: 'Low-energy wins' },
  { value: 'deep_work', label: 'Deep work' },
];

export interface EnergyFilterableTask {
  energy_estimate: number | null;
  battery_impact: string | null;
  mystery_factor: string | null;
}

export interface EnergyFilterablePick {
  item_type: string;
  task: EnergyFilterableTask | null;
}

/**
 * Whether a pick survives the given energy filter. Filters apply ONLY to task-backed
 * picks — an arc/session/lead/note pick always passes through (energy is a task-level
 * concept; those item types have no energy fields to filter on at all). A task pick
 * with no matching signal (untagged energy_estimate, default battery_impact/
 * mystery_factor) is filtered OUT like any other non-match — this is a real filter,
 * not a soft nudge that always shows everything.
 */
export function matchesEnergyFilter(pick: EnergyFilterablePick, filter: EnergyFilterValue): boolean {
  if (filter === 'all') return true;
  if (!pick.task) return true;

  const { energy_estimate, battery_impact, mystery_factor } = pick.task;

  if (filter === 'low_energy') {
    return (energy_estimate != null && energy_estimate <= 3) || battery_impact === 'energizing';
  }

  // deep_work
  return (energy_estimate != null && energy_estimate >= 6) || mystery_factor === 'significant';
}

export function filterPicksByEnergy<T extends EnergyFilterablePick>(
  picks: T[],
  filter: EnergyFilterValue
): T[] {
  if (filter === 'all') return picks;
  return picks.filter((p) => matchesEnergyFilter(p, filter));
}
