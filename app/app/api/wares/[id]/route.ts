import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatWareResponse } from '@/lib/api/formatters';

const updateWareSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(['commission', 'charter']).optional(),
  description: z.string().optional().nullable(),
  charter_billing_period: z.enum(['monthly', 'annually']).optional().nullable(),
  base_price: z.number().min(0).optional().nullable(),
  price_tiers: z.any().optional(),
  contract_language: z.string().optional().nullable(),
  default_schedule: z.any().optional(),
  recipe_id: z.string().uuid().optional().nullable(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const ware = await prisma.ware.findUnique({
      where: { id, is_deleted: false },
      include: {
        recipe: {
          select: { id: true, name: true },
        },
        _count: {
          select: { accord_charter_items: true, accord_commission_items: true },
        },
      },
    });

    if (!ware) {
      throw new ApiError('Ware not found', 404);
    }

    return NextResponse.json(formatWareResponse(ware));
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
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateWareSchema.parse(body);

    const ware = await prisma.ware.update({
      where: { id },
      data,
      include: {
        recipe: {
          select: { id: true, name: true },
        },
        _count: { select: { accord_charter_items: true, accord_commission_items: true } },
      },
    });

    return NextResponse.json(formatWareResponse(ware));
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

    // Soft delete
    await prisma.ware.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
