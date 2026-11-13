import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeBrief } from '@/lib/engagement/serialize';
import { mayReadSnapshot } from '@/lib/dox/guard';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/projects/[id]/engagement-brief: start the project's brief (one per project) with cadence `auto`, owner_mode `dry` and no allowed actions.
 * Idempotent: a project that already has a brief gets it back with 200, unchanged (nothing here replaces or edits an existing brief; the owner changes
 * cadence and mode). The Dox lane or the owner's own session only. A project that does not exist is 404; a deleted one too.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!mayReadSnapshot(auth, MIKE_USER_ID)) throw new ApiError('Only Dox and the owner start a project brief.', 403, 'brief_forbidden');
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Bad id', 400);
    const project = await prisma.project.findFirst({ where: { id, is_deleted: false }, select: { id: true, name: true, client_id: true } });
    if (!project) throw new ApiError('Project not found', 404);
    const existing = await prisma.engagementBrief.findUnique({ where: { project_id: id } });
    if (existing) return NextResponse.json(serializeBrief(existing), { status: 200 });
    try {
      const row = await prisma.engagementBrief.create({
        data: {
          client_id: project.client_id,
          project_id: id,
          label: project.name.slice(0, 120),
          cadence: 'auto',
          owner_mode: 'dry',
          allowed_actions: [],
          created_by_id: auth.userId,
        },
      });
      return NextResponse.json(serializeBrief(row), { status: 201 });
    } catch (e) {
      // Two creators at once: the unique project_id makes the second one read the first.
      const again = await prisma.engagementBrief.findUnique({ where: { project_id: id } });
      if (again) return NextResponse.json(serializeBrief(again), { status: 200 });
      throw e;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
