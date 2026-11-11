/**
 * A session card is a question a session parked on the owner (OracleSession.waiting_on). The session's own record is never
 * touched by the screen: the session's heartbeat re-sends its manifest every cycle, so a cleared waiting_on would come straight
 * back. Instead "Clear it" remembers the text it cleared (a sha256) on the owner's home_item_state row, and the card stays
 * hidden while the session's waiting_on still hashes the same. A different text is a new question and shows again.
 * Pure: no database in here.
 */

import { createHash } from 'node:crypto';
import type { RawItemState } from './types';

export const SESSION_CLEARED_MESSAGE = 'Cleared. It comes back if the session asks something new.';

/** The text compared across a heartbeat: collapsed whitespace, trimmed. Case is kept (a recased ask is a new ask). */
export function sessionAskComparable(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** sha256 hex of the comparable text. */
export function sessionAskHash(text: string | null | undefined): string {
  return createHash('sha256').update(sessionAskComparable(text)).digest('hex');
}

/** True while the owner's cleared hash is the hash of the session's current ask. */
export function sessionAskIsCleared(
  waitingOn: string | null | undefined,
  state: Pick<RawItemState, 'session_cleared_at' | 'session_cleared_hash'> | undefined | null
): boolean {
  if (!state?.session_cleared_at || !state.session_cleared_hash) return false;
  return state.session_cleared_hash === sessionAskHash(waitingOn);
}
