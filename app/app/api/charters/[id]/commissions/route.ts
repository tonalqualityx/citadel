import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterCommissionResponse } from '@/lib/api/formatters';

const createCharterCommissionSchema = z.object({
  commission_id: z.string().uuid(),
  allocated_hours_per_period: z.number().min(0).optional(),
  start_period: z.string().min(1),
  end_period: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const charter = await prisma.charter.findFirst({
      where: { id, is_deleted: false },
    });

    if (!charter) {
      throw new ApiError('Charter not found', 404);
    }

    const body = await request.json();
    const data = createCharterCommissionSchema.parse(body);

    const charterCommission = await prisma.charterCommission.create({
      data: {
        charter_id: id,
        commission_id: data.commission_id,
        allocated_hours_per_period: data.allocated_hours_per_period,
        start_period: data.start_period,
        end_period: data.end_period,
      },
      include: {
        commission: { select: { id: true, name: true, status: true } },
      },
    });

    return NextResponse.json(formatCharterCommissionResponse(charterCommission), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
