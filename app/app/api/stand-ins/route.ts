import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeStandIn, standInCreateSchema } from '@/lib/waits/away-schema';

/** GET /api/stand-ins: who covers which role for whom. Filter: for_user_id. Admin only. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const forUser = new URL(request.url).searchParams.get('for_user_id');
    const rows = await prisma.standIn.findMany({
      where: forUser ? { for_user_id: forUser } : {},
      orderBy: [{ for_user_id: 'asc' }, { role_key: 'asc' }],
      take: 200,
    });
    return NextResponse.json({ data: rows.map(serializeStandIn), meta: { count: rows.length } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/stand-ins: name the stand-in for one role of one person. Admin only. One row per
 * (for_user_id, role_key): a repeat answers 409. Nothing reads the table unless OOO_STANDINS is on.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const body = standInCreateSchema.parse(await request.json());
    if (body.for_user_id === body.stand_in_user_id) throw new ApiError('A person cannot stand in for themself', 400);
    const users = await prisma.user.findMany({ where: { id: { in: [body.for_user_id, body.stand_in_user_id] } }, select: { id: true } });
    if (users.length !== 2) throw new ApiError('Unknown for_user_id or stand_in_user_id', 400);
    try {
      const row = await prisma.standIn.create({ data: body });
      return NextResponse.json(serializeStandIn(row), { status: 201 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ApiError('That person already has a stand-in for this role. Change it with PATCH.', 409);
      }
      throw e;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
