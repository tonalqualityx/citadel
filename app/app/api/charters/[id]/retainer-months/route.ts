import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { charterMonths } from '@/lib/retainer-months/service';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/charters/[id]/retainer-months - the current month in full, past months as one line of data each
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    await requireAuth();
    const id = z.string().uuid().parse((await params).id);
    const charter = await prisma.charter.findFirst({ where: { id, is_deleted: false }, select: { id: true, billing_period: true } });
    if (!charter) throw new ApiError('Charter not found', 404);
    return NextResponse.json({ charter_id: id, billing_period: charter.billing_period, ...(await charterMonths(id)) });
  } catch (error) {
    return handleApiError(error);
  }
}
