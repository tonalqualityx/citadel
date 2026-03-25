import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatWareResponse } from '@/lib/api/formatters';

const createWareSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['commission', 'charter']),
  description: z.string().optional(),
  charter_billing_period: z.enum(['monthly', 'annually']).optional(),
  base_price: z.number().min(0).optional(),
  price_tiers: z.any().optional(),
  contract_language: z.string().optional(),
  default_schedule: z.any().optional(),
  recipe_id: z.string().uuid().optional(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const type = searchParams.get('type') as 'commission' | 'charter' | null;
    const isActiveParam = searchParams.get('is_active');
    const isActive = isActiveParam !== null ? isActiveParam === 'true' : undefined;

    const where = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(type && { type }),
      ...(isActive !== undefined && { is_active: isActive }),
    };

    const [wares, total] = await Promise.all([
      prisma.ware.findMany({
        where,
        include: {
          recipe: {
            select: { id: true, name: true },
          },
          _count: {
            select: { accord_charter_items: true, accord_commission_items: true },
          },
        },
        orderBy: { sort_order: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ware.count({ where }),
    ]);

    return NextResponse.json({
      wares: wares.map(formatWareResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createWareSchema.parse(body);

    const ware = await prisma.ware.create({
      data,
      include: {
        recipe: {
          select: { id: true, name: true },
        },
        _count: { select: { accord_charter_items: true, accord_commission_items: true } },
      },
    });

    return NextResponse.json(formatWareResponse(ware), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
