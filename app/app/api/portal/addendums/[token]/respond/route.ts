import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logPortalSession, getClientIp } from '@/lib/services/portal';

const respondSchema = z.object({
  response: z.enum(['accepted', 'rejected', 'changes_requested']),
  note: z.string().optional(),
  signer_name: z.string().optional(),
  signer_email: z.string().email().optional(),
});

// Inline token validation for public route
async function validateAddendumToken(token: string) {
  const addendum = await prisma.addendum.findFirst({
    where: {
      portal_token: token,
      is_deleted: false,
    },
  });

  if (!addendum) return null;

  // Check expiry
  if (addendum.portal_token_expires_at && addendum.portal_token_expires_at < new Date()) {
    return null;
  }

  return addendum;
}

// POST /api/portal/addendums/:token/respond - Client responds to addendum (public, no auth)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const addendum = await validateAddendumToken(token);

    if (!addendum) {
      return NextResponse.json(
        { error: 'Addendum not found or link has expired' },
        { status: 404 }
      );
    }

    if (addendum.status !== 'sent') {
      throw new ApiError('This addendum has already been responded to', 400);
    }

    const body = await request.json();
    const data = respondSchema.parse(body);

    const clientIp = getClientIp(request);
    const userAgent = request.headers.get('user-agent');

    // Build update data based on response type
    const updateData: Record<string, any> = {
      status: data.response,
      client_responded_at: new Date(),
      client_note: data.note || null,
    };

    if (data.response === 'accepted') {
      updateData.signed_at = new Date();
      updateData.signer_name = data.signer_name || null;
      updateData.signer_email = data.signer_email || null;
      updateData.signer_ip = clientIp;
      updateData.signer_user_agent = userAgent;
    }

    await prisma.addendum.update({
      where: { id: addendum.id },
      data: updateData,
    });

    // Map response to portal action
    const actionMap: Record<string, string> = {
      accepted: 'accept',
      rejected: 'reject',
      changes_requested: 'changes_requested',
    };

    // Log portal action
    await logPortalSession({
      tokenType: 'addendum' as any,
      entityId: addendum.id,
      ipAddress: clientIp,
      userAgent,
      action: actionMap[data.response] as any,
      metadata: { note: data.note },
    });

    return NextResponse.json({
      message: `Addendum ${data.response}`,
      status: data.response,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
