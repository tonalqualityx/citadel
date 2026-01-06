import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// Detect circular dependencies using DFS
function detectCircularDependency(
  taskId: string,
  newDependsOnIds: string[],
  allTasks: { id: string; depends_on_ids: string[] }[]
): boolean {
  // Build adjacency list: task -> tasks it depends on
  const graph = new Map<string, string[]>();
  for (const task of allTasks) {
    if (task.id === taskId) {
      // Use new dependencies for the task being updated
      graph.set(task.id, newDependsOnIds);
    } else {
      graph.set(task.id, task.depends_on_ids || []);
    }
  }

  // Check if any of the new dependencies can reach back to taskId
  function canReach(from: string, target: string, visited: Set<string>): boolean {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);

    const deps = graph.get(from) || [];
    for (const dep of deps) {
      if (canReach(dep, target, visited)) return true;
    }
    return false;
  }

  // Check if adding new dependencies would create a cycle
  for (const depId of newDependsOnIds) {
    if (canReach(depId, taskId, new Set())) {
      return true;
    }
  }
  return false;
}

// RecipeTask schema - SOP is the source of truth for task attributes
const createTaskSchema = z.object({
  sop_id: z.string().uuid(), // Required - SOP is source of truth
  title: z.string().max(500).optional().nullable(), // Optional override (e.g., "Design {page}")
  is_variable: z.boolean().optional(),
  variable_source: z.string().max(50).optional().nullable(), // 'sitemap_page' | null
  sort_order: z.number().optional(),
  depends_on_ids: z.array(z.string().uuid()).optional(),
});

const updateTaskSchema = createTaskSchema.partial();

const reorderTasksSchema = z.object({
  task_ids: z.array(z.string().uuid()),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { phaseId } = await params;

    // Verify phase exists
    const phase = await prisma.recipePhase.findUnique({
      where: { id: phaseId },
    });
    if (!phase) {
      throw new ApiError('Phase not found', 404);
    }

    const body = await request.json();
    const data = createTaskSchema.parse(body);

    // Verify SOP exists
    const sop = await prisma.sop.findUnique({
      where: { id: data.sop_id },
    });
    if (!sop) {
      throw new ApiError('SOP not found', 404);
    }

    // Get max sort_order if not provided
    let sortOrder = data.sort_order;
    if (sortOrder === undefined) {
      const maxTask = await prisma.recipeTask.findFirst({
        where: { phase_id: phaseId },
        orderBy: { sort_order: 'desc' },
        select: { sort_order: true },
      });
      sortOrder = (maxTask?.sort_order ?? -1) + 1;
    }

    const task = await prisma.recipeTask.create({
      data: {
        phase_id: phaseId,
        sop_id: data.sop_id,
        title: data.title || null, // Title override (null means use SOP title)
        is_variable: data.is_variable ?? false,
        variable_source: data.variable_source || null,
        sort_order: sortOrder,
        depends_on_ids: data.depends_on_ids ?? [],
      },
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
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();

    // Check if this is a reorder request
    if ('task_ids' in body) {
      const { task_ids } = reorderTasksSchema.parse(body);

      // Update sort_order for each task
      await prisma.$transaction(
        task_ids.map((taskId, index) =>
          prisma.recipeTask.update({
            where: { id: taskId },
            data: { sort_order: index },
          })
        )
      );

      return NextResponse.json({ success: true });
    }

    // Otherwise, this is an update to a single task
    const { task_id, ...updateData } = body;
    if (!task_id) {
      throw new ApiError('task_id is required for updates', 400);
    }

    const parsed = updateTaskSchema.parse(updateData);

    // Build update data
    const updatePayload: {
      sop_id?: string;
      title?: string | null;
      is_variable?: boolean;
      variable_source?: string | null;
      sort_order?: number;
      depends_on_ids?: string[];
    } = {};

    if (parsed.sop_id !== undefined) {
      // Verify new SOP exists
      const sop = await prisma.sop.findUnique({
        where: { id: parsed.sop_id },
      });
      if (!sop) {
        throw new ApiError('SOP not found', 404);
      }
      updatePayload.sop_id = parsed.sop_id;
    }
    if (parsed.title !== undefined) updatePayload.title = parsed.title;
    if (parsed.is_variable !== undefined) updatePayload.is_variable = parsed.is_variable;
    if (parsed.variable_source !== undefined) updatePayload.variable_source = parsed.variable_source;
    if (parsed.sort_order !== undefined) updatePayload.sort_order = parsed.sort_order;

    // Validate depends_on_ids if provided
    if (parsed.depends_on_ids !== undefined) {
      const { id: recipeId } = await params;

      if (parsed.depends_on_ids.length > 0) {
        // Verify all dependency IDs exist in the same recipe
        const validTasks = await prisma.recipeTask.findMany({
          where: {
            id: { in: parsed.depends_on_ids },
            phase: { recipe_id: recipeId },
          },
          select: { id: true },
        });

        const validIds = new Set(validTasks.map((t) => t.id));
        const invalidIds = parsed.depends_on_ids.filter((id) => !validIds.has(id));

        if (invalidIds.length > 0) {
          throw new ApiError('One or more dependency tasks not found in this recipe', 400);
        }

        // Check for self-reference
        if (parsed.depends_on_ids.includes(task_id)) {
          throw new ApiError('A task cannot depend on itself', 400);
        }

        // Check for circular dependencies
        const allTasks = await prisma.recipeTask.findMany({
          where: { phase: { recipe_id: recipeId } },
          select: { id: true, depends_on_ids: true },
        });

        const hasCircle = detectCircularDependency(task_id, parsed.depends_on_ids, allTasks);
        if (hasCircle) {
          throw new ApiError('Cannot add dependencies: would create circular dependency', 400);
        }
      }

      updatePayload.depends_on_ids = parsed.depends_on_ids;
    }

    const task = await prisma.recipeTask.update({
      where: { id: task_id },
      data: updatePayload,
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
    });

    return NextResponse.json({ task });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');

    if (!taskId) {
      throw new ApiError('task_id is required', 400);
    }

    await prisma.recipeTask.delete({
      where: { id: taskId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
