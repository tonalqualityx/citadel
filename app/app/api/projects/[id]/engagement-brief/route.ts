import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeBrief } from '@/lib/engagement/serialize';
import { guardDoxSnapshotRead, isDoxLane, mayReadSnapshot, requireDoxBriefBinding } from '@/lib/dox/guard';
import { ensureProjectBrief } from '@/lib/engagement/ensure-brief';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { isChatLane } from '@/lib/tasks/questions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/projects/[id]/engagement-brief: the project's brief with its client report fields and the computed `next_report_on` (Eastern day, null when
 * no report is scheduled). pm or admin (the Dox lane and the owner's pages). 404 when the project has no brief yet.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const project = await prisma.project.findFirst({ where: { id, is_deleted: false }, select: { status: true } });
    if (!project) throw new ApiError('Project not found', 404);
    const brief = await prisma.engagementBrief.findUnique({ where: { project_id: id } });
    if (!brief) throw new ApiError('This project has no brief yet.', 404, 'brief_not_found');
    return NextResponse.json(serializeBrief(brief, project));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/projects/[id]/engagement-brief: start the project's brief (one per project) with cadence `auto`, owner_mode `dry` and no allowed actions.
 * Idempotent: a project that already has a brief gets it back with 200, unchanged (nothing here replaces or edits an existing brief; the owner changes
 * cadence and mode). The Dox lane (only for the project its x-dox-project header names, which must be live: it creates the brief a released card never got, with these same defaults and no way to set the mode), the owner's own session or the owner's chat lane only. A project that does not exist is 404; a deleted one too.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!mayReadSnapshot(auth, MIKE_USER_ID) && !isChatLane(auth)) throw new ApiError('Only Dox, the owner and the owner\'s chat start a project brief.', 403, 'brief_forbidden');
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    await guardDoxSnapshotRead(auth, id);
    if (isDoxLane(auth)) await requireDoxBriefBinding(request.headers, id);
    const made = await ensureProjectBrief(prisma, id, auth.userId);
    if (!made) throw new ApiError('Project not found', 404);
    return NextResponse.json(serializeBrief(made.brief), { status: made.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
