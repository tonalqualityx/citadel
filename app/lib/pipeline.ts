// Clarity Phase 3 (Seeing Stone Reckoning, spec Q1) — the sales pipeline lane. Accord
// keeps its real 7-stage status machine, but the glass collapses it to exactly THREE
// forward-motion-framed groupings (smallest workable taxonomy, per the research
// distillation's #8 anti-bloat principle) — the glass never renders the 7-stage status
// as the tracked thing, only "what moves it forward" (its own open arc, or a quiet
// "no active arc" marker — the signal Mike actually needs).

export type PipelineGroupKey = 'prospect' | 'in_motion' | 'closed';

const GROUP_BY_STATUS: Record<string, PipelineGroupKey> = {
  lead: 'prospect',
  meeting: 'prospect',
  proposal: 'in_motion',
  contract: 'in_motion',
  signed: 'closed',
  active: 'closed',
  lost: 'closed',
};

export function pipelineGroupForStatus(status: string): PipelineGroupKey {
  return GROUP_BY_STATUS[status] ?? 'closed';
}

/** Defensive cap per group — a long-lived business accrues a lot of `closed` accords over
 *  time; the pipeline lane is a "what's moving" glance, not a full CRM browse. */
export const PIPELINE_GROUP_CAP = 50;
