import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAccordKeepItemResponse } from '@/lib/api/formatters';

const createKeepItemSchema = z.object({
  site_id: z.string().uuid().optional().nullable(),
  site_name_placeholder: z.string().max(255).optional().nullable(),
  domain_name: z.string().max(255).optional().nullable(),
  hosting_plan_id: z.string().uuid().optional().nullable(),
  maintenance_plan_id: z.string().uuid(),
  hosting_price: z.number().min(0).optional().nullable(),
  hosting_discount_type: z.enum(['percent', 'flat']).optional().nullable(),
  hosting_discount_value: z.number().min(0).optional().nullable(),
  maintenance_price: z.number().min(0),
  maintenance_discount_type: z.enum(['percent', 'flat']).optional().nullable(),
  maintenance_discount_value: z.number().min(0).optional().nullable(),
  is_client_hosted: z.boolean().optional(),
  contract_language_override: z.string().optional().nullable(),
  sort_order: z.number().int().optional(),
});

function calculateDiscount(basePrice: number | null, discountType: string | null, discountValue: number | null): number | null {
  if (basePrice === null || basePrice === undefined) return null;
  let finalPrice = basePrice;
  if (discountType === 'percent' && discountValue) {
    finalPrice = basePrice * (1 - discountValue / 100);
  } else if (discountType === 'flat' && discountValue) {
    finalPrice = basePrice - discountValue;
  }
  return Math.max(0, finalPrice);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const items = await prisma.accordKeepItem.findMany({
      where: { accord_id: id, is_deleted: false },
      include: {
        site: { select: { id: true, name: true, url: true } },
        hosting_plan: { select: { id: true, name: true, rate: true } },
        maintenance_plan: { select: { id: true, name: true, rate: true } },
      },
      orderBy: { sort_order: 'asc' },
    });

    return NextResponse.json(items.map(formatAccordKeepItemResponse));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = createKeepItemSchema.parse(body);

    // Validate accord exists
    const accord = await prisma.accord.findUnique({
      where: { id, is_deleted: false },
    });
    if (!accord) throw new ApiError('Accord not found', 404);

    const isClientHosted = data.is_client_hosted || false;

    // Validate: if not client hosted, hosting_plan_id should be present
    // Validate maintenance_plan_id is always present (already required by schema)

    // If client hosted, null out hosting fields
    const hostingPrice = isClientHosted ? null : (data.hosting_price ?? null);
    const hostingDiscountType = isClientHosted ? null : (data.hosting_discount_type || null);
    const hostingDiscountValue = isClientHosted ? null : (data.hosting_discount_value ?? null);
    const hostingPlanId = isClientHosted ? null : (data.hosting_plan_id || null);

    const hostingFinalPrice = calculateDiscount(hostingPrice, hostingDiscountType, hostingDiscountValue);

    // Calculate maintenance
    const maintenanceFinalPrice = calculateDiscount(
      data.maintenance_price,
      data.maintenance_discount_type || null,
      data.maintenance_discount_value ?? null
    );

    const monthlyTotal = (hostingFinalPrice || 0) + (maintenanceFinalPrice || 0);

    const item = await prisma.accordKeepItem.create({
      data: {
        accord_id: id,
        site_id: data.site_id || null,
        site_name_placeholder: data.site_name_placeholder || null,
        domain_name: data.domain_name || null,
        hosting_plan_id: hostingPlanId,
        maintenance_plan_id: data.maintenance_plan_id,
        hosting_price: hostingPrice,
        hosting_discount_type: hostingDiscountType,
        hosting_discount_value: hostingDiscountValue,
        hosting_final_price: hostingFinalPrice,
        maintenance_price: data.maintenance_price,
        maintenance_discount_type: data.maintenance_discount_type || null,
        maintenance_discount_value: data.maintenance_discount_value ?? null,
        maintenance_final_price: maintenanceFinalPrice,
        monthly_total: monthlyTotal,
        is_client_hosted: isClientHosted,
        contract_language_override: data.contract_language_override || null,
        sort_order: data.sort_order ?? 0,
      },
      include: {
        site: { select: { id: true, name: true, url: true } },
        hosting_plan: { select: { id: true, name: true, rate: true } },
        maintenance_plan: { select: { id: true, name: true, rate: true } },
      },
    });

    return NextResponse.json(formatAccordKeepItemResponse(item), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
