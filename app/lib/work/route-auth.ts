/**
 * Work stage D: who may call the three work routes. The owner's browser session (an admin), or a machine lane the plan names for that
 * route. A lane key is also held to its own route list by lane-scopes.ts; this is the second check, inside the route.
 */
import { AuthError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { isOracleBot } from '@/lib/oracle/helpers';
import type { AttachedBy } from './links';

export const STATE_LANES = ['bast', 'oracle', 'bast-chat', 'porter'] as const;
export const ATTACH_LANES = ['porter', 'oracle', 'bast-chat'] as const;
export const EVIDENCE_LANES = ['bast', 'courier', 'porter', 'oracle'] as const;

type CallerAuth = Pick<AuthPayload, 'role' | 'lane'> & Partial<Pick<AuthPayload, 'email' | 'via'>>;

/**
 * The oracle service user's own machine key carries no lane:<name> scope in production (lanes come only from a lane: entry in a key's
 * scopes, so an unscoped key reaches the route with no lane). That key, and only that key, stands in for the oracle lane: an API key,
 * no lane, whose user is the oracle service user (isOracleBot). Any other unlaned non-admin key stays refused.
 */
export function isUnlanedOracleKey(auth: CallerAuth): boolean {
  return !auth.lane && auth.via === 'api_key' && isOracleBot(auth);
}

export function requireWorkCaller(auth: CallerAuth, lanes: readonly string[]): void {
  if (auth.role === 'admin') return;
  if (auth.lane && lanes.includes(auth.lane)) return;
  if (lanes.includes('oracle') && isUnlanedOracleKey(auth)) return;
  throw new AuthError('Insufficient permissions', 403);
}

/** Who attached: the porter (intake) is `intake`; the owner's own session is `mike`; every other lane is `bast`. */
export function attachedByFor(auth: CallerAuth): AttachedBy {
  if (auth.lane === 'porter') return 'intake';
  if (auth.lane || isUnlanedOracleKey(auth)) return 'bast';
  return 'mike';
}

/** Work stage E: the session routes belong to the oracle lane (the session hooks) and the owner's own session. */
export const SESSION_LANES = ['oracle'] as const;

/** A session's external id as a URL part: a short safe token (the same rule a session card id uses). */
export const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,255}$/;
