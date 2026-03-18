import { prisma } from '@/lib/db/prisma';
import { TaskStatus, ProjectStatus } from '@prisma/client';
import {
  CHECKIN_TASK_INCLUDE,
  isFromActiveProject,
  isWithinBusinessDays,
  getActiveBadges,
  getDaysOverdue,
  calcTimeSpent,
  startOfDay,
  consolidateByProject,
  consolidateBlockingByProject,
} from './utils';

const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.in_progress,
  ProjectStatus.ready,
];

const EXCLUDED_STATUSES: TaskStatus[] = [
  TaskStatus.done,
  TaskStatus.abandoned,
];

interface CheckInUser {
  id: string;
  name: string;
}

export async function buildPmCheckIn(user: CheckInUser) {
  const today = new Date();
  const todayStart = startOfDay(today);

  // Run all queries in parallel
  const [focusTasks, allUserTasks, unassignedTasks, reviewTasks, noDueDateTasks] = await Promise.all([
    // 1. Focus tasks (reuses focus-tasks route logic)
    prisma.task.findMany({
      where: {
        is_deleted: false,
        is_focus: true,
        assignee_id: user.id,
        status: { notIn: [...EXCLUDED_STATUSES, TaskStatus.blocked] },
        blocked_by: {
          none: { status: { not: TaskStatus.done }, is_deleted: false },
        },
      },
      include: CHECKIN_TASK_INCLUDE,
      orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
    }),

    // 2. All active tasks for user
    prisma.task.findMany({
      where: {
        assignee_id: user.id,
        is_deleted: false,
        status: { notIn: EXCLUDED_STATUSES },
      },
      include: CHECKIN_TASK_INCLUDE,
      orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
    }),

    // 3. Unassigned tasks from active projects
    prisma.task.findMany({
      where: {
        assignee_id: null,
        is_deleted: false,
        status: { notIn: EXCLUDED_STATUSES },
        project: {
          status: { in: ACTIVE_PROJECT_STATUSES },
          is_deleted: false,
        },
      },
      include: CHECKIN_TASK_INCLUDE,
      orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
    }),

    // 4. Review queue (reuses review-tasks route logic)
    prisma.task.findMany({
      where: {
        is_deleted: false,
        status: TaskStatus.done,
        needs_review: true,
        approved: false,
        OR: [
          { reviewer_id: null },
          { reviewer_id: user.id },
        ],
      },
      include: CHECKIN_TASK_INCLUDE,
      orderBy: { updated_at: 'asc' },
    }),

    // 5. Tasks with no due date from active projects (for needs_triage)
    prisma.task.findMany({
      where: {
        is_deleted: false,
        due_date: null,
        status: { notIn: EXCLUDED_STATUSES },
        project: {
          status: { in: ACTIVE_PROJECT_STATUSES },
          is_deleted: false,
        },
      },
      include: {
        project: { select: { id: true, name: true, status: true } },
      },
    }),
  ]);

  // Filter user tasks to active projects only
  const activeUserTasks = allUserTasks.filter(isFromActiveProject);

  // Track which task IDs have been placed to enforce hierarchical dedup
  const placed = new Set<string>();

  // --- Section 1: Focus Tasks ---
  const focusSection = focusTasks
    .filter((t) => isFromActiveProject(t))
    .map((task) => {
      placed.add(task.id);
      const badges = getActiveBadges(task, today);
      const blockingDetails = getBlockingDetails(task, user.id, today);
      if (blockingDetails.length > 0) {
        const hasUrgent = blockingDetails.some((b) => b.urgency === 'urgent');
        badges.push(hasUrgent ? 'blocking_others_urgent' : 'blocking_others');
      }

      return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        estimated_minutes: task.estimated_minutes,
        due_date: task.due_date,
        project: task.project ? { id: task.project.id, name: task.project.name } : null,
        badges,
        days_overdue: getDaysOverdue(task.due_date, today) || undefined,
        blocking_details: blockingDetails.length > 0 ? blockingDetails : undefined,
        time_spent_minutes: calcTimeSpent(task),
      };
    });

  // --- Section 2: Blocking Others (consolidated by project) ---
  const blockingItems: any[] = [];

  for (const task of activeUserTasks) {
    if (placed.has(task.id)) continue;
    const blockingDetails = getBlockingDetails(task, user.id, today);
    if (blockingDetails.length === 0) continue;

    // 5-day filter: hide if every blocked task's due_date is 6+ business days out
    const allFarOut = blockingDetails.every(
      (b) => b.due_date && !isWithinBusinessDays(new Date(b.due_date), 5, today)
    );
    if (allFarOut) continue;

    placed.add(task.id);
    const badges = getActiveBadges(task, today);
    const hasUrgent = blockingDetails.some((b) => b.urgency === 'urgent');
    if (hasUrgent) badges.push('blocking_others_urgent');
    else badges.push('blocking_others');

    blockingItems.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      project_id: task.project_id,
      badges,
      blocking_details: blockingDetails,
      time_spent_minutes: calcTimeSpent(task),
    });
  }

  // Sort: urgent first, then by nearest blocked due date
  blockingItems.sort((a, b) => {
    const aUrgent = a.badges.includes('blocking_others_urgent') ? 0 : 1;
    const bUrgent = b.badges.includes('blocking_others_urgent') ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    const aDate = a.blocking_details?.[0]?.due_date ? new Date(a.blocking_details[0].due_date).getTime() : Infinity;
    const bDate = b.blocking_details?.[0]?.due_date ? new Date(b.blocking_details[0].due_date).getTime() : Infinity;
    return aDate - bDate;
  });

  const blockingOthers = consolidateBlockingByProject(blockingItems);

  // --- Section 3: Approaching Deadlines (due ≤2 business days, any priority) ---
  const approachingItems: any[] = [];

  for (const task of activeUserTasks) {
    if (placed.has(task.id)) continue;
    if (!task.due_date) continue;

    const dueStart = startOfDay(task.due_date);
    // Must be due today or in the future (not overdue — that's falling_behind)
    // AND within 2 business days
    if (dueStart < todayStart) continue;
    if (!isWithinBusinessDays(task.due_date, 2, today)) continue;

    placed.add(task.id);
    approachingItems.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      project_id: task.project_id,
      badges: getActiveBadges(task, today),
      time_spent_minutes: calcTimeSpent(task),
    });
  }

  const approachingDeadlines = consolidateByProject(approachingItems);

  // --- Section 4: Review Queue ---
  const reviewSection = reviewTasks
    .filter((t) => !placed.has(t.id))
    .map((task) => {
      placed.add(task.id);
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        due_date: task.due_date,
        project: task.project ? { id: task.project.id, name: task.project.name } : null,
        assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
        time_spent_minutes: calcTimeSpent(task),
      };
    });

  // --- Section 5: Falling Behind (overdue, not in focus) ---
  const fallingBehindItems: any[] = [];

  for (const task of activeUserTasks) {
    if (placed.has(task.id)) continue;
    if (!task.due_date) continue;
    const dueStart = startOfDay(task.due_date);
    if (dueStart >= todayStart) continue;

    placed.add(task.id);
    fallingBehindItems.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      project_id: task.project_id,
      badges: getActiveBadges(task, today),
      days_overdue: getDaysOverdue(task.due_date, today),
      time_spent_minutes: calcTimeSpent(task),
    });
  }

  const fallingBehind = consolidateByProject(fallingBehindItems);

  // --- Section 6: Worth Starting (3-5 business days out, P1-2 or large) ---
  const worthStartingItems: any[] = [];

  for (const task of activeUserTasks) {
    if (placed.has(task.id)) continue;
    if (!task.due_date) continue;

    const dueStart = startOfDay(task.due_date);
    if (dueStart < todayStart) continue; // overdue handled above

    const isHighPriority = task.priority <= 2;
    const isLarge = (task.estimated_minutes || 0) >= 120;
    // Due in 3-5 business days AND (P1-2 or large)
    const within5 = isWithinBusinessDays(task.due_date, 5, today);
    const within2 = isWithinBusinessDays(task.due_date, 2, today);

    if (within5 && !within2 && (isHighPriority || isLarge)) {
      placed.add(task.id);
      worthStartingItems.push({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        estimated_minutes: task.estimated_minutes,
        due_date: task.due_date,
        project: task.project ? { id: task.project.id, name: task.project.name } : null,
        project_id: task.project_id,
        badges: getActiveBadges(task, today),
        time_spent_minutes: calcTimeSpent(task),
      });
    }
  }

  const worthStarting = consolidateByProject(worthStartingItems);

  // --- Section 7: Needs Triage (outside dedup hierarchy) ---
  // Tasks with no due date, grouped by project (counts only)
  const noDueDateByProject = new Map<string, { project: { id: string; name: string }; count: number }>();
  for (const task of noDueDateTasks) {
    if (!task.project) continue;
    const key = task.project.id;
    if (!noDueDateByProject.has(key)) {
      noDueDateByProject.set(key, { project: { id: task.project.id, name: task.project.name }, count: 0 });
    }
    noDueDateByProject.get(key)!.count++;
  }

  // Unassigned tasks, grouped by project (counts only)
  const unassignedByProject = new Map<string, { project: { id: string; name: string }; count: number }>();
  for (const task of unassignedTasks) {
    if (!task.project) continue;
    const key = task.project.id;
    if (!unassignedByProject.has(key)) {
      unassignedByProject.set(key, { project: { id: task.project.id, name: task.project.name }, count: 0 });
    }
    unassignedByProject.get(key)!.count++;
  }

  return {
    variant: 'pm' as const,
    user: { id: user.id, name: user.name },
    generated_at: new Date().toISOString(),
    focus_tasks: focusSection,
    blocking_others: blockingOthers,
    approaching_deadlines: approachingDeadlines,
    review_queue: reviewSection,
    falling_behind: fallingBehind,
    worth_starting: worthStarting,
    needs_triage: {
      no_due_date: Array.from(noDueDateByProject.values()).map((v) => ({
        project: v.project,
        task_count: v.count,
      })),
      unassigned: Array.from(unassignedByProject.values()).map((v) => ({
        project: v.project,
        task_count: v.count,
      })),
    },
  };
}

/**
 * Get details about tasks this task is blocking that belong to OTHER users
 * (or any user if currentUserId is null, for unassigned tasks)
 */
function getBlockingDetails(
  task: any,
  currentUserId: string | null,
  today: Date
): { user: string; task: string; due_date: string | null; urgency: 'urgent' | 'standard' }[] {
  if (!task.blocking || task.blocking.length === 0) return [];

  return task.blocking
    .filter((blocked: any) => {
      // Only count non-done tasks from active projects with different assignees
      if (blocked.status === TaskStatus.done || blocked.status === TaskStatus.abandoned) return false;
      if (!isFromActiveProject(blocked)) return false;
      if (currentUserId && blocked.assignee_id === currentUserId) return false;
      return true;
    })
    .map((blocked: any) => {
      // Urgent if blocked task due within 3 business days
      const urgency = blocked.due_date && isWithinBusinessDays(blocked.due_date, 3, today)
        ? 'urgent' as const
        : 'standard' as const;

      return {
        user: blocked.assignee?.name || 'Unassigned',
        task: blocked.title,
        due_date: blocked.due_date ? blocked.due_date.toISOString().split('T')[0] : null,
        urgency,
      };
    });
}
