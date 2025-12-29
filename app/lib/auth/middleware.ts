import { cookies } from 'next/headers';
import { verifyAccessToken, TokenPayload } from './jwt';
import { prisma } from '@/lib/db/prisma';
import { UserRole } from '@prisma/client';
import { AuthError } from '@/lib/api/errors';

export async function requireAuth(): Promise<TokenPayload> {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (!token) {
    throw new AuthError('Authentication required', 401);
  }

  try {
    const payload = await verifyAccessToken(token);

    // Optionally verify user still exists and is active
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
