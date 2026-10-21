import { NextRequest, NextResponse } from 'next/server';
import { CLIENT_SESSION_COOKIE, revokeClientSession } from '@/lib/services/client-auth';

// POST /api/portal/logout
// Revokes the current session server-side (so a copied cookie stops working) and clears the
// cookie. Always 200: logging out when already logged out is not an error.
export async function POST(request: NextRequest) {
  const token = request.cookies.get(CLIENT_SESSION_COOKIE)?.value;
  if (token) {
    try {
      await revokeClientSession(token);
    } catch (error) {
      console.error('Failed to revoke client session on logout:', error);
    }
  }

  const response = NextResponse.json({ loggedOut: true });
  response.cookies.set(CLIENT_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
