import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { awayWindowPatchSchema, serializeAwayWindow } from '@/lib/waits/away-schema';

async function load(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError('Away window not found', 404);
  const row = await prisma.awayWindow.findUnique({ where: { id } });
  if (!row) throw new ApiError('Away window not found', 404);
  return row;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;
    return NextResponse.json(serializeAwayWindow(await load(id)));
  } catch (error) {
    return handleApiError(error);
  }
}

/** PATCH /api/away-windows/:id: change the dates, confirm a calendar proposal, or edit the note. Admin only. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;
    const body = awayWindowPatchSchema.parse(await request.json());
    const row = await load(id);
    const starts = body.starts_at ? new Date(body.starts_at) : row.starts_at;
    const ends = body.ends_at ? new Date(body.ends_at) : row.ends_at;
    if (ends.getTime() <= starts.getTime()) throw new ApiError('ends_at must be after starts_at', 400);
    const updated = await prisma.awayWindow.update({
      where: { id },
      data: {
        starts_at: starts,
        ends_at: ends,
        ...(body.confirmed_at !== undefined ? { confirmed_at: body.confirmed_at ? new Date(body.confirmed_at) : null } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
    });
    return NextResponse.json(serializeAwayWindow(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

/** DELETE /api/away-windows/:id: remove a window (a settings row, not client data). Admin only. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;
    await load(id);
    await prisma.awayWindow.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
