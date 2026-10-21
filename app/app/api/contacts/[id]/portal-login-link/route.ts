import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { getClientIp } from '@/lib/services/portal';
import { createContactPortalLoginLink } from '@/lib/services/client-auth';

const bodySchema = z.object({
  // false (default) → mint + return the URL for the team to copy.
  // true → Citadel emails the contact their login link (on Mike's behalf).
  send: z.boolean().optional(),
});

// POST /api/contacts/:id/portal-login-link
// Team-side (pm/admin): mint ONE single-use, 7-day invite link for ONE contact, two ways: copy the
// URL or have Citadel email it to the contact. It is never reusable and never a team link; each
// person signs in with their own contact's invite.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const { send } = bodySchema.parse(body ?? {});

    const link = await createContactPortalLoginLink({
      contactId: id,
      send: send ?? false,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    if (!link) {
      throw new ApiError('Contact not found', 404);
    }

    return NextResponse.json({
      url: link.url,
      expires_at: link.expiresAt,
      sent: link.sent,
      contact: {
        id: link.contact.id,
        name: link.contact.name,
        email: link.contact.email,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
