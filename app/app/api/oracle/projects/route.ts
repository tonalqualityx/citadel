import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import {
  classifyProjectBlockers,
  ownerIsMike,
  type Blocker,
  type BlockerTask,
  type BlockerEmail,
  type BlockerApprovalRequest,
  type BlockerCalendarEvent,
  type ClassifyProjectBlockersInput,
} from '@/lib/oracle/projects/blockers';
import { lastMovement, daysSince, isStale, type LastMovementInput } from '@/lib/oracle/projects/movement';
import {
  findNextStepCandidate,
  mergeNextStep,
  type NextStepCandidateTask,
} from '@/lib/oracle/projects/next-step-candidate';

// Oracle Projects Tab Phase 2 — GET /api/oracle/projects. Loads every in-progress
// contracted project and every signal classifyProjectBlockers/lastMovement/
// findNextStepCandidate need to read, in as few queries as practical (a fixed, small
// number of queries scoped to the eligible project set, not N+1 per project), shapes
// them into each module's plain-data input, and returns the assembled cards sorted
// stalled-on-Mike first, then by days_quiet descending.
//
// Judgment calls made here (see the plan's Phase 2 Notes for the full writeup):
//   - EmailAsk.replied is state !== 'open' only. This schema has no record of Mike's
//     OUTBOUND replies (EmailAsk only stores inbound asks the classifier flagged), so
//     "a later message from Mike exists in the thread" isn't something this table can
//     answer — state is the only available proxy.
//   - Calendar-event -> client linking is by attendee email matching a ClientContact
//     email for that project's client (case-insensitive). CalendarEvent has no
//     first-class client relation. A matched event is attached to every in-progress
//     project of that client (there's no way to know which project a meeting is "about"
//     from calendar data alone).
//   - The waiting-on-me session-ask sweep is NOT extracted into a shared loader — it's
//     re-queried here scoped by `arc.project_id IN (...)`, a different filter shape than
//     the existing global "everything waiting on Mike" endpoint. Duplicating this one
//     small query was judged lower-risk than refactoring a live, heavily-tested route.
const NEXT_MOVEMENT_LOOKBACK_DAYS = 30;
const MEETING_RISK_WINDOW_DAYS = 3;

type ChangesJson = { status?: { from?: string; to?: string } } | null | undefined;

function statusToFromChanges(changes: unknown): string | null {
  const c = changes as ChangesJson;
  return c?.status?.to ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const { searchParams } = new URL(request.url);
    const lens = searchParams.get('lens');

    const now = new Date();
    const movementLookback = new Date(now.getTime() - NEXT_MOVEMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const meetingWindowEnd = new Date(now.getTime() + MEETING_RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Only in-progress CONTRACTED projects — quote/queue/retainer/internal/done/
    // suspended/cancelled projects never show up here.
    const projects = await prisma.project.findMany({
      where: { type: 'project', status: 'in_progress', is_deleted: false },
      select: {
        id: true,
        name: true,
        client: { select: { id: true, name: true } },
        status: true,
        next_step_text: true,
        next_step_owner: { select: { id: true, name: true } },
        next_step_source: true,
        next_step_at: true,
        stale_muted_until: true,
      },
      orderBy: { name: 'asc' },
    });

    if (projects.length === 0) {
      return NextResponse.json({ projects: [], stalled_count: 0, generated_at: now.toISOString() });
    }

    const projectIds = projects.map((p) => p.id);
    const clientIds = Array.from(new Set(projects.map((p) => p.client.id)));

    const tasks = await prisma.task.findMany({
      where: { project_id: { in: projectIds }, is_deleted: false },
      select: {
        id: true,
        title: true,
        status: true,
        tags: true,
        needs_review: true,
        approved: true,
        assignee_id: true,
        assignee: { select: { id: true, name: true } },
        sop: { select: { title: true } },
        updated_at: true,
        created_at: true,
        project_id: true,
        sort_order: true,
        project_phase: { select: { sort_order: true } },
        blocked_by: { select: { id: true } },
      },
    });
    const taskIds = tasks.map((t) => t.id);
    const taskProjectId = new Map(tasks.map((t) => [t.id, t.project_id]));

    const comments = taskIds.length
      ? await prisma.comment.findMany({
          where: { task_id: { in: taskIds }, is_deleted: false },
          select: {
            id: true,
            task_id: true,
            user_id: true,
            user: { select: { id: true, name: true } },
            content: true,
            mentioned_user_ids: true,
            created_at: true,
          },
          orderBy: { created_at: 'asc' },
        })
      : [];

    // Last comment per task (max created_at) — feeds decision/clarification/review.
    const lastCommentByTask = new Map<string, (typeof comments)[number]>();
    for (const c of comments) {
      const prev = lastCommentByTask.get(c.task_id);
      if (!prev || c.created_at > prev.created_at) lastCommentByTask.set(c.task_id, c);
    }

    // Mentions of Mike with no LATER reply by Mike on the same task.
    const mentionsByProject = new Map<string, ClassifyProjectBlockersInput['mentions']>();
    for (const c of comments) {
      if (!c.mentioned_user_ids.includes(MIKE_USER_ID)) continue;
      if (c.user_id === MIKE_USER_ID) continue;
      const laterMikeReply = comments.some(
        (later) => later.task_id === c.task_id && later.user_id === MIKE_USER_ID && later.created_at > c.created_at
      );
      if (laterMikeReply) continue;
      const projectId = taskProjectId.get(c.task_id);
      if (!projectId) continue;
      const list = mentionsByProject.get(projectId) ?? [];
      list.push({
        id: c.id,
        task_id: c.task_id,
        author: { id: c.user.id, name: c.user.name },
        created_at: c.created_at.toISOString(),
        excerpt: c.content.slice(0, 280),
      });
      mentionsByProject.set(projectId, list);
    }

    const timeEntries = await prisma.timeEntry.findMany({
      where: {
        is_deleted: false,
        OR: [{ project_id: { in: projectIds } }, { task_id: { in: taskIds.length ? taskIds : ['__none__'] } }],
      },
      select: { project_id: true, task_id: true, user_id: true, user: { select: { name: true } }, started_at: true },
    });
    const timeEntriesByProject = new Map<string, typeof timeEntries>();
    for (const te of timeEntries) {
      const projectId = te.project_id ?? (te.task_id ? taskProjectId.get(te.task_id) : null);
      if (!projectId) continue;
      const list = timeEntriesByProject.get(projectId) ?? [];
      list.push(te);
      timeEntriesByProject.set(projectId, list);
    }

    const activityLog = await prisma.activityLog.findMany({
      where: {
        created_at: { gte: movementLookback },
        OR: [
          { entity_type: 'task', entity_id: { in: taskIds.length ? taskIds : ['__none__'] } },
          { entity_type: 'project', entity_id: { in: projectIds } },
        ],
      },
      select: {
        id: true,
        user_id: true,
        user: { select: { name: true } },
        action: true,
        entity_type: true,
        entity_id: true,
        created_at: true,
        changes: true,
      },
    });
    const activityLogByProject = new Map<string, typeof activityLog>();
    for (const log of activityLog) {
      const projectId = log.entity_type === 'project' ? log.entity_id : taskProjectId.get(log.entity_id);
      if (!projectId) continue;
      const list = activityLogByProject.get(projectId) ?? [];
      list.push(log);
      activityLogByProject.set(projectId, list);
    }

    const commentsByProject = new Map<string, typeof comments>();
    for (const c of comments) {
      const projectId = taskProjectId.get(c.task_id);
      if (!projectId) continue;
      const list = commentsByProject.get(projectId) ?? [];
      list.push(c);
      commentsByProject.set(projectId, list);
    }

    const emails = await prisma.emailAsk.findMany({
      where: { project_id: { in: projectIds } },
      select: {
        id: true,
        project_id: true,
        from_name: true,
        from_email: true,
        subject: true,
        gist: true,
        received_at: true,
        state: true,
      },
    });
    const emailsByProject = new Map<string, BlockerEmail[]>();
    for (const e of emails) {
      if (!e.project_id) continue;
      const list = emailsByProject.get(e.project_id) ?? [];
      list.push({
        id: e.id,
        from: e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email,
        subject: e.subject,
        gist: e.gist,
        received_at: e.received_at.toISOString(),
        // Judgment call (see module doc comment): this schema tracks no outbound-reply
        // record on EmailAsk, so `replied` is state !== 'open' only.
        replied: e.state !== 'open',
      });
      emailsByProject.set(e.project_id, list);
    }

    const approvalRequests = await prisma.approvalRequest.findMany({
      where: { project_id: { in: projectIds } },
      select: {
        id: true,
        project_id: true,
        task_id: true,
        status: true,
        sent_at: true,
        chase_after_days: true,
        replied_at: true,
        contact: { select: { id: true, name: true } },
      },
    });
    const approvalRequestsByProject = new Map<string, BlockerApprovalRequest[]>();
    for (const ar of approvalRequests) {
      const list = approvalRequestsByProject.get(ar.project_id) ?? [];
      list.push({
        id: ar.id,
        task_id: ar.task_id,
        status: ar.status,
        sent_at: ar.sent_at ? ar.sent_at.toISOString() : null,
        chase_after_days: ar.chase_after_days,
        replied_at: ar.replied_at ? ar.replied_at.toISOString() : null,
        contact: ar.contact ? { id: ar.contact.id, name: ar.contact.name ?? 'the client' } : null,
      });
      approvalRequestsByProject.set(ar.project_id, list);
    }

    const dismissals = await prisma.blockerDismissal.findMany({
      where: { project_id: { in: projectIds } },
      select: { project_id: true, kind: true, source_id: true, source_marker: true, dismissed_at: true },
    });
    const dismissalsByProject = new Map<string, typeof dismissals>();
    for (const d of dismissals) {
      const list = dismissalsByProject.get(d.project_id) ?? [];
      list.push(d);
      dismissalsByProject.set(d.project_id, list);
    }

    // Calendar events with the client, next 3 days — CalendarEvent has no first-class
    // client relation, so this matches attendee emails against the client's
    // ClientContact rows (case-insensitive). See the module doc comment's judgment call.
    const contacts = await prisma.clientContact.findMany({
      where: { client_id: { in: clientIds }, is_deleted: false },
      select: { client_id: true, email: true },
    });
    const clientIdsByEmail = new Map<string, Set<string>>();
    for (const c of contacts) {
      const email = c.email.toLowerCase();
      const set = clientIdsByEmail.get(email) ?? new Set<string>();
      set.add(c.client_id);
      clientIdsByEmail.set(email, set);
    }

    const upcomingEvents = await prisma.calendarEvent.findMany({
      where: { starts_at: { gte: now, lte: meetingWindowEnd } },
      select: { id: true, title: true, starts_at: true, attendees: true },
    });
    const calendarEventsByClient = new Map<string, BlockerCalendarEvent[]>();
    for (const event of upcomingEvents) {
      const attendees = Array.isArray(event.attendees) ? (event.attendees as Array<{ email?: string }>) : [];
      const matchedClientIds = new Set<string>();
      for (const attendee of attendees) {
        if (!attendee.email) continue;
        const clientsForEmail = clientIdsByEmail.get(attendee.email.toLowerCase());
        if (clientsForEmail) clientsForEmail.forEach((id) => matchedClientIds.add(id));
      }
      for (const clientId of matchedClientIds) {
        const list = calendarEventsByClient.get(clientId) ?? [];
        list.push({ id: event.id, title: event.title, starts_at: event.starts_at.toISOString() });
        calendarEventsByClient.set(clientId, list);
      }
    }

    // Waiting-on-me session asks scoped to these projects, via arc.project_id. Mirrors
    // app/api/waiting-on-me/route.ts's session sweep (not extracted into a shared
    // loader — see the module doc comment).
    const arcs = await prisma.arc.findMany({
      where: { project_id: { in: projectIds } },
      select: { id: true, project_id: true },
    });
    const projectIdByArc = new Map(arcs.map((a) => [a.id, a.project_id as string]));
    const arcIds = arcs.map((a) => a.id);
    const sessions = arcIds.length
      ? await prisma.oracleSession.findMany({
          where: {
            waiting_on: { not: null },
            archived_at: null,
            status: { notIn: ['ended', 'stale'] },
            arc_id: { in: arcIds },
          },
          select: {
            external_id: true,
            waiting_on: true,
            ask_queue: true,
            ask_severity: true,
            last_event_at: true,
            created_at: true,
            arc_id: true,
          },
        })
      : [];
    const sessionAsksByProject = new Map<string, ClassifyProjectBlockersInput['session_asks']>();
    for (const s of sessions) {
      const projectId = s.arc_id ? projectIdByArc.get(s.arc_id) : null;
      if (!projectId) continue;
      const list = sessionAsksByProject.get(projectId) ?? [];
      list.push({
        session_external_id: s.external_id,
        queue: s.ask_queue,
        text: s.waiting_on,
        severity: s.ask_severity,
        waiting_since: (s.last_event_at ?? s.created_at)?.toISOString() ?? null,
      });
      sessionAsksByProject.set(projectId, list);
    }

    const tasksByProject = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const list = tasksByProject.get(t.project_id!) ?? [];
      list.push(t);
      tasksByProject.set(t.project_id!, list);
    }

    const projectCards = projects.map((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];

      const blockerTasks: BlockerTask[] = projectTasks.map((t) => {
        const lastComment = lastCommentByTask.get(t.id);
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          tags: t.tags,
          needs_review: t.needs_review,
          approved: t.approved,
          assignee_id: t.assignee_id,
          assignee_name: t.assignee?.name ?? null,
          sop_title: t.sop?.title ?? null,
          updated_at: t.updated_at.toISOString(),
          blocked_by_ids: t.blocked_by.map((b) => b.id),
          phase_sort: t.project_phase?.sort_order ?? 0,
          sort_order: t.sort_order,
          last_comment: lastComment
            ? {
                id: lastComment.id,
                user_id: lastComment.user_id,
                user_name: lastComment.user.name,
                created_at: lastComment.created_at.toISOString(),
                content_excerpt: lastComment.content.slice(0, 280),
              }
            : null,
        };
      });

      const nextStepCandidateTasks: NextStepCandidateTask[] = projectTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        blocked_by_ids: t.blocked_by.map((b) => b.id),
        phase_sort: t.project_phase?.sort_order ?? 0,
        sort_order: t.sort_order,
        created_at: t.created_at.toISOString(),
        assignee_id: t.assignee_id,
        assignee_name: t.assignee?.name ?? null,
      }));
      const candidate = findNextStepCandidate(nextStepCandidateTasks);

      const projectComments = commentsByProject.get(project.id) ?? [];
      const movementInput: LastMovementInput = {
        time_entries: (timeEntriesByProject.get(project.id) ?? []).map((te) => ({
          user_id: te.user_id,
          user_name: te.user.name,
          started_at: te.started_at.toISOString(),
        })),
        activity_log: (activityLogByProject.get(project.id) ?? []).map((log) => ({
          id: log.id,
          user_id: log.user_id,
          user_name: log.user.name,
          action: log.action,
          entity_type: log.entity_type,
          entity_id: log.entity_id,
          created_at: log.created_at.toISOString(),
          status_to: statusToFromChanges(log.changes),
        })),
        comments: projectComments.map((c) => ({
          id: c.id,
          task_id: c.task_id,
          user_id: c.user_id,
          user_name: c.user.name,
          content: c.content,
          created_at: c.created_at.toISOString(),
        })),
      };
      const movement = lastMovement(movementInput);
      const daysQuiet = daysSince(movement?.at ?? null, now);
      const rawStale = isStale(movementInput, now);

      const classifyInput: ClassifyProjectBlockersInput = {
        project: { id: project.id, name: project.name, client: project.client },
        tasks: blockerTasks,
        mentions: mentionsByProject.get(project.id) ?? [],
        session_asks: sessionAsksByProject.get(project.id) ?? [],
        emails: emailsByProject.get(project.id) ?? [],
        approval_requests: approvalRequestsByProject.get(project.id) ?? [],
        calendar_events: calendarEventsByClient.get(project.client.id) ?? [],
        time_entries: (timeEntriesByProject.get(project.id) ?? []).map((te) => ({
          started_at: te.started_at.toISOString(),
        })),
        dismissals: (dismissalsByProject.get(project.id) ?? []).map((d) => ({
          kind: d.kind,
          source_id: d.source_id,
          source_marker: d.source_marker,
          dismissed_at: d.dismissed_at.toISOString(),
        })),
        next_step_candidate: candidate
          ? {
              task_id: candidate.task.id,
              assignee_id: candidate.assignee?.id ?? null,
              assignee_name: candidate.assignee?.name ?? null,
              since: candidate.task.created_at,
            }
          : null,
        last_movement_at: movement?.at ?? null,
        stale_muted_until: project.stale_muted_until ? project.stale_muted_until.toISOString() : null,
      };

      const blockers: Blocker[] = classifyProjectBlockers(classifyInput, now);
      const stalledOnMike = ownerIsMike(blockers);

      const nextStep = mergeNextStep(
        {
          next_step_text: project.next_step_text,
          next_step_owner: project.next_step_owner,
          next_step_source: project.next_step_source,
          next_step_at: project.next_step_at ? project.next_step_at.toISOString() : null,
        },
        candidate
      );

      const countsByKind: Record<string, number> = {};
      for (const b of blockers) {
        countsByKind[b.kind] = (countsByKind[b.kind] ?? 0) + 1;
      }

      return {
        id: project.id,
        name: project.name,
        client: project.client,
        status: project.status,
        next_step: nextStep,
        last_movement: movement,
        days_quiet: daysQuiet === Infinity ? null : daysQuiet,
        stale: rawStale,
        stalled_on_mike: stalledOnMike,
        blockers,
        counts_by_kind: countsByKind,
        open_url: `/projects/${project.id}`,
      };
    });

    // Stalled-on-Mike first, then by days_quiet descending (nulls/Infinity sort last).
    projectCards.sort((a, b) => {
      if (a.stalled_on_mike !== b.stalled_on_mike) return a.stalled_on_mike ? -1 : 1;
      const aQuiet = a.days_quiet ?? -1;
      const bQuiet = b.days_quiet ?? -1;
      return bQuiet - aQuiet;
    });

    const stalledCount = projectCards.filter((p) => p.stalled_on_mike).length;

    const responseBody: Record<string, unknown> = {
      projects: projectCards,
      stalled_count: stalledCount,
      generated_at: now.toISOString(),
    };

    if (lens === 'kind') {
      const byKind: Record<string, Array<{ blocker: Blocker; project: { id: string; name: string } }>> = {};
      for (const card of projectCards) {
        for (const blocker of card.blockers) {
          const list = byKind[blocker.kind] ?? [];
          list.push({ blocker, project: { id: card.id, name: card.name } });
          byKind[blocker.kind] = list;
        }
      }
      responseBody.by_kind = byKind;
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return handleApiError(error);
  }
}
