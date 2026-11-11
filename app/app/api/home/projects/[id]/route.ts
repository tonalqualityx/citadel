import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { requireHomeUser } from '@/lib/home/gate';
import { loadHomeInputs } from '@/lib/home/load';
import { loadItemStates } from '@/lib/home/state';
import { selectHome } from '@/lib/home/select';
import { projectDrawerItems } from '@/lib/home/projects/drawer';
import { loadProjectWaits } from '@/lib/home/projects/load';
import type { HomeProjectResponse } from '@/lib/home/projects/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/home/projects/[id]: the project drawer on the home screen, for the signed-in
 * owner only (a browser session; an API key is refused, and there is no user id parameter).
 * Writes nothing. Items are the owner's own, built by the same selection as /api/home, so the
 * buttons and wording are the main list's.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireHomeUser();
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Project not found', 404);

    const project = await prisma.project.findFirst({
      where: { id, is_deleted: false },
      select: { id: true, name: true, client: { select: { id: true, name: true } } },
    });
    if (!project) throw new ApiError('Project not found', 404);

    const now = new Date();
    const timezone = await resolveUserTimezone(auth.userId);
    const [raw, states, waits] = await Promise.all([
      loadHomeInputs(prisma, auth.userId, now, { timezone }),
      loadItemStates(prisma, auth.userId),
      loadProjectWaits(prisma, project.id, auth.userId),
    ]);
    const sel = selectHome({ raw, states, now });

    const body: HomeProjectResponse = {
      project: { id: project.id, name: project.name, client: project.client },
      items: projectDrawerItems(sel.candidates, project.id, timezone),
      waits,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
