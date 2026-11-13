/**
 * Dox, the office manager: who it is on screen. Dox runs as the Bast user through the `dox` lane key, so its comments carry
 * Comment.actor_lane = 'dox' and its questions TaskQuestion.asked_by_lane = 'dox' (both stamped from the key, never from the body).
 * Client-safe: no database and no node-only imports.
 */
export const DOX_LANE = 'dox';
export const DOX_LABEL = 'Dox';

/** True when a stored lane value (a lane list is comma separated) is Dox. */
export function isDoxLaneValue(lane: string | null | undefined): boolean {
  return (lane ?? '').split(',').some((l) => l.trim() === DOX_LANE);
}

/** The name a comment or a question shows as its author: "Dox" for the Dox lane, else the user's own name. */
export function authorLabel(lane: string | null | undefined, userName: string | null | undefined, fallback = 'Unknown'): string {
  if (isDoxLaneValue(lane)) return DOX_LABEL;
  return userName || fallback;
}
