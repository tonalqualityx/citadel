import { NextRequest, NextResponse } from 'next/server';
import { refreshSession, setAuthCookies } from '@/lib/auth/refresh-session';
import { safeReturnPath } from '@/lib/auth/safe-return-path';
import { SILENT_REFRESH_COOKIE } from '@/lib/auth/silent-refresh';

export const dynamic = 'force-dynamic';

/**
 * Silent sign-in on a cold open. The (app) and (design) layouts send a request that has a refresh
 * cookie but no access cookie here, because a server component cannot set cookies during render.
 * This runs the one existing refresh (refreshSession), sets the cookies, and redirects to the page
 * that was asked for. Any failure goes to /login with nothing cleared, exactly as today.
 * Redirects use a relative Location so the host never has to be guessed behind a proxy.
 */
export async function GET(request: NextRequest) {
  const to = safeReturnPath(request.nextUrl.searchParams.get('to'));
  const redirectTo = (location: string) =>
    new NextResponse(null, { status: 307, headers: { Location: location, 'Cache-Control': 'no-store' } });

  const refreshToken = request.cookies.get('refresh_token')?.value;
  if (!refreshToken) return redirectTo('/login');

  try {
    const tokens = await refreshSession(refreshToken);
    const response = redirectTo(to ?? '/dashboard');
    setAuthCookies(response, tokens);
    // One-shot marker so the layouts do not try again if this browser drops the new cookie.
    response.cookies.set(SILENT_REFRESH_COOKIE, '1', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30,
      path: '/',
    });
    return response;
  } catch {
    return redirectTo('/login');
  }
}
