import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const moveTaskSchema = z.object({
  target_phase_id: z.string().uuid().nullable(), // null to move to unphased
  sort_order: z.number().min(0),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: taskId } = await params;

    const body = await request.json();
    const { target_phase_id, sort_order } = moveTaskSchema.parse(body);

    // Verify the task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        project_id: true,
        phase_id: true,
        sort_order: true,
      },
    });

    if (!task) {
      throw new ApiError('Task not found', 404);
    }

    if (!task.project_id) {
      throw new ApiError('Task is not associated with a project', 400);
    }

    // If moving to a phase, verify it belongs to the same project
    if (target_phase_id) {
      const targetPhase = await prisma.projectPhase.findUnique({
        where: { id: target_phase_id },
      });

      if (!targetPhase) {
        throw new ApiError('Target phase not found', 404);
      }

      if (targetPhase.project_id !== task.project_id) {
        throw new ApiError('Target phase does not belong to this project', 400);
      }
    }

    const oldPhaseId = task.phase_id;
    const isMovingBetweenPhases = oldPhaseId !== target_phase_id;

    await prisma.$transaction(async (tx) => {
      if (isMovingBetweenPhases) {
        // Moving to a different phase (or to/from unphased)
        // 1. Shift tasks down in target phase to make room
        await tx.task.updateMany({
          where: {
            project_id: task.project_id,
            phase_id: target_phase_id,
            sort_order: { gte: sort_order },
          },
          data: {
            sort_order: { increment: 1 },
          },
        });

        // 2. Move the task to target phase
        await tx.task.update({
          where: { id: taskId },
          data: {
            phase_id: target_phase_id,
            sort_order: sort_order,
          },
        });

        // 3. Close the gap in the old phase
        await tx.task.updateMany({
          where: {
            project_id: task.project_id,
            phase_id: oldPhaseId,
            sort_order: { gt: task.sort_order },
          },
          data: {
            sort_order: { decrement: 1 },
          },
        });
      } else {
        // Reordering within the same phase
        const oldOrder = task.sort_order;
        const newOrder = sort_order;

        if (oldOrder < newOrder) {
          // Moving down - shift items between old and new up
          await tx.task.updateMany({
            where: {
              project_id: task.project_id,
              phase_id: target_phase_id,
              sort_order: { gt: oldOrder, lte: newOrder },
              id: { not: taskId },
            },
            data: {
              sort_order: { decrement: 1 },
            },
          });
        } else if (oldOrder > newOrder) {
          // Moving up - shift items between new and old down
          await tx.task.updateMany({
            where: {
              project_id: task.project_id,
              phase_id: target_phase_id,
              sort_order: { gte: newOrder, lt: oldOrder },
              id: { not: taskId },
            },
            data: {
              sort_order: { increment: 1 },
            },
          });
        }

        // Update the task's sort order
        await tx.task.update({
          where: { id: taskId },
          data: { sort_order: newOrder },
        });
      }
    });

    // Fetch updated task
    const updatedTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        phase_id: true,
        sort_order: true,
      },
    });

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    return handleApiError(error);
  }
}
