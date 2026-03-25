import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatProposalResponse } from '@/lib/api/formatters';
import { generatePortalToken, getTokenExpiry } from '@/lib/services/portal';
import { sendEmail } from '@/lib/services/email';

// POST /api/accords/:id/proposals/:proposalId/send - Send proposal to client
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, proposalId } = await params;

    // Verify proposal exists and is draft
    const existing = await prisma.proposal.findFirst({
      where: {
        id: proposalId,
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
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      throw new ApiError('Only draft proposals can be sent', 400);
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

    // Update proposal: set status to sent, store token
    const proposal = await prisma.proposal.update({
      where: { id: proposalId },
      data: {
        status: 'sent',
        sent_at: new Date(),
        portal_token: portalToken,
        portal_token_expires_at: portalTokenExpiresAt,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    // Send email
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const portalUrl = `${baseUrl}/portal/proposal/${portalToken}`;

    await sendEmail({
      to: recipientEmail,
      subject: `Proposal: ${existing.accord.name}`,
      text: `Hi ${recipientName},\n\nWe've prepared a proposal for "${existing.accord.name}" for your review.\n\nView your proposal here: ${portalUrl}\n\nThis link will expire in 60 days.\n\nBest regards,\nThe Indelible Team`,
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
    <h2>Proposal for ${existing.accord.name}</h2>
    <p>Hi ${recipientName},</p>
    <p>We've prepared a proposal for your review.</p>
    <p><a href="${portalUrl}" class="button">View Proposal</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p><a href="${portalUrl}">${portalUrl}</a></p>
    <p class="footer">This link will expire in 60 days.</p>
    <p class="footer">- The Indelible Team</p>
  </div>
</body>
</html>`.trim(),
    });

    return NextResponse.json(formatProposalResponse(proposal));
  } catch (error) {
    return handleApiError(error);
  }
}
