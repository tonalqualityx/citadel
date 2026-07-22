// Clarity Phase 4c — arc board header enrichment: pure, dependency-free formatting
// helpers for the time-estimate badge. Kept separate from ArcBoard.tsx (a dumb
// presentational component) per the repo's logic/dumb-component convention, so this is
// trivially unit-testable without rendering React.

/** "90" -> "1h 30m", "45" -> "45m", "120" -> "2h", "0" -> "0m". Never negative (the API's
 *  own bounds already reject a negative estimate; this just never renders one). */
export function formatEstimateMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.round(minutes));
  if (clamped === 0) return '0m';
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export interface ArcEstimateDisplay {
  text: string;
  isOverride: boolean;
}

/** The arc board header's time-estimate line: prefers the hand-set override when
 *  present ("~2h (set by hand)"), else the computed sum of open tasks' estimated_minutes
 *  ("~1h 30m estimated"). */
export function arcEstimateDisplay(
  estimatedMinutesTotal: number,
  overrideMinutes: number | null
): ArcEstimateDisplay {
  if (overrideMinutes !== null && overrideMinutes !== undefined) {
    return { text: `~${formatEstimateMinutes(overrideMinutes)} (set by hand)`, isOverride: true };
  }
  return { text: `~${formatEstimateMinutes(estimatedMinutesTotal)} estimated`, isOverride: false };
}
