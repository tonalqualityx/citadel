import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateRecipeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.any().optional(), // BlockNote JSON content
  default_type: z.enum(['project', 'retainer', 'internal']).optional(),
  requires_sitemap: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const recipe = await prisma.recipe.findUnique({
      where: { id },
      include: {
        phases: {
          orderBy: { sort_order: 'asc' },
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
        },
        _count: {
          select: { projects: true },
        },
      },
    });

    if (!recipe) {
      throw new ApiError('Recipe not found', 404);
    }

    // Format response with SOP data
    const formattedRecipe = {
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      default_type: recipe.default_type,
      requires_sitemap: recipe.requires_sitemap,
      is_active: recipe.is_active,
      project_count: recipe._count.projects,
      phases: recipe.phases.map((phase) => ({
        id: phase.id,
        name: phase.name,
        icon: phase.icon,
        sort_order: phase.sort_order,
        tasks: phase.tasks.map((task) => ({
          id: task.id,
          sop_id: task.sop_id,
          title: task.title, // Override title (null means use SOP title)
          is_variable: task.is_variable,
          variable_source: task.variable_source,
          sort_order: task.sort_order,
          depends_on_ids: task.depends_on_ids,
          // SOP data (source of truth for task attributes)
          sop: task.sop,
        })),
      })),
      created_at: recipe.created_at.toISOString(),
      updated_at: recipe.updated_at.toISOString(),
    };

    return NextResponse.json(formattedRecipe);
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
    const { id } = await params;

    const body = await request.json();
    const data = updateRecipeSchema.parse(body);

    const recipe = await prisma.recipe.update({
      where: { id },
      data,
    });

    return NextResponse.json({ recipe });
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

    // Soft delete by setting inactive
    await prisma.recipe.update({
      where: { id },
      data: { is_active: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
