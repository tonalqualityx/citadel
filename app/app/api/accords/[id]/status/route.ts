import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAccordResponse } from '@/lib/api/formatters';

const VALID_TRANSITIONS: Record<string, string[]> = {
  lead: ['meeting', 'lost'],
  meeting: ['proposal', 'lost'],
  proposal: ['contract', 'lost'],
  contract: ['signed', 'lost'],
  signed: ['active', 'lost'],
  active: [],
  lost: ['lead'],
};

const updateStatusSchema = z.object({
  status: z.enum(['lead', 'meeting', 'proposal', 'contract', 'signed', 'active', 'lost']),
  rejection_reason: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateStatusSchema.parse(body);

    // Get current accord
    const current = await prisma.accord.findUnique({
      where: { id, is_deleted: false },
    });

    if (!current) {
      throw new ApiError('Accord not found', 404);
    }

    // Validate status transition
    const allowedTransitions = VALID_TRANSITIONS[current.status] || [];
    if (!allowedTransitions.includes(data.status)) {
      throw new ApiError(
        `Invalid status transition from '${current.status}' to '${data.status}'`,
        400
      );
    }

    // Build update data
    const updateData: any = {
      status: data.status,
      entered_current_status_at: new Date(),
    };

    if (data.status === 'lost') {
      updateData.lost_at = new Date();
      if (data.rejection_reason) {
        updateData.rejection_reason = data.rejection_reason;
      }
    }

    if (data.status === 'signed') {
      updateData.signed_at = new Date();
    }

    // Reopening from lost
    if (current.status === 'lost' && data.status === 'lead') {
      updateData.lost_at = null;
      updateData.rejection_reason = null;
    }

    const accord = await prisma.accord.update({
      where: { id },
      data: updateData,
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        owner: {
          select: { id: true, name: true, email: true, avatar_url: true },
        },
        charter_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
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
