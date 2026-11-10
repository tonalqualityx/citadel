/**
 * Bast chat: who may use Mike's side of the chat (every route that is not under /worker).
 *
 * `requireChatOwner()` passes only when ALL of these hold, else 403 (401 when signed out, from requireAuth):
 * - a signed-in browser session (an API key of any kind is refused, Mike's own admin key included);
 * - the chat is enabled in BastChatSettings;
 * - the caller's user id equals `owner_user_id` in the settings;
 * - the caller's DATABASE role is still admin and the user is active (the token's role is not trusted).
 * The messages are plain and the same for every non-owner, so they say nothing about who the owner is.
 * The mount point of the panel is not access control; every route calls this.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { getSettings, type ChatSettings } from './settings';

export const NOT_AVAILABLE = 'The chat is not available';

export interface ChatOwner {
  auth: AuthPayload;
  settings: ChatSettings;
}

export async function requireChatOwner(db: Pick<PrismaClient, 'bastChatSettings' | 'user'> = defaultDb): Promise<ChatOwner> {
  const auth = await requireAuth();
  if (auth.via !== 'session') throw new AuthError('The chat is only available from a signed-in session', 403);
  const settings = await getSettings(db);
  if (!settings.enabled || !settings.owner_user_id || auth.userId !== settings.owner_user_id) throw new AuthError(NOT_AVAILABLE, 403);
  const user = await db.user.findUnique({ where: { id: auth.userId }, select: { role: true, is_active: true } });
  if (!user || !user.is_active || user.role !== 'admin') throw new AuthError(NOT_AVAILABLE, 403);
  return { auth, settings };
}

/**
 * The settings screen route: same as `requireChatOwner` but allowed while the chat is switched off, so the owner
 * can switch it on. Until an owner is set, no one passes (set the owner with a one-off database write).
 */
export async function requireChatOwnerForSettings(db: Pick<PrismaClient, 'bastChatSettings' | 'user'> = defaultDb): Promise<ChatOwner> {
  const auth = await requireAuth();
  if (auth.via !== 'session') throw new AuthError('The chat is only available from a signed-in session', 403);
  const settings = await getSettings(db);
  if (!settings.owner_user_id || auth.userId !== settings.owner_user_id) throw new AuthError(NOT_AVAILABLE, 403);
  const user = await db.user.findUnique({ where: { id: auth.userId }, select: { role: true, is_active: true } });
  if (!user || !user.is_active || user.role !== 'admin') throw new AuthError(NOT_AVAILABLE, 403);
  return { auth, settings };
}
