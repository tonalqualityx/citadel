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
  // Clarity Phase 7 — the anti-drop-net "act by" date. null clears it; absent leaves
  // untouched. Distinct from snoozed_until ("hide until") — never conflated.
  next_touch: z.string().datetime().optional().nullable(),
  // Clarity Phase 7 — the sales-pipeline link. 404s if the accord does not exist; null
  // detaches; absent leaves untouched.
  accord_id: z.string().uuid().optional().nullable(),
  // Clarity Phase 7 — the arc board card's cover image.
  cover_url: z.string().max(1000).optional().nullable(),
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
  // Clarity Phase 7 — the sales-pipeline link: status + lead contact fields (the
  // "relevant details from earlier rounds" hook — see /api/arcs/{id}/context for the
  // full sibling-arc surfacing).
  accord: {
    select: {
      id: true,
      name: true,
      status: true,
      lead_name: true,
      lead_business_name: true,
      lead_email: true,
      lead_phone: true,
    },
  },
  // Clarity Phase 7 — emails attached directly to this arc (the shapeless-arc case:
  // zero tasks yet, but the originating email is exactly what matters). Newest first.
  email_asks: {
    select: {
      id: true,
      subject: true,
      from_email: true,
      from_name: true,
      gist: true,
      deep_link: true,
      received_at: true,
      // Clarity Phase 7 — thread_id isn't part of the public summary shape below, only
      // used internally to build the completion-nudge payload on arc close.
      thread_id: true,
    },
    orderBy: { received_at: 'desc' as const },
  },
  // Clarity Phase 7 — Today picks that reference this arc (arc-type picks, or a
  // note-type pick with an override label attached — any pick row FK'd to it).
  today_picks: {
    select: {
      id: true,
      date: true,
      item_type: true,
      label: true,
      sort: true,
      started_at: true,
      completed_at: true,
      calendar_event_id: true,
    },
    orderBy: { date: 'desc' as const },
  },
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
      // Clarity Phase 7 — the arc board task card's cover band.
      cover_url: true,
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

// Clarity Phase 7 — the arc detail's attached-email summary. Deliberately a small,
// stable shape (not the full formatEmailAskResponse) — this is a read-only summary card
// inside the arc workspace, not the intake drawer's own full email surface.
function formatArcEmailAskSummary(ask: {
  id: string;
  subject: string;
  from_email: string;
  from_name: string | null;
  gist: string | null;
  deep_link: string;
  received_at: Date;
}) {
  return {
    id: ask.id,
    subject: ask.subject,
    from_email: ask.from_email,
    from_name: ask.from_name ?? null,
    gist: ask.gist ?? null,
    deep_link: ask.deep_link,
    received_at: ask.received_at,
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
      email_asks: arc.email_asks.map(formatArcEmailAskSummary),
      today_picks: arc.today_picks,
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

    if (data.accord_id) {
      const accord = await prisma.accord.findUnique({
        where: { id: data.accord_id, is_deleted: false },
      });
      if (!accord) {
        throw new ApiError('Accord not found', 404);
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
        ...(data.next_touch !== undefined && {
          next_touch: data.next_touch ? new Date(data.next_touch) : null,
        }),
        ...(data.accord_id !== undefined && { accord_id: data.accord_id }),
        ...(data.cover_url !== undefined && { cover_url: data.cover_url }),
      },
      include: ARC_DETAIL_INCLUDE,
    });

    const extras = await computeArcExtras(arc);

    // Clarity Phase 7 — the completion-nudge hook: closing an arc that has an attached
    // email prompts the follow-through (Bast drafts "work is done" on the original
    // thread; draft-only, never auto-sent — the UI wires the accept/draft flow next
    // phase). Fires only on the NEWLY-closing transition (existing.closed_at was null),
    // never on every PATCH that happens to touch an already-closed arc.
    const isNewlyClosing = data.closed_at !== undefined && data.closed_at !== null && !existing.closed_at;
    const firstAttachedEmail = isNewlyClosing ? arc.email_asks[0] : undefined;

    return NextResponse.json({
      ...formatArcResponse(arc, getArcStatus(arc), extras),
      tasks: arc.tasks,
      email_asks: arc.email_asks.map(formatArcEmailAskSummary),
      today_picks: arc.today_picks,
      ...(firstAttachedEmail
        ? {
            completion_nudge: {
              thread_id: firstAttachedEmail.thread_id ?? null,
              subject: firstAttachedEmail.subject,
              from_email: firstAttachedEmail.from_email,
            },
          }
        : {}),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
