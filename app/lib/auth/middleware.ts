import { cookies, headers } from 'next/headers';
import { verifyAccessToken, TokenPayload } from './jwt';
import { hashApiKey } from './api-keys';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { AuthError } from '@/lib/api/errors';
import { ALWAYS_ENFORCED_LANES, ENFORCE_SCOPE, ROUTE_HEADER, laneAllows, laneScopesOf, parseRouteHeader } from './lane-scopes';
import { recordKeyViolation } from './key-violations';
import { rememberKeyLane } from './actor-lane';
import { designerMayCallRoute } from './designer-routes';

/**
 * What requireAuth returns. `via` says how the caller signed in; API-key callers also carry the key
 * id, and the lane for a lane key. Field names shared with fleet items 2a and 3 (via, apiKeyId).
 * `laneEnforced` is true when the lane key itself carries scope-mode:enforce (isDesignWorker needs it).
 */
export type AuthPayload = TokenPayload & { via?: 'session' | 'api_key'; apiKeyId?: string; lane?: string; laneEnforced?: boolean };

/** Routes a lane key may never call, shadow or enforce: key minting and the admin surface. */
export function laneForbiddenPath(path: string): boolean {
  const p = path.split('?')[0];
  return p === '/api/api-keys' || p.startsWith('/api/api-keys/') || p === '/api/admin' || p.startsWith('/api/admin/');
}

export async function requireAuth(): Promise<AuthPayload> {
  // Try cookie-based JWT auth first (existing browser flow)
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (token) {
    try {
      const payload = await verifyAccessToken(token);

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, is_active: true, role: true },
      });

      if (!user || !user.is_active) {
        throw new AuthError('User not found or inactive', 401);
      }

      // Designer Portal (design D1): a user whose DATABASE role is designer may call only the
      // DESIGNER_ROUTES allowlist. The route comes from x-citadel-route (proxy.ts overwrites it);
      // no header = 403 (fail closed). Headers are read only for designers, so every other session
      // is untouched, and the returned role stays the token's.
      if (user.role === 'designer') {
        const headerStore = await headers();
        if (!designerMayCallRoute(headerStore.get(ROUTE_HEADER))) {
          throw new AuthError('Designers cannot use this route', 403);
        }
      }

      // Overwrite, never trust: a signed token cannot claim to be anything but a session here.
      return { ...payload, via: 'session' };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('Invalid token', 401);
    }
  }

  // Fallback: try Bearer token auth (API keys for external tools)
  const headerStore = await headers();
  const authHeader = headerStore.get('authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const rawKey = authHeader.slice(7);
    return authenticateApiKey(rawKey, headerStore);
  }

  throw new AuthError('Authentication required', 401);
}

type HeaderReader = { get(name: string): string | null };

async function authenticateApiKey(rawKey: string, headerStore: HeaderReader): Promise<AuthPayload> {
  const keyHash = hashApiKey(rawKey);

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      key_hash: keyHash,
      is_revoked: false,
    },
    include: {
      user: {
        select: { id: true, email: true, role: true, is_active: true },
      },
    },
  });

  if (!apiKey) {
    throw new AuthError('Invalid API key', 401);
  }

  if (apiKey.expires_at && apiKey.expires_at < new Date()) {
    throw new AuthError('API key has expired', 401);
  }

  if (!apiKey.user.is_active) {
    throw new AuthError('User account is inactive', 401);
  }

  // Designer Portal (design D1): a designer never authenticates with an API key, whatever the key's
  // scopes; otherwise a key minted for her would step around the session allowlist.
  if (apiKey.user.role === 'designer') {
    throw new AuthError('Designers cannot use API keys', 403);
  }

  // Fleet item 6: a key with a lane:<name> scope may call only its lane's routes. The route comes
  // from x-citadel-route, which proxy.ts always overwrites. No header means the proxy did not run,
  // so the call is refused (fail closed). Keys with no lane scope skip all of this.
  const lanes = laneScopesOf(apiKey.scopes);
  const lane = lanes.length > 0 ? lanes.join(',') : undefined;
  rememberKeyLane(keyHash, lane ? lane.slice(0, 40) : null);
  const keyEnforced = (apiKey.scopes ?? []).includes(ENFORCE_SCOPE);
  if (lane) {
    // W8.2 H3: an always-enforced lane (design-worker) is refused outside its lane even on a shadow key.
    const enforced = keyEnforced || lanes.some((l) => (ALWAYS_ENFORCED_LANES as readonly string[]).includes(l));
    const route = parseRouteHeader(headerStore.get(ROUTE_HEADER));
    if (!route) {
      recordKeyViolation({
        apiKeyId: apiKey.id, keyPrefix: apiKey.key_prefix, lane,
        method: '-', path: '(no route header)', enforced: true,
      });
      throw new AuthError('This key needs a route header', 403);
    }
    if (laneForbiddenPath(route.path)) {
      recordKeyViolation({
        apiKeyId: apiKey.id, keyPrefix: apiKey.key_prefix, lane,
        method: route.method, path: route.path, enforced: true,
      });
      throw new AuthError('A lane key cannot use this route', 403);
    }
    if (!lanes.some((l) => laneAllows(l, route.method, route.path))) {
      recordKeyViolation({
        apiKeyId: apiKey.id, keyPrefix: apiKey.key_prefix, lane,
        method: route.method, path: route.path, enforced,
      });
      if (enforced) throw new AuthError('This key cannot use this route', 403);
    }
  }

  // Fire-and-forget: update last_used_at
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { last_used_at: new Date() },
  }).catch(() => {});

  return {
    userId: apiKey.user.id,
    email: apiKey.user.email,
    role: apiKey.user.role,
    via: 'api_key',
    apiKeyId: apiKey.id,
    ...(lane ? { lane, laneEnforced: keyEnforced } : {}),
  };
}

export function requireRole(user: TokenPayload, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(user.role as UserRole)) {
    throw new AuthError('Insufficient permissions', 403);
  }
}

export async function getOptionalAuth(): Promise<AuthPayload | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}
