import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializePass } from '@/lib/engagement/serialize';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.object({ mode: z.enum(['dry', 'live']), model: z.string().max(80).optional() });

/** GET /api/engagement-briefs/[id]/passes: newest first (default 20, max 100). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const limit = Math.min(100, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '20', 10) || 20));
    const rows = await prisma.engagementPass.findMany({ where: { brief_id: id }, orderBy: { started_at: 'desc' }, take: limit });
    return NextResponse.json({ passes: rows.map(serializePass) });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/engagement-briefs/[id]/passes: start a pass record. A `live` pass is refused unless the
 * brief's owner_mode is `live`; a `dry` pass needs `dry` or `live`. An `off` brief runs nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const body = bodySchema.parse(await request.json());
    const brief = await prisma.engagementBrief.findUnique({ where: { id } });
    if (!brief) throw new ApiError('Brief not found', 404);
    if (brief.owner_mode === 'off') throw new ApiError('This brief is off.', 409, 'brief_off');
    if (body.mode === 'live' && brief.owner_mode !== 'live') {
      throw new ApiError('This brief is not in live mode.', 409, 'brief_not_live');
    }
    const row = await prisma.engagementPass.create({ data: { brief_id: id, mode: body.mode, model: body.model ?? null } });
    return NextResponse.json(serializePass(row), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
