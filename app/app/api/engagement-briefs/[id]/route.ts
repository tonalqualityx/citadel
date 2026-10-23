import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeBrief } from '@/lib/engagement/serialize';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/engagement-briefs/[id]. pm or admin. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const row = await prisma.engagementBrief.findUnique({ where: { id } });
    if (!row) throw new ApiError('Brief not found', 404);
    return NextResponse.json(serializeBrief(row));
  } catch (error) {
    return handleApiError(error);
  }
}
