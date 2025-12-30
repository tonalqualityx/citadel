import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const VALID_FREQUENCIES = ['monthly', 'bi_monthly', 'quarterly', 'semi_annually', 'annually'] as const;

const updateMaintenancePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  rate: z.number().min(0).optional(),
  agency_rate: z.number().min(0).optional().nullable(),
  hours: z.number().min(0).optional().nullable(),
  details: z.string().optional().nullable(),
  frequency: z.enum(VALID_FREQUENCIES).optional(),
  is_active: z.boolean().optional(),
});

function formatMaintenancePlan(plan: any) {
  return {
    id: plan.id,
    name: plan.name,
    rate: plan.rate ? Number(plan.rate) : 0,
    agency_rate: plan.agency_rate ? Number(plan.agency_rate) : null,
    hours: plan.hours ? Number(plan.hours) : null,
    details: plan.details,
    frequency: plan.frequency,
    is_active: plan.is_active,
    sites_count: plan._count?.sites ?? 0,
    sops_count: plan._count?.sops ?? 0,
    sops: plan.sops?.map((ps: any) => ({
      id: ps.sop.id,
      title: ps.sop.title,
      sort_order: ps.sort_order,
    })) ?? [],
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const plan = await prisma.maintenancePlan.findUnique({
      where: { id },
      include: {
        _count: { select: { sites: true, sops: true } },
        sites: {
          where: { is_deleted: false },
          select: { id: true, name: true, client: { select: { id: true, name: true } } },
          take: 10,
        },
        sops: {
          include: { sop: { select: { id: true, title: true } } },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    if (!plan) {
      throw new ApiError('Maintenance plan not found', 404);
    }

    return NextResponse.json(formatMaintenancePlan(plan));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateMaintenancePlanSchema.parse(body);

    const plan = await prisma.maintenancePlan.update({
      where: { id },
      data,
      include: {
        _count: { select: { sites: true, sops: true } },
        sops: {
          include: { sop: { select: { id: true, title: true } } },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    return NextResponse.json(formatMaintenancePlan(plan));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    // Check if any sites are using this plan
    const sitesCount = await prisma.site.count({
      where: { maintenance_plan_id: id, is_deleted: false },
    });

    if (sitesCount > 0) {
      throw new ApiError(
        `Cannot delete maintenance plan: ${sitesCount} site(s) are using it. Deactivate instead.`,
        400
      );
    }

    await prisma.maintenancePlan.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
