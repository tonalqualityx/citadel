import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/services/portal';
import {
  consumeClientMagicLink,
  CLIENT_SESSION_COOKIE,
  SESSION_TTL_DAYS,
} from '@/lib/services/client-auth';

// Sourced from client-auth.ts so the cookie's maxAge can never drift from the DB row's expires_at.
const SESSION_MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

const consumeSchema = z.object({
  token: z.string().min(1).max(256),
});

// POST /api/portal/login/consume
// The ONLY place a magic link is consumed. Called by the button on /portal/login/verify.
// Valid -> sets the httpOnly client_session cookie and returns { redirect: '/portal' }.
// Unknown, used, or expired -> 401 { error } and no cookie.
export async function POST(request: NextRequest) {
  const rateLimitResponse = authRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { token } = consumeSchema.parse(await request.json());

    const session = await consumeClientMagicLink({
      magicToken: token,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    if (!session) {
      return NextResponse.json(
        { error: 'This sign-in link has expired or was already used.' },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ redirect: '/portal' });
    response.cookies.set(CLIENT_SESSION_COOKIE, session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
    });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
