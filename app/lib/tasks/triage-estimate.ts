/**
 * The default estimate of a project card (Mike, 2026-11-13: "default project triage tasks to 1 hour").
 *
 * HOW A TASK'S MINUTES REALLY WORK: `estimated_minutes` is not an input. The task PATCH and create paths write it only as
 * round(energyToMinutes(energy_estimate) x mystery multiplier x battery multiplier) (lib/calculations/energy.ts), and every reader
 * (the card, the home screen's "About N minutes", the size of the day: lib/home/select.ts taskMinutes) uses a positive estimated_minutes
 * first, else the same formula on the three inputs. A PATCH of estimated_minutes alone is dropped by the schema.
 *
 * So the default is set through the inputs, which the existing formula expresses exactly: energy 3 (60 minutes) x mystery none (1.0) x
 * battery energizing (1.0) = 60, and estimated_minutes is stored as that same 60 so the stored column and the calculated value agree.
 * No override is needed. A marker tag lets a later change of kind tell this default from numbers a person set: it is undone only while
 * all four values are still exactly the default, so anything Mike changes (even to 60 by another route) stays. The default is never written over a mystery
 * or battery value he set. Undoing start_project clears a defaulted value the same way (lib/bast-chat/ops/start-project.ts).
 */
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';

export const TRIAGE_PROJECT_SETUP_MINUTES = 60;
export const TRIAGE_DEFAULT_ESTIMATE_TAG = 'triage-default-estimate';
/** The inputs that yield exactly TRIAGE_PROJECT_SETUP_MINUTES under the existing formula (a test pins this). */
const DEFAULT_INPUTS = { energy_estimate: 3, mystery_factor: 'none', battery_impact: 'energizing' } as const;
/** What the schema gives a task with no estimate. */
const UNSET = { energy_estimate: null, estimated_minutes: null, mystery_factor: 'none', battery_impact: 'average_drain' } as const;

export interface EstimateState {
  estimated_minutes: number | null;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  tags: string[];
}
export type EstimateWrite = Pick<EstimateState, 'estimated_minutes' | 'energy_estimate' | 'mystery_factor' | 'battery_impact' | 'tags'>;

/** The minutes the default inputs calculate to. */
export const defaultCalculatedMinutes = (): number => calculateEstimatedMinutes(DEFAULT_INPUTS.energy_estimate, DEFAULT_INPUTS.mystery_factor, DEFAULT_INPUTS.battery_impact) as number;

const isDefault = (c: EstimateState): boolean =>
  c.energy_estimate === DEFAULT_INPUTS.energy_estimate && c.mystery_factor === DEFAULT_INPUTS.mystery_factor && c.battery_impact === DEFAULT_INPUTS.battery_impact && c.estimated_minutes === TRIAGE_PROJECT_SETUP_MINUTES;

/** What to write when a card's kind goes from `before` to `after`. Null means nothing changes. */
export function estimatePatchForKind(before: string | null, after: string | null, card: EstimateState): EstimateWrite | null {
  const marked = card.tags.includes(TRIAGE_DEFAULT_ESTIMATE_TAG);
  if (after === 'project_setup') {
    // Only a card with no estimate at all gets it: no energy estimate, no minutes, and no mystery or battery the owner set (those two are inputs too, and a
    // default must never overwrite an input he chose). With either set, nothing is defaulted.
    if (card.energy_estimate !== null || card.estimated_minutes !== null) return null;
    if (card.mystery_factor !== UNSET.mystery_factor || card.battery_impact !== UNSET.battery_impact) return null;
    return { ...DEFAULT_INPUTS, estimated_minutes: TRIAGE_PROJECT_SETUP_MINUTES, tags: marked ? card.tags : [...card.tags, TRIAGE_DEFAULT_ESTIMATE_TAG] };
  }
  if (before === 'project_setup' && marked) {
    const tags = card.tags.filter((t) => t !== TRIAGE_DEFAULT_ESTIMATE_TAG);
    if (isDefault(card)) return { ...UNSET, tags };
    return { estimated_minutes: card.estimated_minutes, energy_estimate: card.energy_estimate, mystery_factor: card.mystery_factor, battery_impact: card.battery_impact, tags };
  }
  return null;
}
