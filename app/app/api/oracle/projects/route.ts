import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { MIKE_USER_ID, BOT_USER_IDS } from '@/lib/oracle/projects/gate-constants';
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
//   - HIGH-2 fix (verification pass): the ActivityLog query previously carried a 30-day
//     `created_at >= lookback` filter while the time_entries and comments queries stayed
//     unbounded. That silently corrupted days_quiet the moment a project's TRUE last
//     movement was an activity-log row older than 30 days but younger than its next-best
//     candidate — the query never even fetched that row, so lastMovement() fell back to
//     something much older (production case: reported 101 days quiet, true 37). Fixed by
//     removing the lookback outright — all three movement sources are now unbounded,
//     matching each other. If activity-log volume ever becomes a real concern for a
//     long-lived project, the documented fallback is a per-project cap of the newest 500
//     rows (`take: 500` ordered `created_at desc` per project_id), not a shared date
//     window — a uniform date cutoff is exactly the bug being fixed here.
//   - Calendar-event -> client linking is by attendee email matching a ClientContact
//     email for that project's client (case-insensitive). CalendarEvent has no
//     first-class client relation. Judgment call OVERTURNED (verification pass): a
//     matched event no longer attaches to every in-progress project of a multi-project
//     client — it attaches ONLY when that client has exactly one in-progress
//     type=project project (the same rule the email auto-matcher already uses), via
//     `soleProjectByClient` below. A client with zero or 2+ eligible projects gets no
//     meeting_risk blocker from that event on ANY of its projects — ambiguous is treated
//     as "don't guess," not "guess everywhere."
//   - MEDIUM-5 fix (verification pass): session asks used to link to a project via
//     `arc.project_id` ONLY, orphaning every ask whose arc had no project (100% of live
//     asks at verification time). The resolution order is now: (1) the ask's arc's
//     project_id; (2) the ask's task's project_id — not implemented, because
//     OracleSession has no task_id column in this schema (only arc_id), so this path is
//     structurally a no-op here, same limitation as before; (3) the session's CLIENT
//     scope (arc.client_id) when that client has exactly one in-progress type=project
//     project (`soleProjectByClient`, shared with the calendar-event fix above).
//     Otherwise the ask is not a project blocker — it still surfaces in the general
//     /api/waiting-on-me feed, just not here.
//   - C1 (Phase 3 carry-over): stated plainly, since (1)/(3) above both start from
//     `session.arc_id` — an OracleSession this schema records with NO arc at all cannot
//     be attributed to any project here, full stop. This route only ever queries
//     sessions whose arc_id is one of the arcs it already fetched, so an arc-less
//     session ask never reaches the Projects tab; it stays visible in Needs Reshi
//     (/api/waiting-on-me) exactly like today. This is a real, permanent gap for
//     arc-less asks, not a bug — OracleSession has no client/project column of its own
//     to fall back to.
//   - The waiting-on-me session-ask sweep is NOT extracted into a shared loader — it's
//     re-queried here (now scoped by arc.project_id OR arc.client_id, see above), a
//     different filter shape than the existing global "everything waiting on Mike"
//     endpoint. Duplicating this one small query was judged lower-risk than refactoring a
//     live, heavily-tested route.
//   - MEDIUM-6 fix (verification pass): comments were previously loaded completely
//     unbounded (every comment on every task of every in-progress project) and the
//     mention-vs-later-Mike-reply check was an O(n^2) `.some()` scan over that same full
//     list. Replaced with two bounded queries — the last comment per task (via `distinct`,
//     feeds decision/clarification/review and the movement comment source) and comments
//     from the last 90 days that mention Mike or are authored by Mike (feeds the mention
//     scan) — plus an O(n) Map of each task's latest Mike-authored comment time for the
//     "later reply" check, replacing the nested scan. The query COUNT stays fixed (two
//     comment queries instead of one, not one per task/project).
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
    const meetingWindowEnd = new Date(now.getTime() + MEETING_RISK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // MEDIUM-6: bounds the mention-scan comment query (see the module doc comment).
    const mentionLookback = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

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
        next_step_owner_label: true,
        next_step_source: true,
        next_step_at: true,
        next_step_refresh_requested_at: true,
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

    const COMMENT_SELECT = {
      id: true,
      task_id: true,
      user_id: true,
      user: { select: { id: true, name: true } },
      content: true,
      mentioned_user_ids: true,
      created_at: true,
    } as const;

    interface LastCommentRow {
      id: string;
      task_id: string;
      user_id: string;
      user_name: string;
      content: string;
      mentioned_user_ids: string[];
      created_at: Date;
    }

    // C2 fix (Phase 2 carry-over): the previous version of this query used Prisma's
    // `distinct: ['task_id']` and claimed in a comment that it ran as a Postgres
    // DISTINCT ON. It doesn't — Prisma Client's `distinct` is applied CLIENT-SIDE (it
    // fetches every matching row from the database, then reduces in the query engine),
    // confirmed by capturing the actual SQL Prisma issued. For a project with a lot of
    // comment history that's an unbounded fetch masquerading as a bounded one. This is
    // now a REAL `SELECT DISTINCT ON (task_id)` via `$queryRaw`, parameterized with
    // `Prisma.join` — feeds decision/clarification/review (task.last_comment). It no
    // longer doubles as the movement comment source; see C3 below (humanMovementComments)
    // for why per-task-latest was itself a bug for movement specifically.
    const lastComments: LastCommentRow[] = taskIds.length
      ? await prisma.$queryRaw<LastCommentRow[]>(Prisma.sql`
          SELECT DISTINCT ON (c.task_id)
            c.id, c.task_id, c.user_id, u.name AS user_name, c.content,
            c.mentioned_user_ids, c.created_at
          FROM comments c
          JOIN users u ON u.id = c.user_id
          WHERE c.task_id::text IN (${Prisma.join(taskIds)}) AND c.is_deleted = false
          ORDER BY c.task_id, c.created_at DESC
        `)
      : [];
    const lastCommentByTask = new Map<string, LastCommentRow>();
    for (const c of lastComments) {
      lastCommentByTask.set(c.task_id, c);
    }

    // MEDIUM-6, query 2 of 2: comments from the last 90 days that either mention Mike or
    // are authored by Mike — the only rows the mention scan needs (a candidate mention,
    // or a possible "Mike already replied" row for the later-reply check). A mention
    // itself must be within this window to be considered at all; any Mike reply to it is
    // necessarily even more recent, so it's covered by the same window.
    const mentionWindowComments = taskIds.length
      ? await prisma.comment.findMany({
          where: {
            task_id: { in: taskIds },
            is_deleted: false,
            created_at: { gte: mentionLookback },
            OR: [{ mentioned_user_ids: { has: MIKE_USER_ID } }, { user_id: MIKE_USER_ID }],
          },
          select: COMMENT_SELECT,
          orderBy: { created_at: 'asc' },
        })
      : [];

    // O(n) latest-Mike-reply-per-task map, replacing the old O(n^2) `.some()` scan.
    const latestMikeReplyAtByTask = new Map<string, Date>();
    for (const c of mentionWindowComments) {
      if (c.user_id !== MIKE_USER_ID) continue;
      const prev = latestMikeReplyAtByTask.get(c.task_id);
      if (!prev || c.created_at > prev) latestMikeReplyAtByTask.set(c.task_id, c.created_at);
    }

    // Mentions of Mike with no LATER reply by Mike on the same task.
    const mentionsByProject = new Map<string, ClassifyProjectBlockersInput['mentions']>();
    for (const c of mentionWindowComments) {
      if (!c.mentioned_user_ids.includes(MIKE_USER_ID)) continue;
      if (c.user_id === MIKE_USER_ID) continue;
      const latestReply = latestMikeReplyAtByTask.get(c.task_id);
      if (latestReply && latestReply > c.created_at) continue;
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
      // HIGH-2: no date lookback (see the module doc comment) — bounded only by entity
      // membership in this fixed, small project/task set.
      where: {
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

    // C3 fix (Phase 2 carry-over, verifier LOW-C): movement used to be fed from
    // lastComments (one row per task, the newest only). That hides a real human comment
    // the instant a LATER Bast comment lands on the same task — the human's actual
    // movement never reaches lastMovement() at all. Movement now gets its own query:
    // every comment by a non-bot user on the project's tasks in the last 90 days, not
    // just the newest-per-task. C5: this reuses the same 90-day window as the mention
    // scan (mentionLookback) — documented on GET /api/oracle/projects in the registry.
    const humanMovementComments = taskIds.length
      ? await prisma.comment.findMany({
          where: {
            task_id: { in: taskIds },
            is_deleted: false,
            created_at: { gte: mentionLookback },
            user_id: { notIn: [...BOT_USER_IDS] },
          },
          select: COMMENT_SELECT,
          orderBy: { created_at: 'asc' },
        })
      : [];
    const humanCommentsByProject = new Map<string, typeof humanMovementComments>();
    for (const c of humanMovementComments) {
      const projectId = taskProjectId.get(c.task_id);
      if (!projectId) continue;
      const list = humanCommentsByProject.get(projectId) ?? [];
      list.push(c);
      humanCommentsByProject.set(projectId, list);
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
        deep_link: true,
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
        deep_link: e.deep_link, // LOW-8: the actual Gmail link, used as the blocker's source.url
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
        created_at: true,
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
        created_at: ar.created_at.toISOString(), // MEDIUM-7: the `since` fallback that actually ages
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

    // Shared by the calendar-event and session-ask fixes below: for a client with
    // EXACTLY ONE in-progress type=project project (among the `projects` this route
    // already loaded), that project is the unambiguous target for anything that only
    // knows the CLIENT, not a specific project. A client with zero or 2+ such projects
    // has no entry here — deliberately: ambiguous never guesses.
    const projectCountByClient = new Map<string, number>();
    for (const p of projects) {
      projectCountByClient.set(p.client.id, (projectCountByClient.get(p.client.id) ?? 0) + 1);
    }
    const soleProjectByClient = new Map<string, string>();
    for (const p of projects) {
      if (projectCountByClient.get(p.client.id) === 1) soleProjectByClient.set(p.client.id, p.id);
    }

    // Calendar events with the client, next 3 days — CalendarEvent has no first-class
    // client relation, so this matches attendee emails against the client's
    // ClientContact rows (case-insensitive). See the module doc comment's judgment call:
    // a matched event attaches ONLY to a client's sole in-progress project.
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
    const calendarEventsByProject = new Map<string, BlockerCalendarEvent[]>();
    for (const event of upcomingEvents) {
      const attendees = Array.isArray(event.attendees) ? (event.attendees as Array<{ email?: string }>) : [];
      const matchedClientIds = new Set<string>();
      for (const attendee of attendees) {
        if (!attendee.email) continue;
        const clientsForEmail = clientIdsByEmail.get(attendee.email.toLowerCase());
        if (clientsForEmail) clientsForEmail.forEach((id) => matchedClientIds.add(id));
      }
      for (const clientId of matchedClientIds) {
        const soleProjectId = soleProjectByClient.get(clientId);
        if (!soleProjectId) continue; // ambiguous (0 or 2+ eligible projects) — don't guess
        const list = calendarEventsByProject.get(soleProjectId) ?? [];
        list.push({ id: event.id, title: event.title, starts_at: event.starts_at.toISOString() });
        calendarEventsByProject.set(soleProjectId, list);
      }
    }

    // Waiting-on-me session asks. MEDIUM-5: resolution order is (1) the ask's arc's
    // project_id, (2) the ask's task's project_id — structurally unavailable here,
    // OracleSession has no task_id column in this schema, only arc_id (see the module
    // doc comment) — (3) the session's client scope (arc.client_id) via
    // soleProjectByClient above. Fetches arcs matching EITHER a target project_id OR a
    // target client_id so path (3) has the data it needs; mirrors (but does not share
    // a loader with) app/api/waiting-on-me/route.ts's session sweep.
    const projectIdSet = new Set(projectIds);
    const arcs = await prisma.arc.findMany({
      where: { OR: [{ project_id: { in: projectIds } }, { client_id: { in: clientIds } }] },
      select: { id: true, project_id: true, client_id: true },
    });
    const arcById = new Map(arcs.map((a) => [a.id, a]));
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
      // C1: an ask reaches the Projects tab ONLY when its session declared an arc.
      // The query above already filters to arc_id IN (arcIds), so this is normally
      // unreachable in production — it's here as a documented, tested fail-safe (and to
      // hold if the query above is ever loosened), not dead code to delete.
      if (!s.arc_id) continue;
      const arc = arcById.get(s.arc_id);
      if (!arc) continue;
      const projectId = arc.project_id ?? (arc.client_id ? (soleProjectByClient.get(arc.client_id) ?? null) : null);
      if (!projectId || !projectIdSet.has(projectId)) continue; // not one of our in-progress projects
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
                user_name: lastComment.user_name,
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

      const projectComments = humanCommentsByProject.get(project.id) ?? [];
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
      // LOW-9: the response's `stale` field is now computed the SAME way the stale
      // BLOCKER is (classifyStale suppresses it while stale_muted_until is in the
      // future) — previously this field ignored the mute entirely and could report
      // `stale: true` on a project a note had just parked.
      const isStaleMuted = !!(project.stale_muted_until && project.stale_muted_until > now);

      const classifyInput: ClassifyProjectBlockersInput = {
        project: { id: project.id, name: project.name, client: project.client },
        tasks: blockerTasks,
        mentions: mentionsByProject.get(project.id) ?? [],
        session_asks: sessionAsksByProject.get(project.id) ?? [],
        emails: emailsByProject.get(project.id) ?? [],
        approval_requests: approvalRequestsByProject.get(project.id) ?? [],
        calendar_events: calendarEventsByProject.get(project.id) ?? [],
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
          next_step_owner_label: project.next_step_owner_label,
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
        stale: rawStale && !isStaleMuted,
        stalled_on_mike: stalledOnMike,
        blockers,
        counts_by_kind: countsByKind,
        // Phase 3: when the machine-side job is queued but hasn't written a fresh line
        // yet, the UI can show a "refreshing" state.
        refresh_requested_at: project.next_step_refresh_requested_at
          ? project.next_step_refresh_requested_at.toISOString()
          : null,
        open_url: `/projects/${project.id}`,
      };
    });

    // Stalled-on-Mike first, then by days_quiet descending — quietest first. LOW-9: a
    // null days_quiet (no recorded movement EVER) is the maximally-quiet case, not the
    // least — it must sort to the TOP of its bucket, not the bottom, so it's mapped to
    // +Infinity here rather than -1.
    projectCards.sort((a, b) => {
      if (a.stalled_on_mike !== b.stalled_on_mike) return a.stalled_on_mike ? -1 : 1;
      const aQuiet = a.days_quiet ?? Infinity;
      const bQuiet = b.days_quiet ?? Infinity;
      if (aQuiet === bQuiet) return 0; // handles both finite ties and Infinity - Infinity (NaN)
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
