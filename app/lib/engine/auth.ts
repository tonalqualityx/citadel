/**
 * Engine authentication (phase C spec 4.1): bearer keys only, and only keys that carry the
 * `engine` scope. A staff cookie, a portal session or an ordinary API key (even a pm or admin one)
 * cannot claim, heartbeat or read through the engine routes, so a leaked token for another lane
 * is not a way into the queue.
 */
import { headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { AuthError } from '@/lib/api/errors';

export const ENGINE_SCOPE = 'engine';

export interface EngineAuth {
  userId: string;
  apiKeyId: string;
}

export async function requireEngine(): Promise<EngineAuth> {
  const authHeader = (await headers()).get('authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new AuthError('Authentication required', 401);
  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) throw new AuthError('Authentication required', 401);

  const key = await prisma.apiKey.findFirst({
    where: { key_hash: hashApiKey(rawKey), is_revoked: false },
    include: { user: { select: { id: true, role: true, is_active: true } } },
  });
  if (!key) throw new AuthError('Invalid API key', 401);
  if (key.expires_at && key.expires_at < new Date()) throw new AuthError('API key has expired', 401);
  if (!key.user.is_active) throw new AuthError('User account is inactive', 401);
  if (!key.scopes.includes(ENGINE_SCOPE)) throw new AuthError('This key cannot use the engine', 403);
  if (key.user.role !== 'pm' && key.user.role !== 'admin') throw new AuthError('Insufficient permissions', 403);

  prisma.apiKey.update({ where: { id: key.id }, data: { last_used_at: new Date() } }).catch(() => {});
  return { userId: key.user.id, apiKeyId: key.id };
}
