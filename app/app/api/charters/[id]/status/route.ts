import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterResponse } from '@/lib/api/formatters';

const VALID_TRANSITIONS: Record<string, string[]> = {
  active: ['paused', 'cancelled'],
  paused: ['active', 'cancelled'],
};

const updateStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled']),
  cancellation_reason: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateStatusSchema.parse(body);

    const charter = await prisma.charter.findFirst({
      where: { id, is_deleted: false },
    });

    if (!charter) {
      throw new ApiError('Charter not found', 404);
    }

    const allowedTargets = VALID_TRANSITIONS[charter.status];
    if (!allowedTargets || !allowedTargets.includes(data.status)) {
      throw new ApiError(
        `Cannot transition from '${charter.status}' to '${data.status}'`,
        400,
        'INVALID_STATUS_TRANSITION'
      );
    }

    const updateData: any = {
      status: data.status,
    };

    if (data.status === 'paused') {
      updateData.paused_at = new Date();
    } else if (data.status === 'cancelled') {
      updateData.cancelled_at = new Date();
      if (data.cancellation_reason) {
        updateData.cancellation_reason = data.cancellation_reason;
      }
    } else if (data.status === 'active') {
      // Reactivating from paused
      updateData.paused_at = null;
    }

    const updated = await prisma.charter.update({
      where: { id },
      data: updateData,
      include: {
        client: { select: { id: true, name: true, status: true } },
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true } },
        _count: { select: { tasks: true } },
      },
    });

    return NextResponse.json(formatCharterResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}
