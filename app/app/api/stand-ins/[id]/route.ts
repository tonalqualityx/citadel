import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeStandIn, standInPatchSchema } from '@/lib/waits/away-schema';

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError('Stand-in not found', 404);
  const row = await prisma.standIn.findUnique({ where: { id } });
  if (!row) throw new ApiError('Stand-in not found', 404);
  return row;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;
    return NextResponse.json(serializeStandIn(await load(id)));
  } catch (error) {
    return handleApiError(error);
  }
}

/** PATCH /api/stand-ins/:id: name a different person for the same role. Admin only. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;
    const body = standInPatchSchema.parse(await request.json());
    const row = await load(id);
    if (body.stand_in_user_id === row.for_user_id) throw new ApiError('A person cannot stand in for themself', 400);
    const user = await prisma.user.findUnique({ where: { id: body.stand_in_user_id }, select: { id: true } });
    if (!user) throw new ApiError('Unknown stand_in_user_id', 400);
    const updated = await prisma.standIn.update({ where: { id }, data: { stand_in_user_id: body.stand_in_user_id } });
    return NextResponse.json(serializeStandIn(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE /api/stand-ins/:id: remove a mapping (a settings row, not client data). Admin only. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;
    await load(id);
    await prisma.standIn.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
