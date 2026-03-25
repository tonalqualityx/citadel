import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatProposalResponse } from '@/lib/api/formatters';

// GET /api/accords/:id/proposals/:proposalId - Get proposal detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, proposalId } = await params;

    const proposal = await prisma.proposal.findFirst({
      where: {
        id: proposalId,
        accord_id: accordId,
        is_deleted: false,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    return NextResponse.json(formatProposalResponse(proposal));
  } catch (error) {
    return handleApiError(error);
  }
}

const updateProposalSchema = z.object({
  content: z.string().optional(),
  pricing_snapshot: z.any().optional(),
});

// PATCH /api/accords/:id/proposals/:proposalId - Update draft proposal
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, proposalId } = await params;
    const body = await request.json();
    const data = updateProposalSchema.parse(body);

    // Verify proposal exists and is draft
    const existing = await prisma.proposal.findFirst({
      where: {
        id: proposalId,
        accord_id: accordId,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      throw new ApiError('Only draft proposals can be edited', 400);
    }

    const proposal = await prisma.proposal.update({
      where: { id: proposalId },
      data: {
        ...(data.content !== undefined && { content: data.content }),
        ...(data.pricing_snapshot !== undefined && { pricing_snapshot: data.pricing_snapshot }),
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json(formatProposalResponse(proposal));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/accords/:id/proposals/:proposalId - Soft delete proposal
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, proposalId } = await params;

    const existing = await prisma.proposal.findFirst({
      where: {
        id: proposalId,
        accord_id: accordId,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    await prisma.proposal.update({
      where: { id: proposalId },
      data: { is_deleted: true },
    });

    return NextResponse.json({ message: 'Proposal deleted' });
  } catch (error) {
    return handleApiError(error);
  }
}
