/**
 * Who the front session is (project "Front session for Bast", 1e374bad). Kept apart from release.ts so lib/tasks/questions.ts can ask
 * without importing the release path (release.ts imports lib/tasks/triage.ts, which imports questions.ts).
 */
import type { AuthPayload } from '@/lib/auth/middleware';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

export const FRONT_SESSION_LANE = 'front-session';

/** True for an enforced API key of the Bast user that carries the front-session lane (a stored lane value may be a comma list). */
export function isFrontSessionCaller(auth: Pick<AuthPayload, 'userId' | 'via' | 'lane' | 'laneEnforced'>): boolean {
  // The lane is minted for Bast (LANE_IDENTITY); the same scope on any other user's key releases nothing.
  if (auth.via !== 'api_key' || auth.laneEnforced !== true || auth.userId !== BAST_USER_ID) return false;
  return (auth.lane ?? '').split(',').some((l) => l.trim() === FRONT_SESSION_LANE);
}
