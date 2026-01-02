import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyRefreshToken, deleteUserSessions } from '@/lib/auth/jwt';
import { handleApiError } from '@/lib/api/errors';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const refreshToken = cookieStore.get('refresh_token')?.value;

    if (refreshToken) {
      try {
        const payload = await verifyRefreshToken(refreshToken);
        await deleteUserSessions(payload.userId);
      } catch {
        // Token invalid/expired, but we still clear cookies below
      }
    }

    const response = NextResponse.json({ success: true });

    // Clear cookies
    response.cookies.set('access_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    response.cookies.set('refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
