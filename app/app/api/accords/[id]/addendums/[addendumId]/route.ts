import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAddendumResponse } from '@/lib/api/formatters';

const updateAddendumSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  contract_content: z.string().min(1).optional(),
  changes: z.record(z.string(), z.unknown()).optional(),
  pricing_snapshot: z.record(z.string(), z.unknown()).optional(),
  is_override: z.boolean().optional(),
  override_reason: z.string().optional().nullable(),
});

// GET /api/accords/:id/addendums/:addendumId - Get single addendum
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addendumId: string }> }
) {
  try {
    await requireAuth();
    const { id, addendumId } = await params;

    const addendum = await prisma.addendum.findFirst({
      where: {
        id: addendumId,
        accord_id: id,
        is_deleted: false,
      },
      include: {
        created_by: {
          select: { id: true, name: true, email: true },
        },
        overridden_by: {
          select: { id: true, name: true },
        },
        charter_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        commission_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        keep_items: {
          where: { is_deleted: false },
          include: {
            site: { select: { id: true, name: true, url: true } },
            hosting_plan: { select: { id: true, name: true, rate: true } },
            maintenance_plan: { select: { id: true, name: true, rate: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    if (!addendum) {
      throw new ApiError('Addendum not found', 404);
    }

    return NextResponse.json(formatAddendumResponse(addendum));
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/accords/:id/addendums/:addendumId - Update draft addendum
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addendumId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, addendumId } = await params;

    const existing = await prisma.addendum.findFirst({
      where: {
        id: addendumId,
        accord_id: id,
        is_deleted: false,
      },
    });

    if (!existing) {
      throw new ApiError('Addendum not found', 404);
    }

    if (existing.status !== 'draft') {
      throw new ApiError('Only draft addendums can be updated', 400);
    }

    const body = await request.json();
    const data = updateAddendumSchema.parse(body);

    const updateData: any = { ...data };
    if (data.changes !== undefined) updateData.changes = data.changes as any;
    if (data.pricing_snapshot !== undefined) updateData.pricing_snapshot = data.pricing_snapshot as any;

    const addendum = await prisma.addendum.update({
      where: { id: addendumId },
      data: updateData,
      include: {
        created_by: {
          select: { id: true, name: true, email: true },
        },
        overridden_by: {
          select: { id: true, name: true },
        },
        charter_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        commission_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        keep_items: {
          where: { is_deleted: false },
          include: {
            site: { select: { id: true, name: true, url: true } },
            hosting_plan: { select: { id: true, name: true, rate: true } },
            maintenance_plan: { select: { id: true, name: true, rate: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    return NextResponse.json(formatAddendumResponse(addendum));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/accords/:id/addendums/:addendumId - Soft delete addendum
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addendumId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id, addendumId } = await params;

    const existing = await prisma.addendum.findFirst({
      where: {
        id: addendumId,
        accord_id: id,
        is_deleted: false,
      },
    });

    if (!existing) {
      throw new ApiError('Addendum not found', 404);
    }

    if (existing.status !== 'draft') {
      throw new ApiError('Only draft addendums can be deleted', 400);
    }

    await prisma.addendum.update({
      where: { id: addendumId },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
