import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAccordResponse } from '@/lib/api/formatters';

const updateAccordSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  client_id: z.string().uuid().optional().nullable(),
  owner_id: z.string().uuid().optional(),
  lead_name: z.string().max(255).optional().nullable(),
  lead_business_name: z.string().max(255).optional().nullable(),
  lead_email: z.string().email().optional().nullable().or(z.literal('')),
  lead_phone: z.string().max(50).optional().nullable(),
  lead_notes: z.string().optional().nullable(),
  rejection_reason: z.string().optional().nullable(),
  payment_confirmed: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const accord = await prisma.accord.findUnique({
      where: { id, is_deleted: false },
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        owner: {
          select: { id: true, name: true, email: true, avatar_url: true },
        },
        charter_items: {
          where: { is_deleted: false },
          include: {
            ware: { select: { id: true, name: true, type: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
        commission_items: {
          where: { is_deleted: false },
          include: {
            ware: { select: { id: true, name: true, type: true } },
            project: { select: { id: true, name: true, budget_amount: true } },
          },
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

    if (!accord) {
      throw new ApiError('Accord not found', 404);
    }

    return NextResponse.json(formatAccordResponse(accord));
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
    const data = updateAccordSchema.parse(body);

    const accord = await prisma.accord.update({
      where: { id },
      data: {
        ...data,
        lead_email: data.lead_email === '' ? null : data.lead_email,
      },
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        owner: {
          select: { id: true, name: true, email: true, avatar_url: true },
        },
        charter_items: {
          where: { is_deleted: false },
          include: {
            ware: { select: { id: true, name: true, type: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
        commission_items: {
          where: { is_deleted: false },
          include: {
            ware: { select: { id: true, name: true, type: true } },
            project: { select: { id: true, name: true, budget_amount: true } },
          },
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

    return NextResponse.json(formatAccordResponse(accord));
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
    await prisma.accord.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
