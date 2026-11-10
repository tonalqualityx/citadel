/**
 * Designer Portal v2: the Bast design-track runner's gate (SPEC 6.1a).
 *
 * `requireTrackRunner()` admits an API key whose lane is exactly `design-track` and whose key is enforced.
 * It is deliberately separate from `requireWorker()` (worker-kit.ts), which stays strict: a design-track key
 * fails `isDesignWorker()`, and a design-worker key fails here. Anonymous is 401, everyone else 403.
 */
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';

export const DESIGN_TRACK_LANE = 'design-track';

/** The runner, and only the runner: an API key on exactly the design-track lane, enforced. */
export function isTrackRunner(auth: Pick<AuthPayload, 'lane' | 'via' | 'laneEnforced'> | null | undefined): boolean {
  if (!auth) return false;
  return auth.via === 'api_key' && auth.lane === DESIGN_TRACK_LANE && auth.laneEnforced === true;
}

/** 401 anonymous; 403 for anyone who is not the design-track runner (a session, another lane, a shadow key). */
export async function requireTrackRunner(): Promise<AuthPayload> {
  const auth = await requireAuth();
  if (!isTrackRunner(auth)) throw new AuthError('The design track runner only', 403);
  return auth;
}
