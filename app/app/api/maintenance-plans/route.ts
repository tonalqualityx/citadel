import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const VALID_FREQUENCIES = ['monthly', 'bi_monthly', 'quarterly', 'semi_annually', 'annually'] as const;

const createMaintenancePlanSchema = z.object({
  name: z.string().min(1).max(100),
  rate: z.number().min(0),
  agency_rate: z.number().min(0).optional().nullable(),
  hours: z.number().min(0).optional().nullable(),
  details: z.string().optional().nullable(),
  frequency: z.enum(VALID_FREQUENCIES).optional(),
  is_active: z.boolean().optional(),
  sop_ids: z.array(z.string().uuid()).optional(),
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
    sop_ids: plan.sops?.map((ps: any) => ps.sop_id) ?? [],
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('include_inactive') === 'true';

    const where = includeInactive ? {} : { is_active: true };

    const plans = await prisma.maintenancePlan.findMany({
      where,
      include: {
        _count: { select: { sites: true, sops: true } },
        sops: {
          select: { sop_id: true },
          orderBy: { sort_order: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      maintenance_plans: plans.map(formatMaintenancePlan),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const data = createMaintenancePlanSchema.parse(body);

    const { sop_ids, ...planData } = data;

    // Create plan and SOPs in a transaction
    const plan = await prisma.$transaction(async (tx) => {
      const newPlan = await tx.maintenancePlan.create({
        data: {
          name: planData.name,
          rate: planData.rate,
          agency_rate: planData.agency_rate,
          hours: planData.hours,
          details: planData.details,
          frequency: planData.frequency ?? 'monthly',
          is_active: planData.is_active ?? true,
        },
      });

      // Create SOP associations if provided
      if (sop_ids && sop_ids.length > 0) {
        await tx.maintenancePlanSop.createMany({
          data: sop_ids.map((sopId, index) => ({
            maintenance_plan_id: newPlan.id,
            sop_id: sopId,
            sort_order: index,
          })),
        });
      }

      // Return with all includes
      return tx.maintenancePlan.findUnique({
        where: { id: newPlan.id },
        include: {
          _count: { select: { sites: true, sops: true } },
          sops: {
            select: { sop_id: true },
            orderBy: { sort_order: 'asc' },
          },
        },
      });
    });

    return NextResponse.json(formatMaintenancePlan(plan), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
