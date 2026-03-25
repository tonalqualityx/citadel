import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatAccordKeepItemResponse } from '@/lib/api/formatters';

const updateKeepItemSchema = z.object({
  site_id: z.string().uuid().optional().nullable(),
  site_name_placeholder: z.string().max(255).optional().nullable(),
  domain_name: z.string().max(255).optional().nullable(),
  hosting_plan_id: z.string().uuid().optional().nullable(),
  maintenance_plan_id: z.string().uuid().optional(),
  hosting_price: z.number().min(0).optional().nullable(),
  hosting_discount_type: z.enum(['percent', 'flat']).optional().nullable(),
  hosting_discount_value: z.number().min(0).optional().nullable(),
  maintenance_price: z.number().min(0).optional(),
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, itemId } = await params;

    const body = await request.json();
    const data = updateKeepItemSchema.parse(body);

    // Get current item
    const current = await prisma.accordKeepItem.findUnique({
      where: { id: itemId },
    });
    if (!current) {
      return NextResponse.json({ error: 'Keep item not found' }, { status: 404 });
    }

    const isClientHosted = data.is_client_hosted ?? current.is_client_hosted;

    // Hosting calculations
    let hostingPrice: number | null;
    let hostingDiscountType: string | null;
    let hostingDiscountValue: number | null;
    let hostingPlanId: string | null;

    if (isClientHosted) {
      hostingPrice = null;
      hostingDiscountType = null;
      hostingDiscountValue = null;
      hostingPlanId = null;
    } else {
      hostingPrice = data.hosting_price !== undefined ? data.hosting_price : (current.hosting_price ? Number(current.hosting_price) : null);
      hostingDiscountType = data.hosting_discount_type !== undefined ? data.hosting_discount_type : current.hosting_discount_type;
      hostingDiscountValue = data.hosting_discount_value !== undefined ? data.hosting_discount_value : (current.hosting_discount_value ? Number(current.hosting_discount_value) : null);
      hostingPlanId = data.hosting_plan_id !== undefined ? data.hosting_plan_id : current.hosting_plan_id;
    }

    const hostingFinalPrice = calculateDiscount(hostingPrice, hostingDiscountType, hostingDiscountValue);

    // Maintenance calculations
    const maintenancePrice = data.maintenance_price ?? (current.maintenance_price ? Number(current.maintenance_price) : 0);
    const maintenanceDiscountType = data.maintenance_discount_type !== undefined ? data.maintenance_discount_type : current.maintenance_discount_type;
    const maintenanceDiscountValue = data.maintenance_discount_value !== undefined ? data.maintenance_discount_value : (current.maintenance_discount_value ? Number(current.maintenance_discount_value) : null);
    const maintenanceFinalPrice = calculateDiscount(maintenancePrice, maintenanceDiscountType, maintenanceDiscountValue);

    const monthlyTotal = (hostingFinalPrice || 0) + (maintenanceFinalPrice || 0);

    const item = await prisma.accordKeepItem.update({
      where: { id: itemId },
      data: {
        ...data,
        hosting_plan_id: hostingPlanId,
        hosting_price: hostingPrice,
        hosting_discount_type: hostingDiscountType,
        hosting_discount_value: hostingDiscountValue,
        hosting_final_price: hostingFinalPrice,
        maintenance_price: maintenancePrice,
        maintenance_discount_type: maintenanceDiscountType,
        maintenance_discount_value: maintenanceDiscountValue,
        maintenance_final_price: maintenanceFinalPrice,
        monthly_total: monthlyTotal,
        is_client_hosted: isClientHosted,
      },
      include: {
        site: { select: { id: true, name: true, url: true } },
        hosting_plan: { select: { id: true, name: true, rate: true } },
        maintenance_plan: { select: { id: true, name: true, rate: true } },
      },
    });

    return NextResponse.json(formatAccordKeepItemResponse(item));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, itemId } = await params;

    await prisma.accordKeepItem.update({
      where: { id: itemId },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
