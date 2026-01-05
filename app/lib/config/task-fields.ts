/**
 * Shared configuration for task-related field options.
 * These are used across SOPs, Tasks, and Recipe Tasks for consistency.
 */

// ============================================
// TASK STATUS (workflow status)
// ============================================

export const TASK_STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started', color: 'text-slate-700', bg: 'bg-slate-100' },
  { value: 'in_progress', label: 'In Progress', color: 'text-blue-700', bg: 'bg-blue-100' },
  { value: 'review', label: 'Review', color: 'text-amber-700', bg: 'bg-amber-100' },
  { value: 'done', label: 'Done', color: 'text-green-700', bg: 'bg-green-100' },
  { value: 'blocked', label: 'Blocked', color: 'text-red-700', bg: 'bg-red-100' },
  { value: 'abandoned', label: 'Abandoned', color: 'text-gray-500', bg: 'bg-gray-100' },
] as const;

export type TaskStatusValue = (typeof TASK_STATUS_OPTIONS)[number]['value'];

export function getTaskStatusOption(value: string | null | undefined) {
  return TASK_STATUS_OPTIONS.find((o) => o.value === value) || TASK_STATUS_OPTIONS[0]; // Default: Not Started
}

// ============================================
// PROJECT STATUS (workflow status)
// ============================================

export const PROJECT_STATUS_OPTIONS = [
  { value: 'quote', label: 'Quote', color: 'text-slate-700', bg: 'bg-slate-100' },
  { value: 'queue', label: 'Queue', color: 'text-blue-700', bg: 'bg-blue-100' },
  { value: 'ready', label: 'Ready', color: 'text-cyan-700', bg: 'bg-cyan-100' },
  { value: 'in_progress', label: 'In Progress', color: 'text-amber-700', bg: 'bg-amber-100' },
  { value: 'review', label: 'Review', color: 'text-purple-700', bg: 'bg-purple-100' },
  { value: 'done', label: 'Done', color: 'text-green-700', bg: 'bg-green-100' },
  { value: 'suspended', label: 'Suspended', color: 'text-orange-700', bg: 'bg-orange-100' },
  { value: 'cancelled', label: 'Cancelled', color: 'text-red-700', bg: 'bg-red-100' },
] as const;

export type ProjectStatusValue = (typeof PROJECT_STATUS_OPTIONS)[number]['value'];

export function getProjectStatusOption(value: string | null | undefined) {
  return PROJECT_STATUS_OPTIONS.find((o) => o.value === value) || PROJECT_STATUS_OPTIONS[0]; // Default: Quote
}

// ============================================
// ACTIVE STATUS (for SOPs, etc.)
// ============================================

export const STATUS_OPTIONS = [
  { value: true, label: 'Active', color: 'text-green-800', bg: 'bg-green-100', variant: 'success' as const },
  { value: false, label: 'Draft', color: 'text-slate-600', bg: 'bg-slate-100', variant: 'muted' as const },
] as const;

export function getStatusOption(value: boolean | null | undefined) {
  return STATUS_OPTIONS.find((o) => o.value === value) || STATUS_OPTIONS[1]; // Default: Draft
}

// ============================================
// PRIORITY
// ============================================

export const PRIORITY_OPTIONS = [
  { value: 1, label: 'Critical', color: 'text-red-800', bg: 'bg-red-100' },
  { value: 2, label: 'High', color: 'text-orange-800', bg: 'bg-orange-100' },
  { value: 3, label: 'Medium', color: 'text-amber-800', bg: 'bg-amber-100' },
  { value: 4, label: 'Low', color: 'text-green-800', bg: 'bg-green-100' },
] as const;

export type PriorityValue = (typeof PRIORITY_OPTIONS)[number]['value'];

export function getPriorityOption(value: number | null | undefined) {
  return PRIORITY_OPTIONS.find((o) => o.value === value) || PRIORITY_OPTIONS[2]; // Default: Medium
}

// ============================================
// ENERGY ESTIMATE (Time-based 1-8 scale)
// ============================================

export const ENERGY_OPTIONS = [
  { value: null, label: 'Not set', minutes: 0, color: 'text-text-sub', bg: 'bg-surface-alt' },
  { value: 1, label: '15 min', minutes: 15, color: 'text-green-800', bg: 'bg-green-100' },
  { value: 2, label: '30 min', minutes: 30, color: 'text-green-800', bg: 'bg-green-100' },
  { value: 3, label: '1 hour', minutes: 60, color: 'text-lime-800', bg: 'bg-lime-100' },
  { value: 4, label: '2 hours', minutes: 120, color: 'text-amber-800', bg: 'bg-amber-100' },
  { value: 5, label: 'Half day', minutes: 240, color: 'text-amber-800', bg: 'bg-amber-100' },
  { value: 6, label: 'Full day', minutes: 480, color: 'text-orange-800', bg: 'bg-orange-100' },
  { value: 7, label: '2 days', minutes: 960, color: 'text-orange-800', bg: 'bg-orange-100' },
  { value: 8, label: '4 days', minutes: 1920, color: 'text-red-800', bg: 'bg-red-100' },
] as const;

export type EnergyValue = (typeof ENERGY_OPTIONS)[number]['value'];

export function getEnergyOption(value: number | null | undefined) {
  return ENERGY_OPTIONS.find((o) => o.value === value) || ENERGY_OPTIONS[0]; // Default: Not set
}

// ============================================
// MYSTERY FACTOR (Uncertainty multiplier)
// ============================================

export const MYSTERY_OPTIONS = [
  { value: 'none', label: 'None', multiplier: 1.0, color: 'text-green-800', bg: 'bg-green-100' },
  { value: 'average', label: 'Some', multiplier: 1.61, color: 'text-amber-800', bg: 'bg-amber-100' },
  { value: 'significant', label: 'Significant', multiplier: 2.5, color: 'text-orange-800', bg: 'bg-orange-100' },
  { value: 'no_idea', label: 'No Idea', multiplier: 4.2, color: 'text-red-800', bg: 'bg-red-100' },
] as const;

export type MysteryValue = (typeof MYSTERY_OPTIONS)[number]['value'];

export function getMysteryOption(value: string | null | undefined) {
  return MYSTERY_OPTIONS.find((o) => o.value === value) || MYSTERY_OPTIONS[0]; // Default: None
}

// ============================================
// BATTERY IMPACT (Cognitive/emotional load)
// ============================================

export const BATTERY_OPTIONS = [
  { value: 'average_drain', label: 'Avg Drain', multiplier: 1.1, color: 'text-amber-800', bg: 'bg-amber-100' },
  { value: 'high_drain', label: 'High Drain', multiplier: 1.61, color: 'text-orange-800', bg: 'bg-orange-100' },
  { value: 'energizing', label: 'Energizing', multiplier: 1.0, color: 'text-green-800', bg: 'bg-green-100' },
] as const;

export type BatteryValue = (typeof BATTERY_OPTIONS)[number]['value'];

export function getBatteryOption(value: string | null | undefined) {
  return BATTERY_OPTIONS.find((o) => o.value === value) || BATTERY_OPTIONS[0]; // Default: Avg Drain
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format minutes into a human-readable duration string
 */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 480) return `${(minutes / 60).toFixed(1).replace('.0', '')} hrs`;
  return `${(minutes / 480).toFixed(1).replace('.0', '')} days`;
}

/**
 * Calculate the time range based on energy estimate, mystery factor, and battery impact.
 * Formula: High End = Energy × Mystery × Battery
 *          Middle = (Base + High) / 2
 */
export function calculateTimeRange(
  energyEstimate: number | null | undefined,
  mysteryFactor: string | null | undefined,
  batteryImpact?: string | null | undefined
): string | null {
  if (!energyEstimate) return null;

  const energyOption = getEnergyOption(energyEstimate);
  const mysteryOption = getMysteryOption(mysteryFactor);
  const batteryOption = getBatteryOption(batteryImpact);

  const baseMinutes = energyOption.minutes;
  if (baseMinutes === 0) return null;

  // High End = Energy × Mystery × Battery
  const highMinutes = Math.round(baseMinutes * mysteryOption.multiplier * batteryOption.multiplier);

  // Middle = (Base + High) / 2
  const middleMinutes = Math.round((baseMinutes + highMinutes) / 2);

  if (baseMinutes === highMinutes) {
    return formatMinutes(baseMinutes);
  }

  // Show range: base - high (with middle as the likely estimate)
  return `${formatMinutes(baseMinutes)} - ${formatMinutes(highMinutes)}`;
}

/**
 * Calculate detailed time estimates including middle ground
 */
export function calculateTimeEstimates(
  energyEstimate: number | null | undefined,
  mysteryFactor: string | null | undefined,
  batteryImpact?: string | null | undefined
): { base: number; middle: number; high: number } | null {
  if (!energyEstimate) return null;

  const energyOption = getEnergyOption(energyEstimate);
  const mysteryOption = getMysteryOption(mysteryFactor);
  const batteryOption = getBatteryOption(batteryImpact);

  const base = energyOption.minutes;
  if (base === 0) return null;

  const high = Math.round(base * mysteryOption.multiplier * batteryOption.multiplier);
  const middle = Math.round((base + high) / 2);

  return { base, middle, high };
}

// ============================================
// FORM SELECT ADAPTERS
// These convert our typed options to string-based options for forms
// ============================================

export const PRIORITY_SELECT_OPTIONS = PRIORITY_OPTIONS.map((o) => ({
  value: o.value.toString(),
  label: o.label,
}));

export const ENERGY_SELECT_OPTIONS = [
  { value: '', label: 'Not set' },
  ...ENERGY_OPTIONS.filter((o) => o.value !== null).map((o) => ({
    value: o.value!.toString(),
    label: o.label,
  })),
];

export const MYSTERY_SELECT_OPTIONS = MYSTERY_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

export const BATTERY_SELECT_OPTIONS = BATTERY_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));
