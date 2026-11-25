import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatInitiativeResponse } from '@/lib/api/formatters';
import {
  INITIATIVE_INCLUDE,
  STATUS_VALUES,
  assertCanActivate,
  assertHasNumber,
  assertNumberRoom,
  defaultOwnerId,
  initiativeCreateSchema,
  recomputeHealth,
  toDate,
  withFreshHealth,
} from '@/lib/initiatives/service';

// GET /api/initiatives - list (optional ?status=), newest sort order first
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const status = new URL(request.url).searchParams.get('status');
    if (status && !(STATUS_VALUES as readonly string[]).includes(status)) {
      throw new ApiError(`status must be one of ${STATUS_VALUES.join(', ')}`, 400);
    }
    const initiatives = await prisma.initiative.findMany({
      where: { is_deleted: false, ...(status ? { status: status as (typeof STATUS_VALUES)[number] } : {}) },
      include: INITIATIVE_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });
    const now = new Date();
    const fresh = await Promise.all(initiatives.map((i) => withFreshHealth(i, now)));
    return NextResponse.json({ initiatives: fresh.map(formatInitiativeResponse), total: fresh.length });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/initiatives - create, with 0 to 3 numbers
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const data = initiativeCreateSchema.parse(await request.json());
    const numbers = data.numbers ?? [];
    assertNumberRoom(0, numbers.length);

    const ownerId = data.owner_id ?? (await defaultOwnerId(auth.userId));
    if (data.owner_id && data.owner_id !== auth.userId) {
      const owner = await prisma.user.findUnique({ where: { id: data.owner_id }, select: { id: true } });
      if (!owner) throw new ApiError('Owner not found', 404);
    }
    if (data.client_id) {
      const client = await prisma.client.findUnique({ where: { id: data.client_id, is_deleted: false }, select: { id: true } });
      if (!client) throw new ApiError('Client not found', 404);
    }

    const status = data.status ?? 'proposed';
    if (status === 'active') await assertCanActivate({ bet: data.bet, numberCount: numbers.length });
    else assertHasNumber(status, numbers.length);
    const now = new Date();

    const created = await prisma.initiative.create({
      data: {
        name: data.name,
        bet: data.bet,
        nightmare: data.nightmare,
        prevention: data.prevention,
        repair: data.repair,
        cost_of_waiting: data.cost_of_waiting,
        stop_condition: data.stop_condition,
        check_date: toDate(data.check_date),
        check_every_days: data.check_every_days,
        next_decision: data.next_decision,
        status,
        health_reason: data.health_reason,
        owner_id: ownerId,
        client_id: data.client_id,
        sort_order: data.sort_order ?? 0,
        activated_at: status === 'active' ? now : null,
        closed_at: status === 'done' || status === 'stopped' ? now : null,
        closed_reason: data.closed_reason,
        created_by_id: auth.userId,
        numbers: {
          create: numbers.map((n, index) => ({
            label: n.label,
            unit: n.unit,
            direction: n.direction,
            baseline_value: n.baseline_value,
            baseline_at: n.baseline_value !== undefined && n.baseline_value !== null ? (toDate(n.baseline_at) ?? now) : toDate(n.baseline_at),
            target_value: n.target_value,
            target_by: new Date(n.target_by),
            source: n.source,
            position: n.position ?? index,
          })),
        },
      },
      include: INITIATIVE_INCLUDE,
    });

    const withHealth = await recomputeHealth(created.id);
    return NextResponse.json(formatInitiativeResponse(withHealth), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
