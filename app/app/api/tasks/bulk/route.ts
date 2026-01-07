import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const bulkUpdateSchema = z.object({
  task_ids: z.array(z.string().uuid()).min(1, 'At least one task ID is required'),
  data: z.object({
    due_date: z.string().datetime().nullable().optional(),
    assignee_id: z.string().uuid().nullable().optional(),
  }).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field to update is required' }
  ),
});

const bulkDeleteSchema = z.object({
  task_ids: z.array(z.string().uuid()).min(1, 'At least one task ID is required'),
});

// PATCH /api/tasks/bulk - Bulk update tasks
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const { task_ids, data } = bulkUpdateSchema.parse(body);

    // Verify all tasks exist and are not deleted
    const existingTasks = await prisma.task.findMany({
      where: {
        id: { in: task_ids },
        is_deleted: false,
      },
      select: { id: true },
    });

    if (existingTasks.length !== task_ids.length) {
      const existingIds = new Set(existingTasks.map((t) => t.id));
      const missingIds = task_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`Tasks not found: ${missingIds.join(', ')}`, 404);
    }

    // Validate assignee exists if provided
    if (data.assignee_id) {
      const assignee = await prisma.user.findFirst({
        where: { id: data.assignee_id, is_active: true },
      });
      if (!assignee) {
        throw new ApiError('Assignee not found', 404);
      }
    }

    // Build update data, converting due_date string to Date if provided
    const updateData: Record<string, unknown> = {};
    if ('due_date' in data) {
      updateData.due_date = data.due_date ? new Date(data.due_date) : null;
    }
    if ('assignee_id' in data) {
      updateData.assignee_id = data.assignee_id;
    }

    // Perform the bulk update
    const result = await prisma.task.updateMany({
      where: {
        id: { in: task_ids },
        is_deleted: false,
      },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      updated: result.count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/tasks/bulk - Bulk delete tasks
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const { task_ids } = bulkDeleteSchema.parse(body);

    // Verify all tasks exist and are not deleted
    const existingTasks = await prisma.task.findMany({
      where: {
        id: { in: task_ids },
        is_deleted: false,
      },
      select: { id: true },
    });

    if (existingTasks.length !== task_ids.length) {
      const existingIds = new Set(existingTasks.map((t) => t.id));
      const missingIds = task_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`Tasks not found: ${missingIds.join(', ')}`, 404);
    }

    // Soft delete tasks
    const result = await prisma.task.updateMany({
      where: { id: { in: task_ids } },
      data: { is_deleted: true },
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
