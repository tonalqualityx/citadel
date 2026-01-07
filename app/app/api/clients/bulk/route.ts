import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const bulkUpdateSchema = z.object({
  client_ids: z.array(z.string().uuid()).min(1, 'At least one client ID is required'),
  data: z.object({
    status: z.enum(['active', 'inactive', 'delinquent']).optional(),
    type: z.enum(['direct', 'agency_partner', 'sub_client']).optional(),
    retainer_hours: z.number().min(0).nullable().optional(),
    hourly_rate: z.number().min(0).nullable().optional(),
  }).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field to update is required' }
  ),
});

const bulkDeleteSchema = z.object({
  client_ids: z.array(z.string().uuid()).min(1, 'At least one client ID is required'),
});

// PATCH /api/clients/bulk - Bulk update clients
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const { client_ids, data } = bulkUpdateSchema.parse(body);

    // Verify all clients exist and are not deleted
    const existingClients = await prisma.client.findMany({
      where: {
        id: { in: client_ids },
        is_deleted: false,
      },
      select: { id: true },
    });

    if (existingClients.length !== client_ids.length) {
      const existingIds = new Set(existingClients.map((c) => c.id));
      const missingIds = client_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`Clients not found: ${missingIds.join(', ')}`, 404);
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if ('status' in data) {
      updateData.status = data.status;
    }
    if ('type' in data) {
      updateData.type = data.type;
    }
    if ('retainer_hours' in data) {
      updateData.retainer_hours = data.retainer_hours;
    }
    if ('hourly_rate' in data) {
      updateData.hourly_rate = data.hourly_rate;
    }

    // Perform the bulk update
    const result = await prisma.client.updateMany({
      where: {
        id: { in: client_ids },
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

// DELETE /api/clients/bulk - Bulk soft delete clients
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const { client_ids } = bulkDeleteSchema.parse(body);

    // Verify all clients exist and are not deleted
    const existingClients = await prisma.client.findMany({
      where: {
        id: { in: client_ids },
        is_deleted: false,
      },
      select: { id: true },
    });

    if (existingClients.length !== client_ids.length) {
      const existingIds = new Set(existingClients.map((c) => c.id));
      const missingIds = client_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`Clients not found: ${missingIds.join(', ')}`, 404);
    }

    // Soft delete clients
    const result = await prisma.client.updateMany({
      where: { id: { in: client_ids } },
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
