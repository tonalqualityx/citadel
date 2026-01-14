import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';

const updateBillingSchema = z.object({
  is_billable: z.boolean().optional(),
  billing_target: z.number().min(1).optional().nullable(),
  billing_amount: z.number().min(0).optional().nullable(),
  is_retainer_work: z.boolean().optional(),
  invoiced: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    // Check if task exists
    const existingTask = await prisma.task.findUnique({
      where: { id, is_deleted: false },
    });

    if (!existingTask) {
      throw new ApiError('Task not found', 404);
    }

    const body = await request.json();
    const data = updateBillingSchema.parse(body);

    // Build update data
    const updateData: Record<string, any> = {};

    // Handle billing field updates
    if (data.is_billable !== undefined) {
      updateData.is_billable = data.is_billable;
    }

    if (data.billing_target !== undefined) {
      updateData.billing_target = data.billing_target;
    }

    if (data.billing_amount !== undefined) {
      updateData.billing_amount = data.billing_amount;
    }

    if (data.is_retainer_work !== undefined) {
      updateData.is_retainer_work = data.is_retainer_work;
    }

    // Handle invoiced update
    if (data.invoiced !== undefined) {
      updateData.invoiced = data.invoiced;

      if (data.invoiced) {
        // When marking as invoiced, set timestamp and user
        updateData.invoiced_at = new Date();
        updateData.invoiced_by_id = auth.userId;
      } else {
        // When unmarking as invoiced, clear timestamp and user
        updateData.invoiced_at = null;
        updateData.invoiced_by_id = null;
      }
    }

    // Update the task
    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            status: true,
            client: { select: { id: true, name: true } },
          },
        },
        assignee: { select: { id: true, name: true, email: true, avatar_url: true } },
        reviewer: { select: { id: true, name: true, email: true, avatar_url: true } },
        approved_by: { select: { id: true, name: true } },
        function: { select: { id: true, name: true } },
        sop: { select: { id: true, title: true, estimated_minutes: true, content: true } },
        created_by: { select: { id: true, name: true } },
        project_phase: { select: { id: true, name: true, icon: true, sort_order: true } },
        blocked_by: { select: { id: true, title: true, status: true } },
        blocking: { select: { id: true, title: true, status: true } },
        time_entries: {
          where: { is_deleted: false },
          select: { id: true, duration: true },
        },
      },
    });

    return NextResponse.json(formatTaskResponse(task));
  } catch (error) {
    return handleApiError(error);
  }
}
