import { energyToMinutes, getMysteryMultiplier } from './energy';

export type EstimateType = 'actual' | 'low' | 'mid' | 'high';

export interface TaskForBilling {
  billing_amount?: number | null;
  time_spent_minutes: number;
  energy_estimate?: number | null;
  mystery_factor?: string | null;
}

export interface BillingEstimates {
  low: number;      // Base energy estimate (no mystery factor)
  mid: number;      // Average of low and high
  high: number;     // Energy × mystery factor
  actual: number;   // Actual time spent
}

/**
 * Calculate the billing estimates for a task in minutes
 * Returns low/mid/high/actual minute values for billing calculation
 */
export function calculateBillingEstimates(task: TaskForBilling): BillingEstimates {
  const actual = task.time_spent_minutes || 0;

  if (!task.energy_estimate) {
    // No energy estimate - all values default to actual time
    return { low: actual, mid: actual, high: actual, actual };
  }

  const baseMinutes = energyToMinutes(task.energy_estimate);
  const mysteryFactor = (task.mystery_factor as 'none' | 'average' | 'significant' | 'no_idea') || 'none';
  const multiplier = getMysteryMultiplier(mysteryFactor);

  const low = baseMinutes;
  const high = Math.round(baseMinutes * multiplier);
  const mid = Math.round((low + high) / 2);

  return { low, mid, high, actual };
}

/**
 * Calculate the billing amount for a task
 *
 * @param task - Task with billing data
 * @param hourlyRate - Client/project hourly rate
 * @param estimateType - Which estimate to use (actual/low/mid/high)
 * @returns Billing amount in dollars, or null if can't calculate
 */
export function calculateBillingAmount(
  task: TaskForBilling,
  hourlyRate: number | null,
  estimateType: EstimateType = 'mid'
): number | null {
  // If task has explicit billing_amount, use that
  if (task.billing_amount != null && task.billing_amount > 0) {
    return task.billing_amount;
  }

  // Need hourly rate to calculate
  if (!hourlyRate || hourlyRate <= 0) {
    return null;
  }

  const estimates = calculateBillingEstimates(task);
  const minutes = estimates[estimateType];

  // Calculate: (minutes / 60) × hourlyRate
  return Math.round((minutes / 60) * hourlyRate * 100) / 100;
}

/**
 * Format a billing amount as currency
 */
export function formatCurrency(amount: number | null): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Get the label for an estimate type
 */
export function getEstimateTypeLabel(type: EstimateType): string {
  const labels: Record<EstimateType, string> = {
    actual: 'Actual',
    low: 'Low',
    mid: 'Mid',
    high: 'High',
  };
  return labels[type];
}
