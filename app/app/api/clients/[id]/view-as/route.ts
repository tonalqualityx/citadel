import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError, AuthError } from '@/lib/api/errors';
import { rejectCrossSiteRequest } from '@/lib/api/same-origin-guard';
import { getClientIp } from '@/lib/services/portal';
import { CLIENT_SESSION_COOKIE } from '@/lib/services/client-auth';
import { startViewAsSession, VIEW_AS_ROLES } from '@/lib/portal/view-as';
import { VIEW_AS_NO_CONTACT_LINE } from '@/lib/portal/view-as-copy';

const bodySchema = z.object({ role: z.enum(VIEW_AS_ROLES).optional() }).strict();

// POST /api/clients/:id/view-as { role? }
// Admin only, from a signed-in Citadel browser session. Starts a READ-ONLY, 30 minute view of the
// client's portal as a contact with the chosen role (owner by default). Sets the portal session
// cookie on the response; the token is never returned in the body. The admin's own Citadel
// session is not touched. The start is written to the client's activity log first.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return rejected;
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    // A browser session only: an API key must not be able to mint a portal cookie.
    if (!(await cookies()).get('access_token')?.value) throw new AuthError('Forbidden', 403);

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Client not found', 404);
    const { role } = bodySchema.parse(await request.json().catch(() => ({})));

    const result = await startViewAsSession({
      adminUserId: auth.userId,
      clientId: id,
      role: role ?? 'owner',
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
    if (!result.ok) {
      if (result.reason === 'client_not_found') throw new ApiError('Client not found', 404);
      throw new ApiError(VIEW_AS_NO_CONTACT_LINE, 409, 'no_contact');
    }

    const response = NextResponse.json({
      url: '/portal/home',
      client_name: result.clientName,
      role: result.role,
      expires_at: result.expiresAt.toISOString(),
    });
    response.cookies.set(CLIENT_SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: Math.floor((result.expiresAt.getTime() - Date.now()) / 1000),
      path: '/',
    });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
