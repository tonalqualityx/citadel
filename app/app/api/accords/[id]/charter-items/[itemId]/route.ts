import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatAccordCharterItemResponse } from '@/lib/api/formatters';

const updateCharterItemSchema = z.object({
  name_override: z.string().max(255).optional().nullable(),
  price_tier: z.string().max(100).optional().nullable(),
  base_price: z.number().min(0).optional(),
  discount_type: z.enum(['percent', 'flat']).optional().nullable(),
  discount_value: z.number().min(0).optional().nullable(),
  billing_period: z.enum(['monthly', 'annually']).optional(),
  duration_months: z.number().int().min(1).optional(),
  contract_language_override: z.string().optional().nullable(),
  sort_order: z.number().int().optional(),
});

function calculateCharterPricing(basePrice: number, discountType: string | null, discountValue: number | null, billingPeriod: string, durationMonths: number) {
  let finalPrice = basePrice;
  if (discountType === 'percent' && discountValue) {
    finalPrice = basePrice * (1 - discountValue / 100);
  } else if (discountType === 'flat' && discountValue) {
    finalPrice = basePrice - discountValue;
  }
  finalPrice = Math.max(0, finalPrice);

  let totalContractValue: number;
  if (billingPeriod === 'monthly') {
    totalContractValue = finalPrice * durationMonths;
  } else {
    totalContractValue = finalPrice * (durationMonths / 12);
  }

  return { finalPrice, totalContractValue };
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
    const data = updateCharterItemSchema.parse(body);

    // Get current item to merge values for recalculation
    const current = await prisma.accordCharterItem.findUnique({
      where: { id: itemId },
    });
    if (!current) {
      return NextResponse.json({ error: 'Charter item not found' }, { status: 404 });
    }

    const basePrice = data.base_price ?? Number(current.base_price);
    const discountType = data.discount_type !== undefined ? data.discount_type : current.discount_type;
    const discountValue = data.discount_value !== undefined ? data.discount_value : (current.discount_value ? Number(current.discount_value) : null);
    const billingPeriod = data.billing_period ?? current.billing_period;
    const durationMonths = data.duration_months ?? current.duration_months;

    const { finalPrice, totalContractValue } = calculateCharterPricing(
      basePrice, discountType, discountValue, billingPeriod, durationMonths
    );

    const item = await prisma.accordCharterItem.update({
      where: { id: itemId },
      data: {
        ...data,
        final_price: finalPrice,
        total_contract_value: totalContractValue,
      },
      include: {
        ware: { select: { id: true, name: true, type: true } },
      },
    });

    return NextResponse.json(formatAccordCharterItemResponse(item));
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

    await prisma.accordCharterItem.update({
      where: { id: itemId },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
