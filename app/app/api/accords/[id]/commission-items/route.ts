import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAccordCommissionItemResponse } from '@/lib/api/formatters';

const createCommissionItemSchema = z.object({
  ware_id: z.string().uuid(),
  name_override: z.string().max(255).optional(),
  estimated_price: z.number().min(0).optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  discount_type: z.enum(['percent', 'flat']).optional().nullable(),
  discount_value: z.number().min(0).optional().nullable(),
  contract_language_override: z.string().optional().nullable(),
  sort_order: z.number().int().optional(),
});

function calculateCommissionFinalPrice(
  basePrice: number | null,
  discountType: string | null,
  discountValue: number | null
): number | null {
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

    const items = await prisma.accordCommissionItem.findMany({
      where: { accord_id: id, is_deleted: false },
      include: {
        ware: { select: { id: true, name: true, type: true } },
        project: { select: { id: true, name: true, budget_amount: true } },
      },
      orderBy: { sort_order: 'asc' },
    });

    return NextResponse.json(items.map(formatAccordCommissionItemResponse));
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
    const data = createCommissionItemSchema.parse(body);

    // Validate accord exists
    const accord = await prisma.accord.findUnique({
      where: { id, is_deleted: false },
    });
    if (!accord) throw new ApiError('Accord not found', 404);

    // Validate ware exists and is commission type
    const ware = await prisma.ware.findUnique({
      where: { id: data.ware_id, is_deleted: false },
    });
    if (!ware) throw new ApiError('Ware not found', 404);
    if (ware.type !== 'commission') throw new ApiError('Ware must be commission type', 400);

    // If project linked, get budget for pricing
    let basePrice = data.estimated_price ?? null;
    if (data.project_id) {
      const project = await prisma.project.findUnique({
        where: { id: data.project_id },
        select: { budget_amount: true },
      });
      if (project?.budget_amount) {
        basePrice = Number(project.budget_amount);
      }
    }

    const finalPrice = calculateCommissionFinalPrice(
      basePrice, data.discount_type || null, data.discount_value ?? null
    );

    const item = await prisma.accordCommissionItem.create({
      data: {
        accord_id: id,
        ware_id: data.ware_id,
        name_override: data.name_override || null,
        estimated_price: data.estimated_price ?? null,
        project_id: data.project_id || null,
        discount_type: data.discount_type || null,
        discount_value: data.discount_value ?? null,
        final_price: finalPrice,
        contract_language_override: data.contract_language_override || null,
        sort_order: data.sort_order ?? 0,
      },
      include: {
        ware: { select: { id: true, name: true, type: true } },
        project: { select: { id: true, name: true, budget_amount: true } },
      },
    });

    return NextResponse.json(formatAccordCommissionItemResponse(item), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
