import { MysteryFactor, BatteryImpact } from '@prisma/client';

const MYSTERY_MULTIPLIERS: Record<MysteryFactor, number> = {
  none: 1.0,
  average: 1.4,
  significant: 1.75,
  no_idea: 2.5,
};

// Energy to minutes mapping (based on your system)
const ENERGY_TO_MINUTES: Record<number, number> = {
  1: 15, // Quick task
  2: 30, // Half hour
  3: 60, // 1 hour
  4: 120, // 2 hours
  5: 240, // Half day
  6: 480, // Full day
  7: 960, // 2 days
  8: 1920, // 4 days
};

export function getMysteryMultiplier(factor: MysteryFactor): number {
  return MYSTERY_MULTIPLIERS[factor];
}

export function getMysteryFactorLabel(factor: MysteryFactor): string {
  const labels: Record<MysteryFactor, string> = {
    none: 'None',
    average: 'Average',
    significant: 'Significant',
    no_idea: 'No Idea',
  };
  return labels[factor];
}

export function calculateWeightedEnergy(
  baseEnergy: number,
  mysteryFactor: MysteryFactor
): number {
  const multiplier = getMysteryMultiplier(mysteryFactor);
  return baseEnergy * multiplier;
}

export function energyToMinutes(energy: number): number {
  const clamped = Math.max(1, Math.min(8, Math.round(energy)));
  return ENERGY_TO_MINUTES[clamped] ?? ENERGY_TO_MINUTES[3];
}

export function calculateEstimatedMinutes(
  energyEstimate: number | null,
  mysteryFactor: MysteryFactor
): number | null {
  if (!energyEstimate) return null;

  const baseMinutes = energyToMinutes(energyEstimate);
  const multiplier = getMysteryMultiplier(mysteryFactor);
  return Math.round(baseMinutes * multiplier);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (hours < 1) {
    return `${minutes}m`;
  }
  return `${hours.toFixed(1)}h`;
}

export function getEnergyLabel(energy: number): string {
  const labels: Record<number, string> = {
    1: '15 min',
    2: '30 min',
    3: '1 hour',
    4: '2 hours',
    5: 'Half day',
    6: 'Full day',
    7: '2 days',
    8: '4 days',
  };
  return labels[energy] ?? 'Unknown';
}

export function getEnergyColor(energy: number): string {
  if (energy <= 2) return 'text-green-600';
  if (energy <= 4) return 'text-amber-600';
  if (energy <= 6) return 'text-orange-600';
  return 'text-red-600';
}

// ============================================
// BATTERY IMPACT
// ============================================

export function getBatteryImpactLabel(impact: BatteryImpact): string {
  const labels: Record<BatteryImpact, string> = {
    average_drain: 'Avg Drain',
    high_drain: 'High Drain',
    energizing: 'Energizing',
  };
  return labels[impact];
}

export function getBatteryImpactVariant(impact: BatteryImpact): 'default' | 'warning' | 'success' {
  const variants: Record<BatteryImpact, 'default' | 'warning' | 'success'> = {
    average_drain: 'default',
    high_drain: 'warning',
    energizing: 'success',
  };
  return variants[impact];
}

export function getBatteryImpactIcon(impact: BatteryImpact): string {
  const icons: Record<BatteryImpact, string> = {
    average_drain: '⚡',
    high_drain: '🔋',
    energizing: '✨',
  };
  return icons[impact];
}

// ============================================
// PROJECT ESTIMATES
// ============================================

export interface TaskForEstimate {
  status: string;
  energy_estimate: number | null;
  mystery_factor: MysteryFactor;
  estimated_minutes: number | null;
}

export interface ProjectEstimates {
  estimatedHoursMin: number;     // Sum of task base energy (in hours)
  estimatedHoursMax: number;     // Sum of weighted energy (in hours)
  estimatedRange: string;        // e.g., "35-52 hrs"
  timeSpentMinutes: number;      // Sum of time entries
  taskCount: number;
  completedTaskCount: number;
  // Energy-weighted progress
  totalEnergyMinutes: number;    // Total energy effort across all tasks
  completedEnergyMinutes: number; // Completed energy effort
  progressPercent: number;       // Weighted by energy, not task count
}

export function calculateProjectEstimates(tasks: TaskForEstimate[], timeSpentMinutes: number = 0): ProjectEstimates {
  const incompleteTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'abandoned');
  const completedTasks = tasks.filter(t => t.status === 'done');

  // Sum of base energy estimates (in minutes, then convert to hours)
  let incompleteMinutesMin = 0;
  let incompleteMinutesMax = 0;

  for (const task of incompleteTasks) {
    if (task.energy_estimate) {
      // Base minutes from energy
      const baseMinutes = energyToMinutes(task.energy_estimate);
      incompleteMinutesMin += baseMinutes;

      // Weighted minutes with mystery factor
      const multiplier = getMysteryMultiplier(task.mystery_factor);
      incompleteMinutesMax += Math.round(baseMinutes * multiplier);
    } else if (task.estimated_minutes) {
      // If no energy estimate but has manual estimated_minutes, use that
      incompleteMinutesMin += task.estimated_minutes;
      incompleteMinutesMax += task.estimated_minutes;
    }
  }

  // Calculate completed task energy (for progress tracking)
  let completedEnergyMinutes = 0;
  for (const task of completedTasks) {
    if (task.energy_estimate) {
      const baseMinutes = energyToMinutes(task.energy_estimate);
      completedEnergyMinutes += baseMinutes;
    } else if (task.estimated_minutes) {
      completedEnergyMinutes += task.estimated_minutes;
    }
  }

  // Total energy is completed + incomplete
  const totalEnergyMinutes = completedEnergyMinutes + incompleteMinutesMin;

  const estimatedHoursMin = Math.round((incompleteMinutesMin + completedEnergyMinutes) / 60 * 10) / 10;
  const estimatedHoursMax = Math.round((incompleteMinutesMax + completedEnergyMinutes) / 60 * 10) / 10;

  // Format range
  let estimatedRange: string;
  if (estimatedHoursMin === estimatedHoursMax) {
    estimatedRange = `${estimatedHoursMin} hrs`;
  } else {
    estimatedRange = `${estimatedHoursMin}-${estimatedHoursMax} hrs`;
  }

  // Progress is weighted by energy effort, not task count
  // A completed 4-hour task contributes more to progress than a 15-min task
  const progressPercent = totalEnergyMinutes > 0
    ? Math.round((completedEnergyMinutes / totalEnergyMinutes) * 100)
    : 0;

  return {
    estimatedHoursMin,
    estimatedHoursMax,
    estimatedRange,
    timeSpentMinutes,
    taskCount: tasks.length,
    completedTaskCount: completedTasks.length,
    totalEnergyMinutes,
    completedEnergyMinutes,
    progressPercent,
  };
}
