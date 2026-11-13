import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeBrief } from '@/lib/engagement/serialize';
import { z } from 'zod';
import { CADENCES, OWNER_MODES } from '@/lib/engagement/brief';
import { isChatLane } from '@/lib/tasks/questions';
import { isDoxLane } from '@/lib/dox/guard';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

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

const patchSchema = z
  .object({ cadence: z.enum(CADENCES).optional(), owner_mode: z.enum(OWNER_MODES).optional() })
  .strict()
  .refine((b) => b.cadence !== undefined || b.owner_mode !== undefined, { message: 'Send cadence, owner_mode or both.' });

/**
 * PATCH /api/engagement-briefs/[id]: change how often a brief's project is swept (`cadence`) and whether Dox only records (`dry`), acts (`live`) or
 * stays away (`off`) (`owner_mode`). The owner's own signed-in session or the owner's chat lane only; the Dox lane is refused, so Dox cannot set his own
 * mode or cadence. Bumps `version`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (isDoxLane(auth)) throw new ApiError('Dox does not set his own mode or cadence.', 403, 'dox_brief_closed');
    const owner = auth.via !== 'api_key' && auth.userId === MIKE_USER_ID;
    if (!owner && !isChatLane(auth)) throw new ApiError('Only the owner and the owner\'s chat change a brief\'s mode or cadence.', 403, 'brief_forbidden');
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const body = patchSchema.parse(await request.json());
    const existing = await prisma.engagementBrief.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError('Brief not found', 404);
    const row = await prisma.engagementBrief.update({
      where: { id },
      data: { ...(body.cadence !== undefined ? { cadence: body.cadence } : {}), ...(body.owner_mode !== undefined ? { owner_mode: body.owner_mode } : {}), version: { increment: 1 } },
    });
    return NextResponse.json(serializeBrief(row));
  } catch (error) {
    return handleApiError(error);
  }
}
