import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterCommissionResponse } from '@/lib/api/formatters';

const updateCharterCommissionSchema = z.object({
  allocated_hours_per_period: z.number().min(0).nullable().optional(),
  end_period: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  completed_at: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, linkId } = await params;

    const charterCommission = await prisma.charterCommission.findFirst({
      where: { id: linkId, charter_id: id },
    });

    if (!charterCommission) {
      throw new ApiError('Charter commission not found', 404);
    }

    const body = await request.json();
    const data = updateCharterCommissionSchema.parse(body);

    const updateData: any = { ...data };
    if (data.completed_at !== undefined) {
      updateData.completed_at = data.completed_at ? new Date(data.completed_at) : null;
    }

    const updated = await prisma.charterCommission.update({
      where: { id: linkId },
      data: updateData,
      include: {
        commission: { select: { id: true, name: true, status: true } },
      },
    });

    return NextResponse.json(formatCharterCommissionResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, linkId } = await params;

    const charterCommission = await prisma.charterCommission.findFirst({
      where: { id: linkId, charter_id: id },
    });

    if (!charterCommission) {
      throw new ApiError('Charter commission not found', 404);
    }

    await prisma.charterCommission.delete({
      where: { id: linkId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
