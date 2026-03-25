import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAccordCharterItemResponse } from '@/lib/api/formatters';

const createCharterItemSchema = z.object({
  ware_id: z.string().uuid(),
  name_override: z.string().max(255).optional(),
  price_tier: z.string().max(100).optional(),
  base_price: z.number().min(0),
  discount_type: z.enum(['percent', 'flat']).optional().nullable(),
  discount_value: z.number().min(0).optional().nullable(),
  billing_period: z.enum(['monthly', 'annually']),
  duration_months: z.number().int().min(1),
  contract_language_override: z.string().optional().nullable(),
  sort_order: z.number().int().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const items = await prisma.accordCharterItem.findMany({
      where: { accord_id: id, is_deleted: false },
      include: {
        ware: { select: { id: true, name: true, type: true } },
      },
      orderBy: { sort_order: 'asc' },
    });

    return NextResponse.json(items.map(formatAccordCharterItemResponse));
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
    const data = createCharterItemSchema.parse(body);

    // Validate accord exists
    const accord = await prisma.accord.findUnique({
      where: { id, is_deleted: false },
    });
    if (!accord) throw new ApiError('Accord not found', 404);

    // Validate ware exists and is charter type
    const ware = await prisma.ware.findUnique({
      where: { id: data.ware_id, is_deleted: false },
    });
    if (!ware) throw new ApiError('Ware not found', 404);
    if (ware.type !== 'charter') throw new ApiError('Ware must be charter type', 400);

    // Calculate final_price and total_contract_value
    let finalPrice = data.base_price;
    if (data.discount_type === 'percent' && data.discount_value) {
      finalPrice = data.base_price * (1 - data.discount_value / 100);
    } else if (data.discount_type === 'flat' && data.discount_value) {
      finalPrice = data.base_price - data.discount_value;
    }
    finalPrice = Math.max(0, finalPrice);

    let totalContractValue: number;
    if (data.billing_period === 'monthly') {
      totalContractValue = finalPrice * data.duration_months;
    } else {
      totalContractValue = finalPrice * (data.duration_months / 12);
    }

    const item = await prisma.accordCharterItem.create({
      data: {
        accord_id: id,
        ware_id: data.ware_id,
        name_override: data.name_override || null,
        price_tier: data.price_tier || null,
        base_price: data.base_price,
        discount_type: data.discount_type || null,
        discount_value: data.discount_value ?? null,
        final_price: finalPrice,
        billing_period: data.billing_period,
        duration_months: data.duration_months,
        total_contract_value: totalContractValue,
        contract_language_override: data.contract_language_override || null,
        sort_order: data.sort_order ?? 0,
      },
      include: {
        ware: { select: { id: true, name: true, type: true } },
      },
    });

    return NextResponse.json(formatAccordCharterItemResponse(item), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
