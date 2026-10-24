import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { awayWindowCreateSchema, serializeAwayWindow } from '@/lib/waits/away-schema';

/** GET /api/away-windows: away windows, newest first. Filter: user_id. Admin only. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const userId = new URL(request.url).searchParams.get('user_id');
    const rows = await prisma.awayWindow.findMany({
      where: userId ? { user_id: userId } : {},
      orderBy: { starts_at: 'desc' },
      take: 200,
    });
    return NextResponse.json({ data: rows.map(serializeAwayWindow), meta: { count: rows.length } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/away-windows: record dates a person is away. Admin only. Nothing reads the table
 * unless the OOO_STANDINS flag is on, so a row here changes no wait while the flag is off.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const body = awayWindowCreateSchema.parse(await request.json());
    const starts = new Date(body.starts_at);
    const ends = new Date(body.ends_at);
    if (ends.getTime() <= starts.getTime()) throw new ApiError('ends_at must be after starts_at', 400);
    const user = await prisma.user.findUnique({ where: { id: body.user_id }, select: { id: true } });
    if (!user) throw new ApiError('Unknown user_id', 400);
    const row = await prisma.awayWindow.create({
      data: {
        user_id: body.user_id,
        starts_at: starts,
        ends_at: ends,
        source: body.source,
        confirmed_at: body.confirmed_at ? new Date(body.confirmed_at) : null,
        note: body.note ?? null,
      },
    });
    return NextResponse.json(serializeAwayWindow(row), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
