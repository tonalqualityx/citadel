import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const createHostingPlanSchema = z.object({
  name: z.string().min(1).max(100),
  rate: z.number().min(0),
  agency_rate: z.number().min(0).optional().nullable(),
  monthly_cost: z.number().min(0).optional().nullable(),
  vendor_plan: z.string().max(100).optional().nullable(),
  details: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});

function formatHostingPlan(plan: any) {
  return {
    id: plan.id,
    name: plan.name,
    rate: plan.rate ? Number(plan.rate) : 0,
    agency_rate: plan.agency_rate ? Number(plan.agency_rate) : null,
    monthly_cost: plan.monthly_cost ? Number(plan.monthly_cost) : null,
    vendor_plan: plan.vendor_plan,
    details: plan.details,
    is_active: plan.is_active,
    sites_count: plan._count?.sites ?? 0,
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

    const plans = await prisma.hostingPlan.findMany({
      where,
      include: {
        _count: { select: { sites: true } },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      hosting_plans: plans.map(formatHostingPlan),
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
    const data = createHostingPlanSchema.parse(body);

    const plan = await prisma.hostingPlan.create({
      data: {
        name: data.name,
        rate: data.rate,
        agency_rate: data.agency_rate,
        monthly_cost: data.monthly_cost,
        vendor_plan: data.vendor_plan,
        details: data.details,
        is_active: data.is_active ?? true,
      },
      include: {
        _count: { select: { sites: true } },
      },
    });

    return NextResponse.json(formatHostingPlan(plan), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
