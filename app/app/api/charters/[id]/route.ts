import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterResponse } from '@/lib/api/formatters';

const updateCharterSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  client_id: z.string().uuid().optional(),
  accord_id: z.string().uuid().optional().nullable(),
  billing_period: z.enum(['monthly', 'annually']).optional(),
  budget_hours: z.number().min(0).optional().nullable(),
  hourly_rate: z.number().min(0).optional().nullable(),
  budget_amount: z.number().min(0).optional().nullable(),
  start_date: z.string().optional(),
  end_date: z.string().optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const charter = await prisma.charter.findUnique({
      where: { id, is_deleted: false },
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        accord: {
          select: { id: true, name: true, status: true },
        },
        created_by: {
          select: { id: true, name: true },
        },
        charter_wares: {
          include: {
            ware: true,
            scheduled_tasks: {
              include: {
                sop: true,
              },
            },
          },
        },
        scheduled_tasks: {
          include: {
            sop: true,
          },
        },
        charter_commissions: {
          include: {
            commission: {
              select: { id: true, name: true, status: true },
            },
          },
        },
        _count: {
          select: { tasks: true },
        },
      },
    });

    if (!charter) {
      throw new ApiError('Charter not found', 404);
    }

    return NextResponse.json(formatCharterResponse(charter));
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
    const data = updateCharterSchema.parse(body);

    const charter = await prisma.charter.update({
      where: { id },
      data,
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        accord: {
          select: { id: true, name: true, status: true },
        },
        created_by: {
          select: { id: true, name: true },
        },
        charter_wares: {
          include: {
            ware: true,
            scheduled_tasks: {
              include: {
                sop: true,
              },
            },
          },
        },
        scheduled_tasks: {
          include: {
            sop: true,
          },
        },
        charter_commissions: {
          include: {
            commission: {
              select: { id: true, name: true, status: true },
            },
          },
        },
        _count: { select: { tasks: true } },
      },
    });

    return NextResponse.json(formatCharterResponse(charter));
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
    await prisma.charter.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
