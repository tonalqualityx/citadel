import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { getZonedDateString } from '@/lib/utils/time';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { isDueSoon } from '@/lib/email-asks';
import { TaskStatus } from '@prisma/client';

// Clarity Phase 4a — the due-soon row at the foot of Today: the requester's own tasks due
// within 24h (a REAL rolling 24h window from now, not a calendar-day cutoff — see
// lib/email-asks.ts's isDueSoon), not done/abandoned, and NOT already picked for today.
// This closes the "born at night, invisible until morning" gap — a task due soon that
// hasn't been consciously added to Today still surfaces here.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NOT_DONE_ABANDONED: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const timezone = await resolveUserTimezone(auth.userId);
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const dateStr =
      dateParam && DATE_RE.test(dateParam) ? dateParam : getZonedDateString(new Date(), timezone);
    const pickDate = new Date(`${dateStr}T00:00:00.000Z`);

    const now = new Date();

    const [candidates, taskPicks, arcPicks] = await Promise.all([
      prisma.task.findMany({
        where: {
          is_deleted: false,
          assignee_id: auth.userId,
          status: { notIn: NOT_DONE_ABANDONED },
          due_date: { not: null },
        },
        select: { id: true, title: true, status: true, priority: true, due_date: true, arc_id: true },
        orderBy: { due_date: 'asc' },
      }),
      prisma.todayPick.findMany({
        where: { date: pickDate, item_type: 'task', task_id: { not: null } },
        select: { task_id: true },
      }),
      // Clarity Phase 4b — a task whose ARC (not the task itself) was picked for today
      // rides the arc's own Today slot; showing it here too would double-display it.
      prisma.todayPick.findMany({
        where: { date: pickDate, item_type: 'arc', arc_id: { not: null } },
        select: { arc_id: true },
      }),
    ]);

    const pickedTaskIds = new Set(taskPicks.map((p) => p.task_id));
    const pickedArcIds = new Set(arcPicks.map((p) => p.arc_id));

    const dueSoon = candidates.filter(
      (t) =>
        t.due_date &&
        isDueSoon(t.due_date, now) &&
        !pickedTaskIds.has(t.id) &&
        !(t.arc_id && pickedArcIds.has(t.arc_id))
    );

    return NextResponse.json({
      date: dateStr,
      timezone,
      tasks: dueSoon.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date,
      })),
      meta: { total: dueSoon.length },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
