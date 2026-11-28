import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatRecurringWorkResponse } from '@/lib/api/formatters';
import { RECURRING_WORK_INCLUDE } from '@/lib/recurring-work/service';
import { applyRecurringPick, RECURRING_PICKS } from '@/lib/recurring-work/pick';

type Ctx = { params: Promise<{ id: string }> };

const pickSchema = z.object({ pick: z.enum(RECURRING_PICKS) }).strict();

// POST /api/recurring-work/[id]/pick - Keep records the pick; Cut and Make weekly also file one card for Bast.
// Never changes the schedule.
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const { pick } = pickSchema.parse(await request.json());
    const result = await applyRecurringPick({ id, pick, userId: auth.userId });
    const row = await prisma.recurringWork.findUnique({ where: { id }, include: RECURRING_WORK_INCLUDE });
    if (!row) throw new ApiError('Recurring work not found', 404);
    return NextResponse.json({ ...result, recurring_work: formatRecurringWorkResponse(row) }, { status: result.filed ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
