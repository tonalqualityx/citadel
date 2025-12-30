import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMilestoneResponse } from '@/lib/api/formatters';

// POST /api/milestones/[id]/trigger - Manually trigger billing for a milestone
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    // Only PM and Admin can trigger billing
    if (auth.role === 'tech') {
      throw new ApiError('Only PM and Admin can trigger milestone billing', 403);
    }

    // Find the milestone
    const existingMilestone = await prisma.milestone.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            is_deleted: true,
          },
        },
      },
    });

    if (!existingMilestone || existingMilestone.project.is_deleted) {
      throw new ApiError('Milestone not found', 404);
    }

    // Check if milestone has a billing amount
    if (!existingMilestone.billing_amount) {
      throw new ApiError('Milestone does not have a billing amount', 400);
    }

    // Check if already triggered or invoiced
    if (existingMilestone.billing_status !== 'pending') {
      throw new ApiError(
        `Milestone billing is already ${existingMilestone.billing_status}`,
        400
      );
    }

    // Trigger the milestone billing
    const milestone = await prisma.milestone.update({
      where: { id },
      data: {
        billing_status: 'triggered',
        triggered_at: new Date(),
        triggered_by_id: auth.userId,
      },
    });

    return NextResponse.json(formatMilestoneResponse(milestone));
  } catch (error) {
    return handleApiError(error);
  }
}
