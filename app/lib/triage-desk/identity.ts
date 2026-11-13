/**
 * The triage-desk lane: who it is on screen. A key under the Bast identity (minted later by the owner's script) that lets a Claude session read a
 * Triage card's conversation and make undoable edits to the card. Every change through it is stamped with the lane (Comment.actor_lane,
 * TaskQuestion.asked_by_lane, the card's change line) and shows on the card as "changed by a session".
 * Client-safe: no database and no node-only imports.
 */
export const TRIAGE_DESK_LANE = 'triage-desk';
export const TRIAGE_DESK_LABEL = 'a session';
/** The line a card shows for a change made through this lane. */
export const CHANGED_BY_SESSION = 'changed by a session';

/** True when a stored lane value (a lane list is comma separated) is the triage desk. */
export function isTriageDeskLaneValue(lane: string | null | undefined): boolean {
  return (lane ?? '').split(',').some((l) => l.trim() === TRIAGE_DESK_LANE);
}
