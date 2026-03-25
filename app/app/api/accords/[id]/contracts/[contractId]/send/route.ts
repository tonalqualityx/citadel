import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatContractResponse } from '@/lib/api/formatters';
import { generatePortalToken, getTokenExpiry } from '@/lib/services/portal';
import { sendEmail } from '@/lib/services/email';

// POST /api/accords/:id/contracts/:contractId/send - Send contract to client
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contractId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, contractId } = await params;

    // Verify contract exists and is draft
    const existing = await prisma.contract.findFirst({
      where: {
        id: contractId,
        accord_id: accordId,
        is_deleted: false,
      },
      include: {
        accord: {
          include: {
            client: { select: { id: true, name: true, email: true } },
            owner: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      throw new ApiError('Only draft contracts can be sent', 400);
    }

    // Determine recipient email
    const recipientEmail = existing.accord.lead_email || existing.accord.client?.email;
    const recipientName = existing.accord.lead_name || existing.accord.client?.name || 'there';

    if (!recipientEmail) {
      throw new ApiError('No email address available for this lead/client', 400);
    }

    // Generate portal token
    const portalToken = generatePortalToken();
    const portalTokenExpiresAt = getTokenExpiry();

    // Update contract: set status to sent, store token, create content snapshot
    const contract = await prisma.contract.update({
      where: { id: contractId },
      data: {
        status: 'sent',
        sent_at: new Date(),
        portal_token: portalToken,
        portal_token_expires_at: portalTokenExpiresAt,
        content_snapshot: existing.content, // Immutable record of what was sent
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        msa_version: { select: { id: true, version: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    // Send email
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const portalUrl = `${baseUrl}/portal/contract/${portalToken}`;

    await sendEmail({
      to: recipientEmail,
      subject: `Contract: ${existing.accord.name}`,
      text: `Hi ${recipientName},\n\nWe've prepared a contract for "${existing.accord.name}" for your review and signature.\n\nView and sign your contract here: ${portalUrl}\n\nThis link will expire in 60 days.\n\nBest regards,\nThe Indelible Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2D2D2D; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; background: #5B8FB9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
    .footer { margin-top: 30px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Contract for ${existing.accord.name}</h2>
    <p>Hi ${recipientName},</p>
    <p>We've prepared a contract for your review and signature.</p>
    <p><a href="${portalUrl}" class="button">Review & Sign Contract</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p><a href="${portalUrl}">${portalUrl}</a></p>
    <p class="footer">This link will expire in 60 days.</p>
    <p class="footer">- The Indelible Team</p>
  </div>
</body>
</html>`.trim(),
    });

    return NextResponse.json(formatContractResponse(contract));
  } catch (error) {
    return handleApiError(error);
  }
}
