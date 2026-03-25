import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterScheduledTaskResponse } from '@/lib/api/formatters';

const updateScheduledTaskSchema = z.object({
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'semi_annually', 'annually']).optional(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
  charter_ware_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, taskId } = await params;

    const scheduledTask = await prisma.charterScheduledTask.findFirst({
      where: { id: taskId, charter_id: id },
    });

    if (!scheduledTask) {
      throw new ApiError('Scheduled task not found', 404);
    }

    const body = await request.json();
    const data = updateScheduledTaskSchema.parse(body);

    const updated = await prisma.charterScheduledTask.update({
      where: { id: taskId },
      data,
      include: {
        sop: { select: { id: true, title: true } },
      },
    });

    return NextResponse.json(formatCharterScheduledTaskResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, taskId } = await params;

    const scheduledTask = await prisma.charterScheduledTask.findFirst({
      where: { id: taskId, charter_id: id },
    });

    if (!scheduledTask) {
      throw new ApiError('Scheduled task not found', 404);
    }

    await prisma.charterScheduledTask.delete({
      where: { id: taskId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
