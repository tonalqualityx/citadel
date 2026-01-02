import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  findSessionByUser,
  createOrUpdateSession,
} from '@/lib/auth/jwt';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get('refresh_token')?.value;

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

    // Generate new tokens
    const newTokenPayload = {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };

    const newAccessToken = await signAccessToken(newTokenPayload);
    const newRefreshToken = await signRefreshToken(newTokenPayload);

    // Update session with new refresh token (not rotate/delete)
    await createOrUpdateSession(session.user.id, newRefreshToken);

    const response = NextResponse.json({ success: true });

    response.cookies.set('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15,
      path: '/',
    });

    response.cookies.set('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
