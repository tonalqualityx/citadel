/**
 * Work stage D: who may call the three work routes. The owner's browser session (an admin), or a machine lane the plan names for that
 * route. A lane key is also held to its own route list by lane-scopes.ts; this is the second check, inside the route.
 */
import { AuthError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import type { AttachedBy } from './links';

export const STATE_LANES = ['bast', 'oracle', 'bast-chat', 'porter'] as const;
export const ATTACH_LANES = ['porter', 'oracle', 'bast-chat'] as const;
export const EVIDENCE_LANES = ['bast', 'courier', 'porter', 'oracle'] as const;

export function requireWorkCaller(auth: Pick<AuthPayload, 'role' | 'lane'>, lanes: readonly string[]): void {
  if (auth.role === 'admin') return;
  if (auth.lane && lanes.includes(auth.lane)) return;
  throw new AuthError('Insufficient permissions', 403);
}

/** Who attached: the porter (intake) is `intake`; the owner's own session is `mike`; every other lane is `bast`. */
export function attachedByFor(auth: Pick<AuthPayload, 'role' | 'lane'>): AttachedBy {
  if (auth.lane === 'porter') return 'intake';
  if (auth.lane) return 'bast';
  return 'mike';
}
