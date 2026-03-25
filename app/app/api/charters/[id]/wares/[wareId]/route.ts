import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterWareResponse } from '@/lib/api/formatters';

const updateCharterWareSchema = z.object({
  price: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; wareId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, wareId } = await params;

    const charterWare = await prisma.charterWare.findFirst({
      where: { id: wareId, charter_id: id },
    });

    if (!charterWare) {
      throw new ApiError('Charter ware not found', 404);
    }

    const body = await request.json();
    const data = updateCharterWareSchema.parse(body);

    const updateData: any = { ...data };

    // Set deactivated_at when is_active becomes false
    if (data.is_active === false && charterWare.is_active) {
      updateData.deactivated_at = new Date();
    } else if (data.is_active === true && !charterWare.is_active) {
      updateData.deactivated_at = null;
    }

    const updated = await prisma.charterWare.update({
      where: { id: wareId },
      data: updateData,
      include: {
        ware: { select: { id: true, name: true, type: true } },
      },
    });

    return NextResponse.json(formatCharterWareResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; wareId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, wareId } = await params;

    const charterWare = await prisma.charterWare.findFirst({
      where: { id: wareId, charter_id: id },
    });

    if (!charterWare) {
      throw new ApiError('Charter ware not found', 404);
    }

    await prisma.charterWare.delete({
      where: { id: wareId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
