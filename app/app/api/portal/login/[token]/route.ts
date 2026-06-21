import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/services/portal';
import {
  consumeClientMagicLink,
  CLIENT_SESSION_COOKIE,
} from '@/lib/services/client-auth';

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

// GET /api/portal/login/:token
// The magic-link target (email links are GET). Single-use: consumes the token, issues a 7-day
// client-scoped session cookie, and redirects into the portal. An invalid/expired/used token
// redirects to the login page with an error flag (no session set).
//
// Note: as a GET it can be triggered by email link-prefetchers; the short magic-link TTL bounds
// that, and a consumed link simply requires re-requesting. Revisit with a POST interstitial if
// prefetch consumption becomes a real problem.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const session = await consumeClientMagicLink({
    magicToken: token,
    ipAddress: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
  });

  if (!session) {
    return NextResponse.redirect(`${baseUrl}/portal/login?error=invalid`, 303);
  }

  const response = NextResponse.redirect(`${baseUrl}/portal`, 303);
  response.cookies.set(CLIENT_SESSION_COOKIE, session.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  });

  return response;
}
