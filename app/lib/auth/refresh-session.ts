import {
  DEFAULT_REFRESH_DAYS,
  KEEP_SIGNED_IN_DAYS,
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  findSessionById,
} from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one refresh implementation. Verifies the refresh token, finds the ONE session row its `sid`
 * names (one row per sign-in, so one per device), checks the row belongs to the token's user and has
 * not expired and the user is still active, issues a new access and refresh token and stores the new
 * refresh token on that row only. The stored token string is never compared (two tabs refreshing at
 * once must not sign each other out); the binding is the `sid`. Throws ApiError(401) on any failure,
 * including a bad signature, an expired token, a token without `sid` (signed in before this change)
 * and a row that is gone (signed out, password changed). Used by POST /api/auth/refresh and
 * GET /api/auth/continue.
 */
export async function refreshSession(
  refreshToken: string | undefined
): Promise<{ accessToken: string; refreshToken: string; keep: boolean }> {
  if (!refreshToken) {
    throw new ApiError('Refresh token required', 401);
  }

  let tokenPayload;
  try {
    tokenPayload = await verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError('Invalid or expired session', 401);
  }

  const sid = tokenPayload.sid;
  if (typeof sid !== 'string' || !UUID_RE.test(sid) || typeof tokenPayload.userId !== 'string') {
    throw new ApiError('Invalid or expired session', 401);
  }

  const session = await findSessionById(sid);

  if (!session || session.user_id !== tokenPayload.userId || session.expires_at < new Date()) {
    throw new ApiError('Invalid or expired session', 401);
  }

  if (!session.user.is_active) {
    throw new ApiError('User is inactive', 401);
  }

  // Sliding, per device: a device that ticked "Keep me signed in" gets a fresh full long lifetime on
  // every refresh, any other device a fresh 7 days. The flag is read only from the verified (signed)
  // refresh token, so neither kind can be upgraded.
  const keep = tokenPayload.keep === true;

  const newTokenPayload = {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    sid: session.id,
    ...(keep ? { keep: true } : {}),
  };

  const accessToken = await signAccessToken({
    userId: newTokenPayload.userId,
    email: newTokenPayload.email,
    role: newTokenPayload.role,
  });
  const newRefreshToken = await signRefreshToken(newTokenPayload);

  // Update only this session's row. updateMany so a row deleted a moment ago (sign-out in another
  // tab) is a 401, not a 500.
  const days = keep ? KEEP_SIGNED_IN_DAYS : DEFAULT_REFRESH_DAYS;
  const updated = await prisma.session.updateMany({
    where: { id: session.id, user_id: session.user_id },
    data: { refresh_token: newRefreshToken, expires_at: new Date(Date.now() + days * 86400 * 1000) },
  });
  if (updated.count === 0) {
    throw new ApiError('Invalid or expired session', 401);
  }

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
