import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMilestoneResponse } from '@/lib/api/formatters';

const updateMilestoneSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255).optional(),
  target_date: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  completed_at: z.string().datetime().optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
  phase_id: z.string().uuid().optional().nullable(),
  billing_amount: z.number().positive().optional().nullable(),
  billing_status: z.enum(['pending', 'triggered', 'invoiced']).optional(),
});

// GET /api/milestones/[id] - Get a single milestone
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const milestone = await prisma.milestone.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            is_deleted: true,
          },
        },
      },
    });

    if (!milestone || milestone.project.is_deleted) {
      throw new ApiError('Milestone not found', 404);
    }

    // Tech users can only see milestones on projects they're assigned to
    if (auth.role === 'tech') {
      const isTeamMember = await prisma.projectTeamAssignment.findUnique({
        where: {
          project_id_user_id: {
            project_id: milestone.project_id,
            user_id: auth.userId,
          },
        },
      });

      if (!isTeamMember) {
        throw new ApiError('Milestone not found', 404);
      }
    }

    return NextResponse.json(formatMilestoneResponse(milestone));
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/milestones/[id] - Update a milestone
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await request.json();

    const data = updateMilestoneSchema.parse(body);

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

    // Tech users can only update milestones on projects they're assigned to
    if (auth.role === 'tech') {
      const isTeamMember = await prisma.projectTeamAssignment.findUnique({
        where: {
          project_id_user_id: {
            project_id: existingMilestone.project_id,
            user_id: auth.userId,
          },
        },
      });

      if (!isTeamMember) {
        throw new ApiError('Milestone not found', 404);
      }
    }

    // Build update data
    const updateData: any = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    if (data.target_date !== undefined) {
      updateData.target_date = data.target_date ? new Date(data.target_date) : null;
    }

    if (data.notes !== undefined) {
      updateData.notes = data.notes;
    }

    if (data.completed_at !== undefined) {
      updateData.completed_at = data.completed_at ? new Date(data.completed_at) : null;
    }

    if (data.sort_order !== undefined) {
      updateData.sort_order = data.sort_order;
    }

    if (data.phase_id !== undefined) {
      updateData.phase_id = data.phase_id;
    }

    if (data.billing_amount !== undefined) {
      updateData.billing_amount = data.billing_amount;
    }

    // Handle billing_status transitions
    if (data.billing_status !== undefined) {
      updateData.billing_status = data.billing_status;

      // When manually setting billing_status to triggered
      if (data.billing_status === 'triggered' && existingMilestone.billing_status === 'pending') {
        updateData.triggered_at = new Date();
        updateData.triggered_by_id = auth.userId;
      }

      // When setting billing_status to invoiced
      if (data.billing_status === 'invoiced' && existingMilestone.billing_status !== 'invoiced') {
        updateData.invoiced_at = new Date();
        updateData.invoiced_by_id = auth.userId;
      }
    }

    // Auto-trigger billing when completing a milestone with billing_amount
    if (
      data.completed_at &&
      existingMilestone.billing_status === 'pending' &&
      existingMilestone.billing_amount &&
      !data.billing_status // Don't auto-trigger if explicitly setting billing_status
    ) {
      updateData.billing_status = 'triggered';
      updateData.triggered_at = new Date();
      updateData.triggered_by_id = auth.userId;
    }

    // Update the milestone
    const milestone = await prisma.milestone.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(formatMilestoneResponse(milestone));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/milestones/[id] - Delete a milestone
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

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

    // Tech users can only delete milestones on projects they're assigned to
    if (auth.role === 'tech') {
      const isTeamMember = await prisma.projectTeamAssignment.findUnique({
        where: {
          project_id_user_id: {
            project_id: existingMilestone.project_id,
            user_id: auth.userId,
          },
        },
      });

      if (!isTeamMember) {
        throw new ApiError('Milestone not found', 404);
      }
    }

    // Hard delete the milestone (no is_deleted field in schema)
    await prisma.milestone.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
