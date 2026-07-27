// Clarity Phase 7 (Seeing Stone Reckoning P2) — the ritual gate's pure logic. No React, no
// Prisma — same "pure sibling" discipline as lib/today-picks.ts and time-shape-logic.ts, so
// gate satisfaction and the softened no-op-day copy decision are unit-testable without a DB.

export const DEFAULT_RITUAL_KIND = 'morning';

export interface RitualRunState {
  ran_at: string | null;
  bailed_at: string | null;
}

/** The gate opens once EITHER the ritual session has POSTed ran, or Mike has explicitly
 *  bailed for the day — both are decisive, logged acts (never a passive "nothing happened
 *  so let's assume it's fine"). A day with no row at all is unsatisfied by definition. */
export function isRitualSatisfied(state: RitualRunState | null | undefined): boolean {
  if (!state) return false;
  return !!state.ran_at || !!state.bailed_at;
}

/**
 * Weekend/no-op days soften the cover's copy (never skip the gate itself — the spec is
 * explicit: "cover copy softens but still gates"). Only true when there is truly nothing
 * for the ritual to surface: zero Today picks and zero open crisis asks.
 */
export function isNoOpDay(pickCount: number, hasCrisis: boolean): boolean {
  return pickCount === 0 && !hasCrisis;
}

export const RITUAL_GATE_COPY = {
  normal: "The morning ritual hasn't run yet.",
  noOp: 'Quiet morning so far — nothing surfaced yet. The ritual will fill this in once it runs.',
} as const;

export function ritualGateCopy(noOpDay: boolean): string {
  return noOpDay ? RITUAL_GATE_COPY.noOp : RITUAL_GATE_COPY.normal;
}
