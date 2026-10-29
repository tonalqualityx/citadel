/**
 * The grant rule for HUMAN_GRANTED_SCOPES (decisions:admin, design:operator-setup, design:operator-publish;
 * lib/auth/key-scopes.ts): only a signed-in session may put one on a key, never an API key of any kind (including
 * one that already holds these scopes, so a key can neither grant them nor keep them through its own PATCH). The
 * routes have already required the admin role (requireRole) before calling this. 403 otherwise.
 */
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from './middleware';

export function requireHumanAdminGrant(auth: Pick<AuthPayload, 'via'>, scopes: readonly string[]): void {
  if (auth.via !== 'session') {
    throw new ApiError(`${scopes.join(', ')} can only be granted from a signed-in admin session`, 403);
  }
}
