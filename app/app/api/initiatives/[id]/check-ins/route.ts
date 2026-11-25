import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatInitiativeCheckInResponse, formatInitiativeResponse } from '@/lib/api/formatters';
import { checkInSchema, recomputeHealth } from '@/lib/initiatives/service';

// POST /api/initiatives/[id]/check-ins - Mike's read on the initiative, one line
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const data = checkInSchema.parse(await request.json());

    const initiative = await prisma.initiative.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, check_every_days: true },
    });
    if (!initiative) throw new ApiError('Initiative not found', 404);

    const checkIn = await prisma.initiativeCheckIn.create({
      data: { initiative_id: id, health: data.health, note: data.note ?? null, author_id: auth.userId },
    });

    // A cadence rolls the next check date forward from the day of the check-in.
    if (initiative.check_every_days) {
      const next = new Date();
      next.setUTCHours(0, 0, 0, 0);
      next.setUTCDate(next.getUTCDate() + initiative.check_every_days);
      await prisma.initiative.update({ where: { id }, data: { check_date: next } });
    }

    const updated = await recomputeHealth(id);
    return NextResponse.json(
      { check_in: formatInitiativeCheckInResponse(checkIn), initiative: formatInitiativeResponse(updated) },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
