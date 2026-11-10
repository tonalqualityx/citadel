/**
 * Home screen Slice 1: who may use /api/home, /api/home/act and /api/home/undo.
 *
 * Only a signed-in browser session whose user is an admin AND whose own home_view is 'home'.
 * Everything else is a 403 (a missing or bad login is requireAuth's own 401). The preference
 * is read for the caller's own row only; there is no way to ask about another user.
 *
 * API-key callers are refused: requireAuth marks them `via: 'api_key'`, and a production token
 * tied to Mike would otherwise be Mike as far as Citadel knows (plan section 4, "Note on
 * identity"). Only `via === 'session'` passes.
 */

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';

export async function requireHomeUser(): Promise<AuthPayload> {
  const auth = await requireAuth();

  if (auth.via !== 'session') {
    throw new AuthError('The home screen is only available from a signed-in session', 403);
  }
  if (auth.role !== 'admin') {
    throw new AuthError('The home screen is not available for this user', 403);
  }

  const pref = await prisma.userPreference.findUnique({
    where: { user_id: auth.userId },
    select: { home_view: true },
  });
  if (pref?.home_view !== 'home') {
    throw new AuthError('The home screen is not turned on for this user', 403);
  }

  return auth;
}
