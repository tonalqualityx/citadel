import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTeamAssignmentResponse } from '@/lib/api/formatters';

const addTeamMemberSchema = z.object({
  user_id: z.string().uuid(),
  function_id: z.string().uuid().optional().nullable(),
  is_lead: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const assignments = await prisma.projectTeamAssignment.findMany({
      where: { project_id: id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        function: { select: { id: true, name: true } },
      },
      orderBy: [{ is_lead: 'desc' }, { created_at: 'asc' }],
    });

    return NextResponse.json({
      team: assignments.map(formatTeamAssignmentResponse),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = addTeamMemberSchema.parse(body);

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id, is_deleted: false },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: data.user_id, is_active: true },
    });
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Verify function exists if provided
    if (data.function_id) {
      const func = await prisma.function.findUnique({
        where: { id: data.function_id, is_active: true },
      });
      if (!func) {
        throw new ApiError('Function not found', 404);
      }
    }

    // Check if already assigned
    const existing = await prisma.projectTeamAssignment.findUnique({
      where: {
        project_id_user_id: {
          project_id: id,
          user_id: data.user_id,
        },
      },
    });
    if (existing) {
      throw new ApiError('User is already assigned to this project', 400);
    }

    const assignment = await prisma.projectTeamAssignment.create({
      data: {
        project_id: id,
        user_id: data.user_id,
        function_id: data.function_id,
        is_lead: data.is_lead || false,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        function: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(formatTeamAssignmentResponse(assignment), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      throw new ApiError('user_id is required', 400);
    }

    await prisma.projectTeamAssignment.delete({
      where: {
        project_id_user_id: {
          project_id: id,
          user_id: userId,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
