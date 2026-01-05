import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const bulkUpdateSchema = z.object({
  sop_ids: z.array(z.string().uuid()).min(1, 'At least one SOP ID is required'),
  data: z.object({
    is_active: z.boolean().optional(),
    function_id: z.string().uuid().nullable().optional(),
    energy_estimate: z.number().int().min(1).max(8).nullable().optional(),
    battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']).optional(),
  }).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field to update is required' }
  ),
});

const bulkDeleteSchema = z.object({
  sop_ids: z.array(z.string().uuid()).min(1, 'At least one SOP ID is required'),
});

// PATCH /api/sops/bulk - Bulk update SOPs
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const { sop_ids, data } = bulkUpdateSchema.parse(body);

    // Verify all SOPs exist
    const existingSops = await prisma.sop.findMany({
      where: {
        id: { in: sop_ids },
      },
      select: { id: true },
    });

    if (existingSops.length !== sop_ids.length) {
      const existingIds = new Set(existingSops.map((s) => s.id));
      const missingIds = sop_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`SOPs not found: ${missingIds.join(', ')}`, 404);
    }

    // Validate function exists if provided
    if (data.function_id) {
      const fn = await prisma.function.findUnique({
        where: { id: data.function_id },
      });
      if (!fn) {
        throw new ApiError('Function not found', 404);
      }
    }

    // Build update data for updateMany
    // Note: updateMany doesn't support relation connect/disconnect,
    // so we use the raw function_id field
    const updateData: Record<string, unknown> = {};

    if (data.is_active !== undefined) {
      updateData.is_active = data.is_active;
    }
    if (data.function_id !== undefined) {
      updateData.function_id = data.function_id;
    }
    if (data.energy_estimate !== undefined) {
      updateData.energy_estimate = data.energy_estimate;
    }
    if (data.battery_impact !== undefined) {
      updateData.battery_impact = data.battery_impact;
    }

    // Perform the bulk update
    const result = await prisma.sop.updateMany({
      where: {
        id: { in: sop_ids },
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

// DELETE /api/sops/bulk - Bulk soft delete SOPs
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const { sop_ids } = bulkDeleteSchema.parse(body);

    // Verify all SOPs exist
    const existingSops = await prisma.sop.findMany({
      where: {
        id: { in: sop_ids },
      },
      select: { id: true },
    });

    if (existingSops.length !== sop_ids.length) {
      const existingIds = new Set(existingSops.map((s) => s.id));
      const missingIds = sop_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`SOPs not found: ${missingIds.join(', ')}`, 404);
    }

    // Soft delete by setting is_active to false
    const result = await prisma.sop.updateMany({
      where: { id: { in: sop_ids } },
      data: { is_active: false },
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
