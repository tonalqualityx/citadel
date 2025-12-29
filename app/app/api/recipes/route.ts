import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const createRecipeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.any().optional(), // BlockNote JSON content
  default_type: z.enum(['project', 'retainer', 'internal']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('include_inactive') === 'true';

    const recipes = await prisma.recipe.findMany({
      where: includeInactive ? {} : { is_active: true },
      include: {
        phases: {
          orderBy: { sort_order: 'asc' },
          include: {
            tasks: {
              orderBy: { sort_order: 'asc' },
              select: { id: true },
            },
          },
        },
        _count: {
          select: { projects: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Format response
    const formattedRecipes = recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      default_type: recipe.default_type,
      requires_sitemap: recipe.requires_sitemap,
      is_active: recipe.is_active,
      phase_count: recipe.phases.length,
      task_count: recipe.phases.reduce((sum, p) => sum + p.tasks.length, 0),
      project_count: recipe._count.projects,
      created_at: recipe.created_at.toISOString(),
      updated_at: recipe.updated_at.toISOString(),
    }));

    return NextResponse.json({ recipes: formattedRecipes });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createRecipeSchema.parse(body);

    const recipe = await prisma.recipe.create({
      data: {
        name: data.name,
        description: data.description,
        default_type: data.default_type,
      },
    });

    return NextResponse.json({ recipe }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
