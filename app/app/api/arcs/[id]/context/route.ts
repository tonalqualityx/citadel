import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { getArcStatus } from '@/lib/arc-status';

// Clarity Phase 7 (Seeing Stone Reckoning P1) — the session-briefing endpoint. A Claude
// Code session declaring this arc at birth (singleton->session promotion, and any
// existing session that wants to orient itself) reads this ONE call for everything the
// arc touches: the arc itself, its client/project, its accord (with sibling arcs on the
// SAME accord — "relevant details from earlier rounds" per Mike's ruling: one accord
// hosts many arcs over its life, e.g. report arc -> proposal arc -> negotiation arc ->
// kickoff arc), its open + recently-resolved tasks, its attached emails, its linked
// sessions, and a recent-activity summary. Kills cold-start in both directions. Same
// auth gate as the rest of the arcs surface — no role restriction beyond being logged in.
//
// Deliberately read-only and additive: nothing here writes, and every field is a plain
// select/orderBy over already-modeled relations (arc_id/accord_id/task arc_id/email_ask
// arc_id/session arc_id + origin_session_external_id) — no new query patterns beyond
// what the existing arc detail route already does.

const RECENT_TASKS_LIMIT = 10;

interface SessionSummary {
  external_id: string;
  title: string | null;
  status: string;
  goal: string | null;
  waiting_on: string | null;
  last_event_at: Date | null;
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
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, status: true } },
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
        tasks: { where: { is_deleted: false }, select: { status: true } },
      },
    });

    if (!arc) {
      throw new ApiError('Arc not found', 404);
    }

    const [openTasks, recentTasks, lastTaskActivity, emails, linkedSessions, siblingArcs] =
      await Promise.all([
        prisma.task.findMany({
          where: { arc_id: id, is_deleted: false, status: { notIn: ['done', 'abandoned'] } },
          select: { id: true, title: true, status: true, priority: true, due_date: true },
          orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
        }),
        prisma.task.findMany({
          where: { arc_id: id, is_deleted: false, status: { in: ['done', 'abandoned'] } },
          select: { id: true, title: true, status: true, priority: true, due_date: true, updated_at: true },
          orderBy: { updated_at: 'desc' },
          take: RECENT_TASKS_LIMIT,
        }),
        prisma.task.findFirst({
          where: { arc_id: id, is_deleted: false },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        prisma.emailAsk.findMany({
          where: { arc_id: id },
          select: { id: true, subject: true, gist: true, deep_link: true, received_at: true },
          orderBy: { received_at: 'desc' },
        }),
        prisma.oracleSession.findMany({
          where: { arc_id: id },
          select: {
            external_id: true,
            title: true,
            status: true,
            goal: true,
            waiting_on: true,
            last_event_at: true,
          },
          orderBy: { last_event_at: 'desc' },
        }),
        arc.accord_id
          ? prisma.arc.findMany({
              where: { accord_id: arc.accord_id, id: { not: id } },
              select: { id: true, name: true, closed_at: true },
              orderBy: { created_at: 'desc' },
            })
          : Promise.resolve([]),
      ]);

    // Origin session (provenance) — merged in the same "not already among the arc_id-
    // linked set" fashion the arc board's own session panel uses (lib/arc-sessions.ts),
    // just against this endpoint's richer session field set.
    let sessions: SessionSummary[] = linkedSessions;
    if (
      arc.origin_session_external_id &&
      !linkedSessions.some((s) => s.external_id === arc.origin_session_external_id)
    ) {
      const originSession = await prisma.oracleSession.findFirst({
        where: { external_id: arc.origin_session_external_id },
        select: {
          external_id: true,
          title: true,
          status: true,
          goal: true,
          waiting_on: true,
          last_event_at: true,
        },
      });
      if (originSession) {
        sessions = [originSession, ...linkedSessions];
      }
    }

    const lastSessionActivityAt = sessions.reduce<Date | null>((latest, s) => {
      if (!s.last_event_at) return latest;
      const ts = new Date(s.last_event_at);
      return !latest || ts > latest ? ts : latest;
    }, null);

    return NextResponse.json({
      arc: {
        id: arc.id,
        name: arc.name,
        description: arc.description ?? null,
        status: getArcStatus(arc),
        next_touch: arc.next_touch ?? null,
        snoozed_until: arc.snoozed_until ?? null,
        closed_at: arc.closed_at ?? null,
        cover_url: arc.cover_url ?? null,
        created_at: arc.created_at,
        updated_at: arc.updated_at,
      },
      client: arc.client ? { id: arc.client.id, name: arc.client.name } : null,
      project: arc.project ? { id: arc.project.id, name: arc.project.name, status: arc.project.status } : null,
      accord: arc.accord
        ? {
            id: arc.accord.id,
            name: arc.accord.name,
            status: arc.accord.status,
            lead_name: arc.accord.lead_name ?? null,
            lead_business_name: arc.accord.lead_business_name ?? null,
            lead_email: arc.accord.lead_email ?? null,
            lead_phone: arc.accord.lead_phone ?? null,
            // The "relevant details from earlier rounds" hook — other arcs on the SAME
            // accord (report arc -> proposal arc -> negotiation arc -> kickoff arc, etc.).
            other_arcs: siblingArcs.map((a) => ({ id: a.id, name: a.name, closed_at: a.closed_at ?? null })),
          }
        : null,
      tasks: {
        open: openTasks,
        recent: recentTasks,
      },
      emails,
      sessions,
      next_touch: arc.next_touch ?? null,
      activity: {
        last_task_activity_at: lastTaskActivity?.updated_at ?? null,
        last_email_received_at: emails[0]?.received_at ?? null,
        last_session_activity_at: lastSessionActivityAt,
        arc_updated_at: arc.updated_at,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
