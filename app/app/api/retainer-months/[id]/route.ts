import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { loadMonth, viewMonth } from '@/lib/retainer-months/service';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/retainer-months/[id]
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    await requireAuth();
    const id = z.string().uuid().parse((await params).id);
    return NextResponse.json(await viewMonth(await loadMonth(id)));
  } catch (error) {
    return handleApiError(error);
  }
}
