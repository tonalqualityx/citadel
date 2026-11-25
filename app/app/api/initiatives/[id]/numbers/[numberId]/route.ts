import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatInitiativeNumberResponse } from '@/lib/api/formatters';
import { numberUpdateSchema, recomputeHealth, toDate } from '@/lib/initiatives/service';

type Ctx = { params: Promise<{ id: string; numberId: string }> };

async function findNumber(id: string, numberId: string) {
  const found = await prisma.initiativeNumber.findFirst({
    where: { id: numberId, initiative_id: id, initiative: { is_deleted: false } },
    include: { initiative: { select: { status: true } } },
  });
  if (!found) throw new ApiError('Number not found', 404);
  return found;
}

// PATCH /api/initiatives/[id]/numbers/[numberId]
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, numberId } = await params;
    const data = numberUpdateSchema.parse(await request.json());
    await findNumber(id, numberId);

    const updateData: Record<string, unknown> = {};
    for (const key of ['label', 'unit', 'direction', 'baseline_value', 'target_value', 'source', 'position'] as const) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (data.baseline_at !== undefined) updateData.baseline_at = toDate(data.baseline_at);
    if (data.target_by !== undefined) updateData.target_by = new Date(data.target_by);

    const updated = await prisma.initiativeNumber.update({ where: { id: numberId }, data: updateData });
    await recomputeHealth(id);
    return NextResponse.json(formatInitiativeNumberResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/initiatives/[id]/numbers/[numberId] - past proposed, an initiative keeps at least one number
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, numberId } = await params;
    const found = await findNumber(id, numberId);
    if (found.initiative.status !== 'proposed') {
      const count = await prisma.initiativeNumber.count({ where: { initiative_id: id } });
      if (count <= 1) {
        throw new ApiError('An initiative needs at least one number once it is past proposed', 422, 'number_required');
      }
    }
    await prisma.initiativeNumber.delete({ where: { id: numberId } });
    await recomputeHealth(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
