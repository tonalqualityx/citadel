import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatInitiativeResponse } from '@/lib/api/formatters';
import {
  INITIATIVE_INCLUDE,
  assertCanActivate,
  assertHasNumber,
  initiativeUpdateSchema,
  recomputeHealth,
  toDate,
  withFreshHealth,
} from '@/lib/initiatives/service';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/initiatives/[id]
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    await requireAuth();
    const { id } = await params;
    const initiative = await prisma.initiative.findFirst({ where: { id, is_deleted: false }, include: INITIATIVE_INCLUDE });
    if (!initiative) throw new ApiError('Initiative not found', 404);
    return NextResponse.json(formatInitiativeResponse(await withFreshHealth(initiative)));
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/initiatives/[id] - any field, including status
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const data = initiativeUpdateSchema.parse(await request.json());

    const existing = await prisma.initiative.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, status: true, bet: true, activated_at: true, _count: { select: { numbers: true } } },
    });
    if (!existing) throw new ApiError('Initiative not found', 404);

    if (data.owner_id && data.owner_id !== auth.userId) {
      const owner = await prisma.user.findUnique({ where: { id: data.owner_id }, select: { id: true } });
      if (!owner) throw new ApiError('Owner not found', 404);
    }
    if (data.client_id) {
      const client = await prisma.client.findUnique({ where: { id: data.client_id, is_deleted: false }, select: { id: true } });
      if (!client) throw new ApiError('Client not found', 404);
    }

    const updateData: Record<string, unknown> = {};
    const plain = [
      'name', 'bet', 'nightmare', 'prevention', 'repair', 'cost_of_waiting', 'stop_condition', 'check_every_days',
      'next_decision', 'health_reason', 'owner_id', 'client_id', 'sort_order', 'closed_reason',
    ] as const;
    for (const key of plain) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    if (data.check_date !== undefined) updateData.check_date = toDate(data.check_date);

    // A bet cannot be emptied on an active initiative.
    const finalStatus = data.status ?? existing.status;
    const finalBet = data.bet !== undefined ? data.bet : existing.bet;
    const enteringActive = data.status === 'active' && existing.status !== 'active';
    if (enteringActive || (finalStatus === 'active' && data.bet !== undefined)) {
      await assertCanActivate({ bet: finalBet, numberCount: existing._count.numbers, selfId: id });
    }
    if (data.status !== undefined && data.status !== existing.status) assertHasNumber(data.status, existing._count.numbers);

    if (data.status !== undefined && data.status !== existing.status) {
      const now = new Date();
      updateData.status = data.status;
      if (data.status === 'active') updateData.activated_at = now;
      if (data.status === 'done' || data.status === 'stopped') updateData.closed_at = now;
      else updateData.closed_at = null;
    }

    await prisma.initiative.update({ where: { id }, data: updateData });
    const updated = data.check_date !== undefined
      ? await recomputeHealth(id)
      : await prisma.initiative.findUnique({ where: { id }, include: INITIATIVE_INCLUDE });
    if (!updated) throw new ApiError('Initiative not found', 404);
    return NextResponse.json(formatInitiativeResponse(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/initiatives/[id] - soft delete. Linked projects and tasks keep their rows; the link is simply hidden with it.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const existing = await prisma.initiative.findFirst({ where: { id, is_deleted: false }, select: { id: true } });
    if (!existing) throw new ApiError('Initiative not found', 404);
    await prisma.initiative.update({ where: { id }, data: { is_deleted: true } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
