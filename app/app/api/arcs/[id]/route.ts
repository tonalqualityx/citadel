import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatArcResponse } from '@/lib/api/formatters';
import { getArcStatus, sumOpenEstimatedMinutes } from '@/lib/arc-status';
import { mergeArcSessions, type ArcLinkedSession } from '@/lib/arc-sessions';

const updateArcSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  // Setting closed_at is the "close thread" action; null reopens; absent leaves untouched.
  closed_at: z.string().datetime().optional().nullable(),
  // Clarity Phase 5 — the Soothsayer's snooze action. Setting it hides the arc from
  // default surfaces until the date passes; null un-snoozes; absent leaves untouched.
  snoozed_until: z.string().datetime().optional().nullable(),
  // Clarity Phase 4c — the arc board header's time-estimate override. A hand-entered
  // total that overrides the computed sum of open tasks' estimated_minutes; null clears
  // the override (revert to the computed sum); absent leaves untouched. Bounded at
  // ~69 days (100,000 minutes) as a sanity ceiling, not a real product constraint.
  estimate_override_minutes: z.number().int().min(0).max(100_000).optional().nullable(),
});

const ARC_SESSION_SELECT = {
  id: true,
  external_id: true,
  title: true,
  status: true,
  remote_url: true,
  needs_attention: true,
  last_event_at: true,
} as const;

const ARC_DETAIL_INCLUDE = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  tasks: {
    where: { is_deleted: false },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      due_date: true,
      assignee_id: true,
      assignee: { select: { id: true, name: true } },
      // Phase 3 — the arc board card: awaiting-review badge, same signal CharterKanban
      // already uses (status=done && needs_review && !approved).
      needs_review: true,
      approved: true,
      // Clarity Phase 4c — the arc board header's time estimate.
      estimated_minutes: true,
    },
    orderBy: [{ priority: 'asc' as const }, { created_at: 'desc' as const }],
  },
  // Clarity Phase 4c — the arc board header's session panel: sessions explicitly linked
  // via arc_id. origin_session_external_id (provenance-only, a plain string field, not a
  // relation) is resolved separately below and merged in.
  sessions: {
    select: ARC_SESSION_SELECT,
    orderBy: { last_event_at: 'desc' as const },
  },
};

/** Clarity Phase 4c — the arc board header's session panel + time estimate. Both derived
 *  from the already-fetched arc (plus one conditional extra lookup for the origin
 *  session, when it isn't already among the arc_id-linked set) — shared by GET and PATCH
 *  so their responses never drift from each other. */
async function computeArcExtras(arc: { origin_session_external_id: string | null; sessions: ArcLinkedSession[]; tasks: Array<{ status: string; estimated_minutes: number | null }> }) {
  let originSession: ArcLinkedSession | null = null;
  if (
    arc.origin_session_external_id &&
    !arc.sessions.some((s) => s.external_id === arc.origin_session_external_id)
  ) {
    originSession = await prisma.oracleSession.findFirst({
      where: { external_id: arc.origin_session_external_id },
      select: ARC_SESSION_SELECT,
    });
  }

  return {
    sessions: mergeArcSessions(arc.sessions, originSession),
    estimatedMinutesTotal: sumOpenEstimatedMinutes(arc.tasks),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const arc = await prisma.arc.findUnique({
      where: { id },
      include: ARC_DETAIL_INCLUDE,
    });

    if (!arc) {
      throw new ApiError('Arc not found', 404);
    }

    const extras = await computeArcExtras(arc);

    return NextResponse.json({
      ...formatArcResponse(arc, getArcStatus(arc), extras),
      tasks: arc.tasks,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const existing = await prisma.arc.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Arc not found', 404);
    }

    const body = await request.json();
    const data = updateArcSchema.parse(body);

    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id, is_deleted: false },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    if (data.project_id) {
      const project = await prisma.project.findUnique({
        where: { id: data.project_id, is_deleted: false },
      });
      if (!project) {
        throw new ApiError('Project not found', 404);
      }
    }

    const arc = await prisma.arc.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.client_id !== undefined && { client_id: data.client_id }),
        ...(data.project_id !== undefined && { project_id: data.project_id }),
        ...(data.closed_at !== undefined && {
          closed_at: data.closed_at ? new Date(data.closed_at) : null,
        }),
        ...(data.snoozed_until !== undefined && {
          snoozed_until: data.snoozed_until ? new Date(data.snoozed_until) : null,
        }),
        ...(data.estimate_override_minutes !== undefined && {
          estimate_override_minutes: data.estimate_override_minutes,
        }),
      },
      include: ARC_DETAIL_INCLUDE,
    });

    const extras = await computeArcExtras(arc);

    return NextResponse.json({
      ...formatArcResponse(arc, getArcStatus(arc), extras),
      tasks: arc.tasks,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
