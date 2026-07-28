import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { TaskStatus, ProjectStatus } from '@prisma/client';

// Clarity Phase 8 (composition) — Process mode's admin-soon stage: the weekly ~45-60 min
// batch's third deal (after intake, after review). "Admin-soon" is a PRAGMATIC, documented
// filter (spec: "use a pragmatic filter and document it"), not a new task field — a task
// qualifies via ANY of:
//   (a) explicit — tagged "kind:admin" (always wins, no other condition applied)
//   (b) small internal bite — no client, no project, energy_estimate <= 3, and
//       mystery_factor != no_idea (the SMALL-BITE HONESTY LAW, DAY-REALITY #3: a task the
//       system can't honestly size is never offered inside a timeboxed chunk)
//   (c) admin-lane provenance — referenced by an EmailAsk with intent='admin' (the only
//       clause that can't be computed client-side — the reason this endpoint exists)
// All three additionally pass the PLATE RULE (same clause /api/waiting-on-me uses): a task
// under a project that's still quote/queue contributes zero.
const NOT_DONE_ABANDONED: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned];
const CAP = 20;

export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const notOnAQuoteOrQueueProject = {
      OR: [{ project_id: null }, { project: { status: { notIn: [ProjectStatus.quote, ProjectStatus.queue] } } }],
    };

    const baseWhere = {
      is_deleted: false,
      status: { notIn: NOT_DONE_ABANDONED },
      AND: [
        { OR: [{ assignee_id: auth.userId }, { assignee_id: null }] },
        notOnAQuoteOrQueueProject,
      ],
    };

    const [explicitAdmin, smallInternalBite, adminLaneAsks] = await Promise.all([
      prisma.task.findMany({
        where: { ...baseWhere, tags: { has: 'kind:admin' } },
        select: {
          id: true, title: true, status: true, priority: true, due_date: true, promised_to: true, created_at: true,
          client: { select: { id: true, name: true } },
        },
      }),
      prisma.task.findMany({
        where: {
          ...baseWhere,
          client_id: null,
          project_id: null,
          energy_estimate: { lte: 3 },
          mystery_factor: { not: 'no_idea' },
        },
        select: {
          id: true, title: true, status: true, priority: true, due_date: true, promised_to: true, created_at: true,
          client: { select: { id: true, name: true } },
        },
      }),
      prisma.emailAsk.findMany({
        where: { intent: 'admin', task_id: { not: null } },
        select: { task_id: true },
      }),
    ]);

    const adminLaneTaskIds = adminLaneAsks.map((a) => a.task_id).filter((id): id is string => !!id);
    const adminLaneTasks = adminLaneTaskIds.length
      ? await prisma.task.findMany({
          where: { ...baseWhere, id: { in: adminLaneTaskIds } },
          select: {
            id: true, title: true, status: true, priority: true, due_date: true, promised_to: true, created_at: true,
            client: { select: { id: true, name: true } },
          },
        })
      : [];

    const byId = new Map<string, (typeof explicitAdmin)[number] & { source_intent: 'admin' | null }>();
    for (const t of explicitAdmin) byId.set(t.id, { ...t, source_intent: null });
    for (const t of smallInternalBite) if (!byId.has(t.id)) byId.set(t.id, { ...t, source_intent: null });
    for (const t of adminLaneTasks) byId.set(t.id, { ...(byId.get(t.id) ?? t), source_intent: 'admin' });

    const tasks = Array.from(byId.values())
      .sort((a, b) => {
        const aDue = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const bDue = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        if (aDue !== bDue) return aDue - bDue;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      })
      .slice(0, CAP)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date,
        promised_to: t.promised_to ?? null,
        client: t.client ? { id: t.client.id, name: t.client.name } : null,
        source_intent: t.source_intent,
      }));

    return NextResponse.json({ tasks, meta: { total: tasks.length, cap: CAP } });
  } catch (error) {
    return handleApiError(error);
  }
}
