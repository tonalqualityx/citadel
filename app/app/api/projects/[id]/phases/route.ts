import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const createPhaseSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(50).optional().nullable(),
  sort_order: z.number().optional(),
});

const updatePhaseSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(50).optional().nullable(),
  sort_order: z.number().optional(),
});

const reorderPhasesSchema = z.object({
  phase_ids: z.array(z.string().uuid()),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const body = await request.json();
    const data = createPhaseSchema.parse(body);

    // Get max sort_order if not provided
    let sortOrder = data.sort_order;
    if (sortOrder === undefined) {
      const maxPhase = await prisma.projectPhase.findFirst({
        where: { project_id: projectId },
        orderBy: { sort_order: 'desc' },
        select: { sort_order: true },
      });
      sortOrder = (maxPhase?.sort_order ?? -1) + 1;
    }

    const phase = await prisma.projectPhase.create({
      data: {
        project_id: projectId,
        name: data.name,
        icon: data.icon || null,
        sort_order: sortOrder,
      },
      include: {
        tasks: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    return NextResponse.json({ phase }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const body = await request.json();

    // Check if this is a reorder request
    if ('phase_ids' in body) {
      const { phase_ids } = reorderPhasesSchema.parse(body);

      // Verify all phases belong to this project
      const phases = await prisma.projectPhase.findMany({
        where: { id: { in: phase_ids }, project_id: projectId },
        select: { id: true },
      });
      if (phases.length !== phase_ids.length) {
        throw new ApiError('Some phases do not belong to this project', 400);
      }

      // Update sort_order for each phase
      await prisma.$transaction(
        phase_ids.map((phaseId, index) =>
          prisma.projectPhase.update({
            where: { id: phaseId },
            data: { sort_order: index },
          })
        )
      );

      return NextResponse.json({ success: true });
    }

    // Otherwise, this is an update to a single phase
    const { phase_id, ...updateData } = body;
    if (!phase_id) {
      throw new ApiError('phase_id is required for updates', 400);
    }

    // Verify phase belongs to this project
    const existingPhase = await prisma.projectPhase.findFirst({
      where: { id: phase_id, project_id: projectId },
    });
    if (!existingPhase) {
      throw new ApiError('Phase not found in this project', 404);
    }

    const data = updatePhaseSchema.parse(updateData);
    const phase = await prisma.projectPhase.update({
      where: { id: phase_id },
      data,
    });

    return NextResponse.json({ phase });
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
    const { id: projectId } = await params;

    const { searchParams } = new URL(request.url);
    const phaseId = searchParams.get('phase_id');

    if (!phaseId) {
      throw new ApiError('phase_id is required', 400);
    }

    // Verify phase belongs to this project
    const phase = await prisma.projectPhase.findFirst({
      where: { id: phaseId, project_id: projectId },
    });
    if (!phase) {
      throw new ApiError('Phase not found in this project', 404);
    }

    // Delete phase (tasks will have phase_id set to null due to onDelete: SetNull)
    await prisma.projectPhase.delete({
      where: { id: phaseId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
