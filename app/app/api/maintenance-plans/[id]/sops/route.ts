import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateSopsSchema = z.object({
  sopIds: z.array(z.string().uuid()),
});

/**
 * GET /api/maintenance-plans/[id]/sops
 * Get all SOPs for a maintenance plan
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin', 'pm']);
    const { id } = await params;

    const plan = await prisma.maintenancePlan.findUnique({
      where: { id },
      include: {
        sops: {
          include: {
            sop: {
              select: {
                id: true,
                title: true,
                function_id: true,
                energy_estimate: true,
                mystery_factor: true,
                battery_impact: true,
                is_active: true,
              },
            },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    if (!plan) {
      throw new ApiError('Maintenance plan not found', 404);
    }

    return NextResponse.json({
      sops: plan.sops.map((ps) => ({
        id: ps.sop.id,
        title: ps.sop.title,
        function_id: ps.sop.function_id,
        energy_estimate: ps.sop.energy_estimate,
        mystery_factor: ps.sop.mystery_factor,
        battery_impact: ps.sop.battery_impact,
        is_active: ps.sop.is_active,
        sort_order: ps.sort_order,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/maintenance-plans/[id]/sops
 * Update the SOPs for a maintenance plan (replace all)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const body = await request.json();
    const { sopIds } = updateSopsSchema.parse(body);

    // Verify plan exists
    const plan = await prisma.maintenancePlan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new ApiError('Maintenance plan not found', 404);
    }

    // Verify all SOPs exist
    const sops = await prisma.sop.findMany({
      where: { id: { in: sopIds } },
      select: { id: true },
    });

    if (sops.length !== sopIds.length) {
      throw new ApiError('One or more SOPs not found', 400);
    }

    // Replace all SOPs in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete existing
      await tx.maintenancePlanSop.deleteMany({
        where: { maintenance_plan_id: id },
      });

      // Create new with sort order
      if (sopIds.length > 0) {
        await tx.maintenancePlanSop.createMany({
          data: sopIds.map((sopId, index) => ({
            maintenance_plan_id: id,
            sop_id: sopId,
            sort_order: index,
          })),
        });
      }

      // Update plan timestamp
      await tx.maintenancePlan.update({
        where: { id },
        data: { updated_at: new Date() },
      });
    });

    // Return updated list
    const updatedPlan = await prisma.maintenancePlan.findUnique({
      where: { id },
      include: {
        sops: {
          include: {
            sop: {
              select: {
                id: true,
                title: true,
                function_id: true,
                energy_estimate: true,
                is_active: true,
              },
            },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    return NextResponse.json({
      sops: updatedPlan?.sops.map((ps) => ({
        id: ps.sop.id,
        title: ps.sop.title,
        function_id: ps.sop.function_id,
        energy_estimate: ps.sop.energy_estimate,
        is_active: ps.sop.is_active,
        sort_order: ps.sort_order,
      })) || [],
    });
  } catch (error) {
    return handleApiError(error);
  }
}
