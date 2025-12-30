import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMilestoneResponse } from '@/lib/api/formatters';

const createMilestoneSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  target_date: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  phase_id: z.string().uuid().optional().nullable(),
  billing_amount: z.number().positive().optional().nullable(),
});

// GET /api/projects/[id]/milestones - List milestones for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id: projectId } = await params;

    // Verify project exists and user has access
    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
    });

    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    // Tech users can only see milestones on projects they're assigned to
    if (auth.role === 'tech') {
      const isTeamMember = await prisma.projectTeamAssignment.findUnique({
        where: {
          project_id_user_id: {
            project_id: projectId,
            user_id: auth.userId,
          },
        },
      });

      if (!isTeamMember) {
        throw new ApiError('Project not found', 404);
      }
    }

    // Fetch milestones ordered by target_date, then sort_order
    const milestones = await prisma.milestone.findMany({
      where: {
        project_id: projectId,
      },
      orderBy: [
        { target_date: 'asc' },
        { sort_order: 'asc' },
      ],
    });

    return NextResponse.json({
      milestones: milestones.map(formatMilestoneResponse),
      count: milestones.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/projects/[id]/milestones - Create a milestone
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id: projectId } = await params;
    const body = await request.json();

    const data = createMilestoneSchema.parse(body);

    // Verify project exists and user has access
    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
    });

    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    // Tech users can only create milestones on projects they're assigned to
    if (auth.role === 'tech') {
      const isTeamMember = await prisma.projectTeamAssignment.findUnique({
        where: {
          project_id_user_id: {
            project_id: projectId,
            user_id: auth.userId,
          },
        },
      });

      if (!isTeamMember) {
        throw new ApiError('Project not found', 404);
      }
    }

    // Get the next sort_order for this project
    const lastMilestone = await prisma.milestone.findFirst({
      where: { project_id: projectId },
      orderBy: { sort_order: 'desc' },
      select: { sort_order: true },
    });

    const nextSortOrder = (lastMilestone?.sort_order ?? -1) + 1;

    // Create the milestone
    const milestone = await prisma.milestone.create({
      data: {
        project_id: projectId,
        name: data.name,
        target_date: data.target_date ? new Date(data.target_date) : null,
        notes: data.notes || null,
        sort_order: nextSortOrder,
        phase_id: data.phase_id || null,
        billing_amount: data.billing_amount || null,
      },
    });

    return NextResponse.json(formatMilestoneResponse(milestone), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
