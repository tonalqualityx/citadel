import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { assignedProjectIdsFor, mySessionsWhere } from '@/lib/design/access';
import { projectSession, projectSessionListItem } from '@/lib/design/projections';
import { createOrGetSession, SESSION_STATUSES } from '@/lib/design/sessions';
import { authActor, body, guardMutation } from '@/lib/design/route-kit';
import { loadSessionTrackView } from '@/lib/design/track-session';

// GET /api/design/sessions (design 7.1): "my sessions". Designer (own), admin (all); pm and tech 403.
export async function GET(request: NextRequest) {
  try {
    const { actor } = await authActor();
    // A designer lists her sessions on the projects she is on now (W8.2 H2).
    const where = mySessionsWhere(actor, actor.role === 'designer' ? await assignedProjectIdsFor(actor.userId) : []);
    if (!where) throw new ApiError('Forbidden', 403, 'forbidden');
    const status = request.nextUrl.searchParams.get('status');
    if (status && !(SESSION_STATUSES as readonly string[]).includes(status)) throw new ApiError('Unknown status', 400, 'bad_status');
    const rows = await prisma.designSession.findMany({
      where: { ...where, ...(status ? { status: status as (typeof SESSION_STATUSES)[number] } : {}) },
      orderBy: { updated_at: 'desc' },
      take: 200,
      select: {
        id: true, status: true, updated_at: true, last_publish_id: true,
        task: { select: { id: true, title: true } },
        site: { select: { name: true } },
        track: { select: { stage: true } },
      },
    });
    const publishIds = rows.map((r) => r.last_publish_id).filter((v): v is string => !!v);
    const pubs = publishIds.length
      ? await prisma.designPublish.findMany({ where: { id: { in: publishIds } }, select: { id: true, status: true, finished_at: true } })
      : [];
    const pubById = new Map(pubs.map((p) => [p.id, p]));
    return NextResponse.json({
      sessions: rows.map((r) => projectSessionListItem({ ...r, track_stage: r.track?.stage ?? null, last_publish: r.last_publish_id ? pubById.get(r.last_publish_id) ?? null : null })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({ task_id: z.string().uuid() }).strict();

// POST /api/design/sessions (design 7.1): idempotent per task. 201 new, 200 existing. A design-stage task opens its
// track's session (SPEC 2.3): 409 track_not_ready when the project has no open track; a design-runner task is 404.
export async function POST(request: NextRequest) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const input = await body(request, createSchema, 4096);
    const { session, created } = await createOrGetSession(actor, input.task_id);
    return NextResponse.json({ session: projectSession({ ...session, track: await loadSessionTrackView(session) }) }, { status: created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
