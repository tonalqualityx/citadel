import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const bulkUpdateSchema = z.object({
  site_ids: z.array(z.string().uuid()).min(1, 'At least one site ID is required'),
  data: z.object({
    client_id: z.string().uuid().optional(),
    hosted_by: z.enum(['indelible', 'client', 'other']).optional(),
    hosting_plan_id: z.string().uuid().nullable().optional(),
    maintenance_plan_id: z.string().uuid().nullable().optional(),
    maintenance_assignee_id: z.string().uuid().nullable().optional(),
  }).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field to update is required' }
  ),
});

const bulkDeleteSchema = z.object({
  site_ids: z.array(z.string().uuid()).min(1, 'At least one site ID is required'),
});

// PATCH /api/sites/bulk - Bulk update sites
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const { site_ids, data } = bulkUpdateSchema.parse(body);

    // Verify all sites exist and are not deleted
    const existingSites = await prisma.site.findMany({
      where: {
        id: { in: site_ids },
        is_deleted: false,
      },
      select: { id: true },
    });

    if (existingSites.length !== site_ids.length) {
      const existingIds = new Set(existingSites.map((s) => s.id));
      const missingIds = site_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`Sites not found: ${missingIds.join(', ')}`, 404);
    }

    // Validate client exists if provided
    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id, is_deleted: false },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    // Validate hosting plan exists if provided
    if (data.hosting_plan_id) {
      const hostingPlan = await prisma.hostingPlan.findUnique({
        where: { id: data.hosting_plan_id },
      });
      if (!hostingPlan) {
        throw new ApiError('Hosting plan not found', 404);
      }
    }

    // Validate maintenance plan exists if provided
    if (data.maintenance_plan_id) {
      const maintenancePlan = await prisma.maintenancePlan.findUnique({
        where: { id: data.maintenance_plan_id },
      });
      if (!maintenancePlan) {
        throw new ApiError('Maintenance plan not found', 404);
      }
    }

    // Validate maintenance assignee exists if provided
    if (data.maintenance_assignee_id) {
      const assignee = await prisma.user.findFirst({
        where: { id: data.maintenance_assignee_id, is_active: true },
      });
      if (!assignee) {
        throw new ApiError('Maintenance assignee not found', 404);
      }
    }

    // Perform the bulk update
    const result = await prisma.site.updateMany({
      where: {
        id: { in: site_ids },
        is_deleted: false,
      },
      data,
    });

    return NextResponse.json({
      success: true,
      updated: result.count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/sites/bulk - Bulk delete sites
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const { site_ids } = bulkDeleteSchema.parse(body);

    // Verify all sites exist and are not deleted
    const existingSites = await prisma.site.findMany({
      where: {
        id: { in: site_ids },
        is_deleted: false,
      },
      select: { id: true },
    });

    if (existingSites.length !== site_ids.length) {
      const existingIds = new Set(existingSites.map((s) => s.id));
      const missingIds = site_ids.filter((id) => !existingIds.has(id));
      throw new ApiError(`Sites not found: ${missingIds.join(', ')}`, 404);
    }

    // Soft delete sites and their domains in a transaction
    const result = await prisma.$transaction([
      // Soft delete all domains belonging to these sites
      prisma.domain.updateMany({
        where: { site_id: { in: site_ids } },
        data: { is_deleted: true },
      }),
      // Soft delete all sites
      prisma.site.updateMany({
        where: { id: { in: site_ids } },
        data: { is_deleted: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      deleted: result[1].count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
