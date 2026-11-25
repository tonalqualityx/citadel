import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatInitiativeNumberResponse } from '@/lib/api/formatters';
import { assertNumberRoom, numberCreateSchema, recomputeHealth, toDate } from '@/lib/initiatives/service';

// POST /api/initiatives/[id]/numbers - add a number (at most three per initiative)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const n = numberCreateSchema.parse(await request.json());

    const initiative = await prisma.initiative.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, _count: { select: { numbers: true } } },
    });
    if (!initiative) throw new ApiError('Initiative not found', 404);
    assertNumberRoom(initiative._count.numbers, 1);

    const now = new Date();
    const created = await prisma.initiativeNumber.create({
      data: {
        initiative_id: id,
        label: n.label,
        unit: n.unit,
        direction: n.direction,
        baseline_value: n.baseline_value,
        baseline_at: n.baseline_value !== undefined && n.baseline_value !== null ? (toDate(n.baseline_at) ?? now) : toDate(n.baseline_at),
        target_value: n.target_value,
        target_by: new Date(n.target_by),
        source: n.source,
        position: n.position ?? initiative._count.numbers,
      },
    });
    await recomputeHealth(id);
    return NextResponse.json(formatInitiativeNumberResponse(created), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
