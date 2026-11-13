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
 * GET /api/engagement-briefs/[id]/snapshot: everything a project sweep needs in one read (see lib/engagement/snapshot.ts): the project, its phases,
 * open tasks with owner, last activity, blockers and live session, waits, open questions, plus the brief's cadence and last pass. The Dox lane or the
 * owner's own session only. A brief on a charter has no project, so no snapshot (400). Read only.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!mayReadSnapshot(auth, MIKE_USER_ID)) throw new ApiError('Only Dox and the owner read a project snapshot.', 403, 'snapshot_forbidden');
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const brief = await prisma.engagementBrief.findUnique({ where: { id } });
    if (!brief) throw new ApiError('Brief not found', 404);
    if (!brief.project_id) throw new ApiError('This brief is on a charter; a snapshot is per project.', 400, 'brief_not_project');
    const snap = await buildProjectSnapshot(prisma, brief.project_id);
    if (!snap) throw new ApiError('Project not found', 404);
    return NextResponse.json({ brief: serializeBrief(brief), ...snap }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
