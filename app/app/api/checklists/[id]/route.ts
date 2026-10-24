import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeChecklist } from '@/lib/checklists/service';

/** GET /api/checklists/:id: one checklist with its items and the keys still holding it open. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Checklist not found', 404);
    const c = await prisma.checklist.findUnique({ where: { id }, include: { items: { orderBy: { key: 'asc' } } } });
    if (!c) throw new ApiError('Checklist not found', 404);
    return NextResponse.json(serializeChecklist(c));
  } catch (error) {
    return handleApiError(error);
  }
}
