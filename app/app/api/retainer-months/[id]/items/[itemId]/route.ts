import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { itemUpdateSchema, removeItem, updateItem } from '@/lib/retainer-months/service';

type Ctx = { params: Promise<{ id: string; itemId: string }> };
const ids = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });

// PATCH /api/retainer-months/[id]/items/[itemId] (refused on a closed month)
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, itemId } = ids.parse(await params);
    const data = itemUpdateSchema.parse(await request.json());
    return NextResponse.json(await updateItem(id, itemId, data));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/retainer-months/[id]/items/[itemId] (refused on a closed month)
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, itemId } = ids.parse(await params);
    await removeItem(id, itemId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
