import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { addItem, itemCreateSchema } from '@/lib/retainer-months/service';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/retainer-months/[id]/items - add named work to the month's plan (refused on a closed month)
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = z.string().uuid().parse((await params).id);
    const data = itemCreateSchema.parse(await request.json());
    return NextResponse.json(await addItem(id, data), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
