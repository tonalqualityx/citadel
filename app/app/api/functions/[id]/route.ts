import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateFunctionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const fn = await prisma.function.findUnique({
      where: { id },
    });

    if (!fn) {
      throw new ApiError('Function not found', 404);
    }

    return NextResponse.json(formatFunction(fn));
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
    requireRole(auth, ['admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateFunctionSchema.parse(body);

    const fn = await prisma.function.update({
      where: { id },
      data,
    });

    return NextResponse.json(formatFunction(fn));
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

    await prisma.function.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
