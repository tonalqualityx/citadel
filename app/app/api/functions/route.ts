import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const createFunctionSchema = z.object({
  name: z.string().min(1).max(100),
  primary_focus: z.string().optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

function formatFunction(fn: any) {
  return {
    id: fn.id,
    name: fn.name,
    primary_focus: fn.primary_focus,
    sort_order: fn.sort_order,
    is_active: fn.is_active,
    created_at: fn.created_at,
    updated_at: fn.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('include_inactive') === 'true';

    const where = includeInactive ? {} : { is_active: true };

    const functions = await prisma.function.findMany({
      where,
      orderBy: { sort_order: 'asc' },
    });

    return NextResponse.json({
      functions: functions.map(formatFunction),
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
    const data = createFunctionSchema.parse(body);

    // Get max sort_order if not provided
    let sortOrder = data.sort_order;
    if (sortOrder === undefined) {
      const maxOrder = await prisma.function.aggregate({
        _max: { sort_order: true },
      });
      sortOrder = (maxOrder._max.sort_order ?? 0) + 1;
    }

    const fn = await prisma.function.create({
      data: {
        name: data.name,
        primary_focus: data.primary_focus,
        sort_order: sortOrder,
        is_active: data.is_active ?? true,
      },
    });

    return NextResponse.json(formatFunction(fn), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
