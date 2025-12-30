import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';

const batchInvoiceSchema = z.object({
  milestone_ids: z.array(z.string().uuid()).optional(),
  task_ids: z.array(z.string().uuid()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = batchInvoiceSchema.parse(body);

    const milestoneIds = data.milestone_ids || [];
    const taskIds = data.task_ids || [];

    // Must have at least one item to invoice
    if (milestoneIds.length === 0 && taskIds.length === 0) {
      throw new ApiError('At least one milestone or task ID is required', 400);
    }

    // Validate all milestone IDs exist and are in 'triggered' status
    if (milestoneIds.length > 0) {
      const milestones = await prisma.milestone.findMany({
        where: {
          id: { in: milestoneIds },
        },
        select: {
          id: true,
          billing_status: true,
        },
      });

      if (milestones.length !== milestoneIds.length) {
        const foundIds = new Set(milestones.map((m) => m.id));
        const missingIds = milestoneIds.filter((id) => !foundIds.has(id));
        throw new ApiError(`Milestones not found: ${missingIds.join(', ')}`, 404);
      }

      const nonTriggeredMilestones = milestones.filter(
        (m) => m.billing_status !== 'triggered'
      );
      if (nonTriggeredMilestones.length > 0) {
        throw new ApiError(
          `Milestones must be in 'triggered' status to invoice. Invalid: ${nonTriggeredMilestones.map((m) => m.id).join(', ')}`,
          400
        );
      }
    }

    // Validate all task IDs exist and are not already invoiced
    if (taskIds.length > 0) {
      const tasks = await prisma.task.findMany({
        where: {
          id: { in: taskIds },
          is_deleted: false,
        },
        select: {
          id: true,
          invoiced: true,
          status: true,
        },
      });

      if (tasks.length !== taskIds.length) {
        const foundIds = new Set(tasks.map((t) => t.id));
        const missingIds = taskIds.filter((id) => !foundIds.has(id));
        throw new ApiError(`Tasks not found: ${missingIds.join(', ')}`, 404);
      }

      const alreadyInvoicedTasks = tasks.filter((t) => t.invoiced);
      if (alreadyInvoicedTasks.length > 0) {
        throw new ApiError(
          `Tasks already invoiced: ${alreadyInvoicedTasks.map((t) => t.id).join(', ')}`,
          400
        );
      }

      const incompleteTasks = tasks.filter((t) => t.status !== 'done');
      if (incompleteTasks.length > 0) {
        throw new ApiError(
          `Tasks must be completed before invoicing: ${incompleteTasks.map((t) => t.id).join(', ')}`,
          400
        );
      }
    }

    const now = new Date();

    // Perform updates in a transaction
    const result = await prisma.$transaction(async (tx) => {
      let milestonesUpdated = 0;
      let tasksUpdated = 0;

      // Update milestones
      if (milestoneIds.length > 0) {
        const updateResult = await tx.milestone.updateMany({
          where: {
            id: { in: milestoneIds },
            billing_status: 'triggered',
          },
          data: {
            billing_status: 'invoiced',
            invoiced_at: now,
            invoiced_by_id: auth.userId,
          },
        });
        milestonesUpdated = updateResult.count;
      }

      // Update tasks
      if (taskIds.length > 0) {
        const updateResult = await tx.task.updateMany({
          where: {
            id: { in: taskIds },
            invoiced: false,
            is_deleted: false,
          },
          data: {
            invoiced: true,
            invoiced_at: now,
            invoiced_by_id: auth.userId,
          },
        });
        tasksUpdated = updateResult.count;
      }

      return {
        milestonesUpdated,
        tasksUpdated,
      };
    });

    return NextResponse.json({
      success: true,
      milestonesUpdated: result.milestonesUpdated,
      tasksUpdated: result.tasksUpdated,
      totalUpdated: result.milestonesUpdated + result.tasksUpdated,
      invoicedAt: now.toISOString(),
      invoicedById: auth.userId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
