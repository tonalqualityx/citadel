import { NextResponse } from 'next/server';
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  findSessionByUser,
  createOrUpdateSession,
} from '@/lib/auth/jwt';
import { ApiError } from '@/lib/api/errors';

/**
 * The one refresh implementation. Verifies the refresh token, finds the user's session, checks it
 * has not expired and the user is still active, issues a new access and refresh token and stores
 * the new refresh token on the session. Throws ApiError(401) or a jose error on any failure.
 * Used by POST /api/auth/refresh and GET /api/auth/continue.
 */
export async function refreshSession(
  refreshToken: string | undefined
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!refreshToken) {
    throw new ApiError('Refresh token required', 401);
  }

  // Verify token to get user ID
  const tokenPayload = await verifyRefreshToken(refreshToken);

  // Find session by user ID (allows multiple tabs to share session)
  const session = await findSessionByUser(tokenPayload.userId);

  if (!session || session.expires_at < new Date()) {
    throw new ApiError('Invalid or expired session', 401);
  }

  if (!session.user.is_active) {
    throw new ApiError('User is inactive', 401);
  }

  const newTokenPayload = {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
  };

  const accessToken = await signAccessToken(newTokenPayload);
  const newRefreshToken = await signRefreshToken(newTokenPayload);

  // Update session with new refresh token (not rotate/delete)
  await createOrUpdateSession(session.user.id, newRefreshToken);

  return { accessToken, refreshToken: newRefreshToken };
}

/** Set the two auth cookies with the same attributes login and refresh have always used. */
export function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string }
): void {
  response.cookies.set('access_token', tokens.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 15,
    path: '/',
  });

  response.cookies.set('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
}
