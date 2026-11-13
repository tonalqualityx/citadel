import { NextResponse } from 'next/server';
import {
  KEEP_SIGNED_IN_DAYS,
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
): Promise<{ accessToken: string; refreshToken: string; keep: boolean }> {
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

  // Sliding: a device that ticked "Keep me signed in" gets a fresh full long lifetime on every
  // refresh. The flag is read only from the verified (signed) refresh token.
  const keep = tokenPayload.keep === true;

  const newTokenPayload = {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    ...(keep ? { keep: true } : {}),
  };

  const accessToken = await signAccessToken({
    userId: newTokenPayload.userId,
    email: newTokenPayload.email,
    role: newTokenPayload.role,
  });
  const newRefreshToken = await signRefreshToken(newTokenPayload);

  // Update session with new refresh token (not rotate/delete)
  await createOrUpdateSession(session.user.id, newRefreshToken, keep ? KEEP_SIGNED_IN_DAYS : undefined);

  return { accessToken, refreshToken: newRefreshToken, keep };
}

/** Set the two auth cookies with the same attributes login and refresh have always used. */
export function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string; keep?: boolean }
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
    maxAge: 60 * 60 * 24 * (tokens.keep ? KEEP_SIGNED_IN_DAYS : 7),
    path: '/',
  });
}
