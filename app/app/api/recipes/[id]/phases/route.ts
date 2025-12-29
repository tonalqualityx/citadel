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
    const { id: recipeId } = await params;

    // Verify recipe exists
    const recipe = await prisma.recipe.findUnique({
      where: { id: recipeId },
    });
    if (!recipe) {
      throw new ApiError('Recipe not found', 404);
    }

    const body = await request.json();
    const data = createPhaseSchema.parse(body);

    // Get max sort_order if not provided
    let sortOrder = data.sort_order;
    if (sortOrder === undefined) {
      const maxPhase = await prisma.recipePhase.findFirst({
        where: { recipe_id: recipeId },
        orderBy: { sort_order: 'desc' },
        select: { sort_order: true },
      });
      sortOrder = (maxPhase?.sort_order ?? -1) + 1;
    }

    const phase = await prisma.recipePhase.create({
      data: {
        recipe_id: recipeId,
        name: data.name,
        icon: data.icon || null,
        sort_order: sortOrder,
      },
      include: {
        tasks: {
          orderBy: { sort_order: 'asc' },
          include: {
            sop: {
              select: {
                id: true,
                title: true,
                energy_estimate: true,
                mystery_factor: true,
                battery_impact: true,
                default_priority: true,
                function: {
                  select: { id: true, name: true },
                },
              },
            },
          },
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
    const { id: recipeId } = await params;

    const body = await request.json();

    // Check if this is a reorder request
    if ('phase_ids' in body) {
      const { phase_ids } = reorderPhasesSchema.parse(body);

      // Update sort_order for each phase
      await prisma.$transaction(
        phase_ids.map((phaseId, index) =>
          prisma.recipePhase.update({
            where: { id: phaseId },
            data: { sort_order: index },
          })
        )
      );

      return NextResponse.json({ success: true });
    }

    // Otherwise, this is an update to a single phase
    // Need phase_id in the body for this case
    const { phase_id, ...updateData } = body;
    if (!phase_id) {
      throw new ApiError('phase_id is required for updates', 400);
    }

    const data = updatePhaseSchema.parse(updateData);
    const phase = await prisma.recipePhase.update({
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

    const { searchParams } = new URL(request.url);
    const phaseId = searchParams.get('phase_id');

    if (!phaseId) {
      throw new ApiError('phase_id is required', 400);
    }

    await prisma.recipePhase.delete({
      where: { id: phaseId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
