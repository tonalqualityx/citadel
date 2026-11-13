import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { buildProjectSnapshot } from '@/lib/engagement/snapshot';
import { serializeBrief } from '@/lib/engagement/serialize';
import { mayReadSnapshot } from '@/lib/dox/guard';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/projects/[id]/engagement-snapshot: the same snapshot as /api/engagement-briefs/[id]/snapshot, by project id, for a project with no brief yet
 * (`brief` is null until POST /api/projects/[id]/engagement-brief creates it). The Dox lane or the owner's own session only. Read only.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!mayReadSnapshot(auth, MIKE_USER_ID)) throw new ApiError('Only Dox and the owner read a project snapshot.', 403, 'snapshot_forbidden');
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const snap = await buildProjectSnapshot(prisma, id);
    if (!snap) throw new ApiError('Project not found', 404);
    const brief = await prisma.engagementBrief.findUnique({ where: { project_id: id } });
    return NextResponse.json({ brief: brief ? serializeBrief(brief) : null, ...snap }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
