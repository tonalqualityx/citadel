import { cookies, headers } from 'next/headers';
import { verifyAccessToken, TokenPayload } from './jwt';
import { hashApiKey } from './api-keys';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { AuthError } from '@/lib/api/errors';

export async function requireAuth(): Promise<TokenPayload> {
  // Try cookie-based JWT auth first (existing browser flow)
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (token) {
    try {
      const payload = await verifyAccessToken(token);

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, is_active: true },
      });

      if (!user || !user.is_active) {
        throw new AuthError('User not found or inactive', 401);
      }

      return payload;
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
    return authenticateApiKey(rawKey);
  }

  throw new AuthError('Authentication required', 401);
}

async function authenticateApiKey(rawKey: string): Promise<TokenPayload> {
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

  // Fire-and-forget: update last_used_at
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { last_used_at: new Date() },
  }).catch(() => {});

  return {
    userId: apiKey.user.id,
    email: apiKey.user.email,
    role: apiKey.user.role,
  };
}

export function requireRole(user: TokenPayload, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(user.role as UserRole)) {
    throw new AuthError('Insufficient permissions', 403);
  }
}

export async function getOptionalAuth(): Promise<TokenPayload | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}
