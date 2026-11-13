/**
 * Dox, the office manager: who it is on screen. Dox is a real Citadel user (dox@indelible.bot, migration 20261121090000_dox_user, a
 * bot user like Bast with no password login). Until his `dox` lane key is minted for that user (slice 1b) he still runs as the Bast
 * user, so its comments carry Comment.actor_lane = 'dox' and its questions TaskQuestion.asked_by_lane = 'dox' (both stamped from the key, never from the body).
 * Client-safe: no database and no node-only imports.
 */
export const DOX_LANE = 'dox';
/** Dox's user id: the one the migration inserts, and the one listed in gate.json bot_user_ids, BOT_USER_IDS and gate-mirror.ts. */
export const DOX_USER_ID = '1797579d-2c5e-42de-8366-c38be92ee1ae';
export const DOX_SERVICE_EMAIL = 'dox@indelible.bot';
export const DOX_LABEL = 'Dox';

/** True when a stored lane value (a lane list is comma separated) is Dox. */
export function isDoxLaneValue(lane: string | null | undefined): boolean {
  return (lane ?? '').split(',').some((l) => l.trim() === DOX_LANE);
}

/** The name a comment or a question shows as its author: "Dox" for the Dox lane, else the user's own name. */
export function authorLabel(lane: string | null | undefined, userName: string | null | undefined, fallback = 'Unknown'): string {
  if (isDoxLaneValue(lane)) return DOX_LABEL;
  if ((lane ?? '').split(',').some((l) => l.trim() === 'triage-desk')) return 'A session';
  return userName || fallback;
}

/** Dox himself, and only Dox: his service email AND the dox lane AND an enforced API key (modelled on isDesignWorker). */
export function isDox(
  auth: { email?: string | null; lane?: string | null; via?: string | null; laneEnforced?: boolean | null } | null | undefined,
): boolean {
  if (!auth) return false;
  return (
    auth.via === 'api_key' &&
    typeof auth.email === 'string' &&
    auth.email.toLowerCase() === DOX_SERVICE_EMAIL &&
    auth.lane === DOX_LANE &&
    auth.laneEnforced === true
  );
}
