import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { validateProposalToken, logPortalSession, getClientIp } from '@/lib/services/portal';

const respondSchema = z.object({
  action: z.enum(['accept', 'reject', 'changes_requested']),
  note: z.string().optional(),
});

// POST /api/portal/proposals/:token/respond - Client responds to proposal
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const proposal = await validateProposalToken(token);

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found or link has expired' },
        { status: 404 }
      );
    }

    if (proposal.status !== 'sent') {
      throw new ApiError('This proposal has already been responded to', 400);
    }

    const body = await request.json();
    const data = respondSchema.parse(body);

    // Map action to status
    const statusMap: Record<string, string> = {
      accept: 'accepted',
      reject: 'rejected',
      changes_requested: 'changes_requested',
    };
    const newStatus = statusMap[data.action];

    // Update proposal
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: newStatus as any,
        client_responded_at: new Date(),
        client_note: data.note || null,
      },
    });

    // If accepted, advance accord to 'contract' status
    if (data.action === 'accept') {
      await prisma.accord.update({
        where: { id: proposal.accord_id },
        data: {
          status: 'contract',
          entered_current_status_at: new Date(),
        },
      });
    }

    // Log portal action
    await logPortalSession({
      tokenType: 'proposal',
      entityId: proposal.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: data.action as any,
      metadata: { note: data.note },
    });

    return NextResponse.json({
      message: `Proposal ${newStatus}`,
      status: newStatus,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
