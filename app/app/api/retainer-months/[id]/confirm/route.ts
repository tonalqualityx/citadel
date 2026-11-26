import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { confirmMonth, loadMonth, viewMonth } from '@/lib/retainer-months/service';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/retainer-months/[id]/confirm - "Use this plan": the month becomes planned and its planning task is marked done
export async function POST(_request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = z.string().uuid().parse((await params).id);
    await confirmMonth(id, auth.userId);
    return NextResponse.json(await viewMonth(await loadMonth(id)));
  } catch (error) {
    return handleApiError(error);
  }
}
