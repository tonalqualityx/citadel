import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatEmailAskResponse } from '@/lib/api/formatters';
import { TaskStatus, AskQueue, EmailAskIntent, ProjectStatus } from '@prisma/client';
import { floatHighPriority } from '@/lib/waiting-on-me-priority';

// The merged "everything waiting on Mike" feed. Task side is a 5-query sweep — focus,
// overdue, awaiting-review, blocked, open-within-14d — each excluding IDs already emitted
// by an earlier query in that same order (cross-query dedup). Session side is live
// OracleSessions with a waiting_on ask parked. Session asks route into their declared
// ask_queue; every task-sweep result routes to `do`, EXCEPT the awaiting-review sweep,
// which is inherently a review ask and routes to `review`.
const OPEN_WINDOW_DAYS = 14;
const NOT_DONE_ABANDONED: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned];
const NOT_DONE_ABANDONED_BLOCKED: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned, TaskStatus.blocked];

const TASK_INCLUDE = {
  arc: { select: { id: true, name: true } },
  // Clarity Phase 5 — the Review column's client grouping needs this; a review-sweep task
  // that's ad-hoc (no client) falls back to its arc, then "Other" (see needs-reshi-logic.ts,
  // client-side, so the fallback ladder stays unit-testable without a DB).
  client: { select: { id: true, name: true } },
} as const;

type TaskCard = {
  type: 'task';
  id: string;
  title: string;
  status: string;
  priority: number;
  severity: null;
  task_id: string;
  session_external_id: string | null;
  arc: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  due_date: Date | null;
  // Clarity Phase 5 — the Review grouping's "oldest-wait age": when this item actually
  // started waiting. Best-available proxy per card kind (see taskToCard/sessionToCard).
  waiting_since: Date | null;
};

type SessionCard = {
  type: 'session_ask';
  id: string;
  title: string | null;
  status: string;
  priority: null;
  severity: string | null;
  task_id: null;
  session_external_id: string;
  arc: { id: string; name: string } | null;
  // Session asks never carry a client directly — grouping falls back to arc, then "Other".
  client: null;
  due_date: null;
  waiting_since: Date | null;
};

function taskToCard(t: {
  id: string;
  title: string;
  status: string;
  priority: number;
  source_session_external_id: string | null;
  arc: { id: string; name: string } | null;
  client?: { id: string; name: string } | null;
  due_date: Date | null;
  updated_at?: Date | null;
}): TaskCard {
  return {
    type: 'task',
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    severity: null,
    task_id: t.id,
    session_external_id: t.source_session_external_id,
    arc: t.arc,
    client: t.client ?? null,
    due_date: t.due_date,
    // updated_at is the best-available proxy for "when this entered its current
    // waiting state" (e.g. when it flipped to done+needs_review) — every task-sweep
    // query already returns it via Prisma's `include` (full scalar row), just not
    // previously threaded through this card shape.
    waiting_since: t.updated_at ?? null,
  };
}

function sessionToCard(s: {
  id: string;
  external_id: string;
  waiting_on: string | null;
  status: string;
  ask_severity: string | null;
  arc: { id: string; name: string } | null;
  last_event_at?: Date | null;
  created_at?: Date | null;
}): SessionCard {
  return {
    type: 'session_ask',
    id: s.id,
    title: s.waiting_on,
    status: s.status,
    priority: null,
    severity: s.ask_severity,
    task_id: null,
    session_external_id: s.external_id,
    arc: s.arc,
    client: null,
    due_date: null,
    waiting_since: s.last_event_at ?? s.created_at ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get('user_id');

    // Auth scoping identical to /api/focus-tasks: tech users self-only, PM/Admin any user.
    let targetUserId: string;
    if (auth.role === 'tech') {
      if (userIdParam && userIdParam !== auth.userId) {
        return NextResponse.json(
          { error: 'Tech users can only view their own waiting-on-me feed' },
          { status: 403 }
        );
      }
      targetUserId = auth.userId;
    } else {
      targetUserId = userIdParam || auth.userId;
    }

    const now = new Date();
    const openWindowEnd = new Date(now.getTime() + OPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Cross-query dedup: a task already emitted by an earlier query in this fixed order
    // never appears twice, even if it would also match a later query's where-clause.
    const seen = new Set<string>();
    function dedupe<T extends { id: string }>(tasks: T[]): T[] {
      const out: T[] = [];
      for (const t of tasks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(t);
      }
      return out;
    }

    // Clarity Phase 7 — the plate rule (Q16, resolved structurally): a task under a
    // project that isn't in motion yet (quote = still being estimated, queue = approved
    // but not started — both hide their tasks from assignees per ProjectStatus's own
    // schema doc comment) contributes ZERO to the do queue or its counts. It surfaces the
    // instant the project flips in_progress (or via the project's own next_touch — a
    // planning-view concern, not this ledger). Ad-hoc tasks (no project at all) are never
    // touched by this rule — only explicitly project-scoped work can be "on a quote".
    // Scoped to the do-queue sweeps only, per spec — awaiting-review is untouched (a
    // review ask is inherently already-done work waiting on approval, not plate load).
    const notOnAQuoteOrQueueProject = {
      OR: [
        { project_id: null },
        { project: { status: { notIn: [ProjectStatus.quote, ProjectStatus.queue] } } },
      ],
    };

    const focusWhere = {
      is_deleted: false,
      is_focus: true,
      assignee_id: targetUserId,
      status: { notIn: NOT_DONE_ABANDONED_BLOCKED },
      blocked_by: { none: { status: { not: TaskStatus.done }, is_deleted: false } },
      ...notOnAQuoteOrQueueProject,
    };

    const overdueWhere = {
      is_deleted: false,
      assignee_id: targetUserId,
      status: { notIn: NOT_DONE_ABANDONED },
      due_date: { lt: now },
      ...notOnAQuoteOrQueueProject,
    };

    // Awaiting-review: scoped by REVIEWER, not assignee — this is work waiting on the
    // target user to review, mirroring the PM dashboard's awaitingReviewWhere. NOT
    // plate-rule-filtered — see the rule's own doc comment above.
    const awaitingReviewWhere = {
      is_deleted: false,
      status: TaskStatus.done,
      needs_review: true,
      approved: false,
      OR: [{ reviewer_id: null }, { reviewer_id: targetUserId }],
    };

    const blockedWhere = {
      is_deleted: false,
      assignee_id: targetUserId,
      status: TaskStatus.blocked,
      ...notOnAQuoteOrQueueProject,
    };

    const openWithin14dWhere = {
      is_deleted: false,
      assignee_id: targetUserId,
      status: { notIn: NOT_DONE_ABANDONED },
      due_date: { gte: now, lte: openWindowEnd },
      ...notOnAQuoteOrQueueProject,
    };

    const [focusTasks, overdueTasks, awaitingReviewTasks, blockedTasks, openWithin14dTasks] =
      await Promise.all([
        prisma.task.findMany({ where: focusWhere, include: TASK_INCLUDE, orderBy: { priority: 'asc' } }),
        prisma.task.findMany({ where: overdueWhere, include: TASK_INCLUDE, orderBy: { due_date: 'asc' } }),
        prisma.task.findMany({ where: awaitingReviewWhere, include: TASK_INCLUDE, orderBy: { updated_at: 'asc' } }),
        prisma.task.findMany({ where: blockedWhere, include: TASK_INCLUDE, orderBy: { updated_at: 'desc' } }),
        prisma.task.findMany({ where: openWithin14dWhere, include: TASK_INCLUDE, orderBy: { due_date: 'asc' } }),
      ]);

    // Order matters: this is the dedup precedence (focus > overdue > awaiting-review >
    // blocked > open-within-14d) per spec.
    const dedupedFocus = dedupe(focusTasks);
    const dedupedOverdue = dedupe(overdueTasks);
    const dedupedAwaitingReview = dedupe(awaitingReviewTasks);
    const dedupedBlocked = dedupe(blockedTasks);
    const dedupedOpenWithin14d = dedupe(openWithin14dTasks);

    const decide: (TaskCard | SessionCard)[] = [];
    const answer: (TaskCard | SessionCard)[] = [];
    const review: (TaskCard | SessionCard)[] = dedupedAwaitingReview.map(taskToCard);
    const doGroup: (TaskCard | SessionCard)[] = [
      ...dedupedFocus,
      ...dedupedOverdue,
      ...dedupedBlocked,
      ...dedupedOpenWithin14d,
    ].map(taskToCard);

    // Session side: live sessions with a real ask parked, not archived, not ended/stale.
    // Not scoped by targetUserId — Oracle sessions have no per-Citadel-user ownership in
    // this phase (the fleet is inherently "Mike's machines"); this endpoint is the single
    // merged view of everything waiting on him.
    const sessions = await prisma.oracleSession.findMany({
      where: {
        waiting_on: { not: null },
        archived_at: null,
        status: { notIn: ['ended', 'stale'] },
      },
      include: { arc: { select: { id: true, name: true } } },
      orderBy: { last_event_at: 'desc' },
    });

    for (const s of sessions) {
      const card = sessionToCard(s);
      switch (s.ask_queue) {
        case AskQueue.decide:
          decide.push(card);
          break;
        case AskQueue.answer:
          answer.push(card);
          break;
        case AskQueue.review:
          review.push(card);
          break;
        case AskQueue.do:
        default:
          doGroup.push(card);
          break;
      }
    }

    // Clarity Phase 4a — email asks are their own surface, never merged into
    // decide/answer/review/do: crisis = open+urgent (drives the crisis strip above
    // Today); intake = open+non-urgent (drives the collapsed intake drawer under Needs
    // Reshi). Not scoped by targetUserId, same reasoning as the session side above —
    // Oracle email asks have no per-Citadel-user ownership in this phase either.
    const [crisisAsks, intakeAsks] = await Promise.all([
      prisma.emailAsk.findMany({
        where: { state: 'open', is_urgent: true },
        orderBy: { received_at: 'desc' },
      }),
      prisma.emailAsk.findMany({
        where: { state: 'open', is_urgent: false },
        orderBy: { received_at: 'desc' },
      }),
    ]);

    // Clarity Phase 5 — Mike's ruling: Decide + Answer merge into ONE "Waiting on you"
    // queue in the UI. `queue_type` preserves which original queue an item came from
    // ('decision' for decide, 'reply' for answer) as a small chip, per the spec. `decide`
    // and `answer` stay in the response, unchanged, for API back-compat for one release —
    // the UI reads `waiting` only.
    const waiting = [
      ...decide.map((c) => ({ ...c, queue_type: 'decision' as const })),
      ...answer.map((c) => ({ ...c, queue_type: 'reply' as const })),
    ];

    // Clarity Phase 7 — the do-queue's cross-bucket priority float: applied LAST, once
    // every source (all 4 task sweeps AND any session asks routed to `do` above) has
    // landed in doGroup. Priority 1 floats to the top, then 2, everything else keeps its
    // existing relative order — a stable partition, not a full re-sort.
    const floatedDo = floatHighPriority(doGroup);

    return NextResponse.json({
      waiting,
      decide,
      answer,
      review,
      do: floatedDo,
      crisis: crisisAsks.map(formatEmailAskResponse),
      intake: {
        count: intakeAsks.length,
        newest_at: intakeAsks.length > 0 ? intakeAsks[0].received_at : null,
        // Clarity Phase 6 — per-lane counts backing the header trigger chip's quiet
        // counts (🧾/📬/🤝/💰). Null intent counts as "general", same rule as the drawer's
        // own client-side grouping (components/domain/oracle/intake/intake-drawer-logic.ts).
        // Clarity Phase 6b — `admin` is its OWN count, never folded into `general`
        // (unlike null/absent intent, which is the only thing that counts as general).
        lanes: {
          admin: intakeAsks.filter((a) => a.intent === EmailAskIntent.admin).length,
          general: intakeAsks.filter((a) => a.intent === null || a.intent === EmailAskIntent.general).length,
          meeting: intakeAsks.filter((a) => a.intent === EmailAskIntent.meeting).length,
          sales: intakeAsks.filter((a) => a.intent === EmailAskIntent.sales).length,
        },
        items: intakeAsks.map(formatEmailAskResponse),
      },
      meta: {
        counts: {
          waiting: waiting.length,
          decide: decide.length,
          answer: answer.length,
          review: review.length,
          do: floatedDo.length,
          // Clarity Phase 7 — the truthful-counts fix (G6/Q15): total previously summed
          // ONLY decide+answer+review+do, silently excluding intake and crisis from the
          // number Mike actually sees — a lying count. Every surfaced queue now counts.
          intake: intakeAsks.length,
          crisis: crisisAsks.length,
          total:
            decide.length + answer.length + review.length + floatedDo.length + intakeAsks.length + crisisAsks.length,
        },
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
