import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const reorderTasksSchema = z.object({
  task_ids: z.array(z.string().uuid()),
  phase_id: z.string().uuid().nullable(), // null for unphased tasks
});

export async function PATCH(
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
    const { task_ids, phase_id } = reorderTasksSchema.parse(body);

    // Verify all tasks belong to this project and the specified phase
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: task_ids },
        project_id: projectId,
        phase_id: phase_id,
      },
      select: { id: true },
    });

    if (tasks.length !== task_ids.length) {
      throw new ApiError('Some tasks do not belong to this project or phase', 400);
    }

    // Update sort_order for each task
    await prisma.$transaction(
      task_ids.map((taskId, index) =>
        prisma.task.update({
          where: { id: taskId },
          data: { sort_order: index },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
