import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { CLIENT_SESSION_COOKIE } from '@/lib/services/client-auth';
import { endViewAsSession } from '@/lib/portal/view-as';

// POST /api/portal-view-as/exit
// Ends the admin's read-only portal view: revokes the view session (only a view-as row; a real
// client session is never touched here), clears the cookie and says where to go back to. It
// lives outside /api/portal on purpose: every write under that path refuses a view-as session,
// and leaving the view must not. Idempotent.
export async function POST(request: NextRequest) {
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return rejected;
  try {
    const token = request.cookies.get(CLIENT_SESSION_COOKIE)?.value;
    const ended = token ? await endViewAsSession(token) : null;
    const response = NextResponse.json({ ended: !!ended, return_to: ended ? `/clients/${ended.clientId}` : '/dashboard' });
    if (ended) {
      response.cookies.set(CLIENT_SESSION_COOKIE, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
    }
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
