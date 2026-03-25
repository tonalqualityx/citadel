import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterScheduledTaskResponse } from '@/lib/api/formatters';

const createScheduledTaskSchema = z.object({
  sop_id: z.string().uuid(),
  charter_ware_id: z.string().uuid().optional(),
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'semi_annually', 'annually']),
  sort_order: z.number().optional(),
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
    const data = createScheduledTaskSchema.parse(body);

    const scheduledTask = await prisma.charterScheduledTask.create({
      data: {
        charter_id: id,
        sop_id: data.sop_id,
        charter_ware_id: data.charter_ware_id,
        cadence: data.cadence,
        sort_order: data.sort_order ?? 0,
      },
      include: {
        sop: { select: { id: true, title: true } },
      },
    });

    return NextResponse.json(formatCharterScheduledTaskResponse(scheduledTask), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
