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

// Clarity Phase 3 (Seeing Stone Reckoning) — the arc workspace's next-touch panel: pure
// date-formatting/aging helpers, same logic/dumb-component split as the estimate badge
// above.

/** Formats an ISO next_touch timestamp for an <input type="date"> value (YYYY-MM-DD),
 *  or '' when unset — the inline editor's controlled-input value. */
export function nextTouchInputValue(nextTouch: string | null): string {
  if (!nextTouch) return '';
  return nextTouch.slice(0, 10);
}

/** True when next_touch is set and in the past relative to nowMs — the anti-drop-net's
 *  "aging" signal, rendered as a quiet warning tint on the arc workspace's own panel
 *  (never a guilt-shaped countdown, per the DON'T-BUILD list). */
export function isNextTouchOverdue(nextTouch: string | null, nowMs: number): boolean {
  if (!nextTouch) return false;
  const t = new Date(nextTouch).getTime();
  if (Number.isNaN(t)) return false;
  return t < nowMs;
}
