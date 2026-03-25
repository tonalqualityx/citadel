import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatAccordCommissionItemResponse } from '@/lib/api/formatters';

const updateCommissionItemSchema = z.object({
  name_override: z.string().max(255).optional().nullable(),
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, itemId } = await params;

    const body = await request.json();
    const data = updateCommissionItemSchema.parse(body);

    // Get current item
    const current = await prisma.accordCommissionItem.findUnique({
      where: { id: itemId },
      include: { project: { select: { budget_amount: true } } },
    });
    if (!current) {
      return NextResponse.json({ error: 'Commission item not found' }, { status: 404 });
    }

    // Determine base price for final_price calculation
    let basePrice: number | null = null;

    // If project is being changed, fetch new project's budget
    if (data.project_id !== undefined) {
      if (data.project_id) {
        const project = await prisma.project.findUnique({
          where: { id: data.project_id },
          select: { budget_amount: true },
        });
        if (project?.budget_amount) {
          basePrice = Number(project.budget_amount);
        }
      }
      // If project_id is null, fall back to estimated_price
      if (basePrice === null) {
        basePrice = data.estimated_price !== undefined
          ? data.estimated_price
          : (current.estimated_price ? Number(current.estimated_price) : null);
      }
    } else {
      // No project change — use existing project budget or estimated price
      if (current.project_id && current.project?.budget_amount) {
        basePrice = Number(current.project.budget_amount);
      } else {
        basePrice = data.estimated_price !== undefined
          ? data.estimated_price
          : (current.estimated_price ? Number(current.estimated_price) : null);
      }
    }

    const discountType = data.discount_type !== undefined ? data.discount_type : current.discount_type;
    const discountValue = data.discount_value !== undefined ? data.discount_value : (current.discount_value ? Number(current.discount_value) : null);

    const finalPrice = calculateCommissionFinalPrice(basePrice, discountType, discountValue);

    const item = await prisma.accordCommissionItem.update({
      where: { id: itemId },
      data: {
        ...data,
        final_price: finalPrice,
      },
      include: {
        ware: { select: { id: true, name: true, type: true } },
        project: { select: { id: true, name: true, budget_amount: true } },
      },
    });

    return NextResponse.json(formatAccordCommissionItemResponse(item));
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

    await prisma.accordCommissionItem.update({
      where: { id: itemId },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
