import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  findSession,
  deleteSession,
  createSession,
} from '@/lib/auth/jwt';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get('refresh_token')?.value;

    if (!refreshToken) {
      throw new ApiError('Refresh token required', 401);
    }

    // Verify token and find session
    await verifyRefreshToken(refreshToken);
    const session = await findSession(refreshToken);

    if (!session || session.expires_at < new Date()) {
      throw new ApiError('Invalid or expired session', 401);
    }

    if (!session.user.is_active) {
      throw new ApiError('User is inactive', 401);
    }

    // Generate new tokens
    const tokenPayload = {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };

    const newAccessToken = await signAccessToken(tokenPayload);
    const newRefreshToken = await signRefreshToken(tokenPayload);

    // Rotate refresh token
    await deleteSession(refreshToken);
    await createSession(session.user.id, newRefreshToken);

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
