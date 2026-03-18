import { prisma } from '@/lib/db/prisma';
import { TaskStatus, ProjectStatus } from '@prisma/client';
import {
  CHECKIN_TASK_INCLUDE,
  isTaskUnblocked,
  isFromActiveProject,
  isWithinBusinessDays,
  getActiveBadges,
  getDaysOverdue,
  calcTimeSpent,
  startOfDay,
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

  // Run all queries in parallel
  const [focusTasks, allUserTasks, unassignedTasks, reviewTasks] = await Promise.all([
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

  // --- Section 2: Blocking Others ---
  const blockingOthersUrgent: any[] = [];
  const blockingOthersStandard: any[] = [];

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
    const item = {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      badges,
      blocking_details: blockingDetails,
      time_spent_minutes: calcTimeSpent(task),
    };

    const hasUrgent = blockingDetails.some((b) => b.urgency === 'urgent');
    if (hasUrgent) {
      blockingOthersUrgent.push(item);
    } else {
      blockingOthersStandard.push(item);
    }
  }

  // --- Section 3: Falling Behind (overdue, not in focus) ---
  const fallingBehind: any[] = [];
  const todayStart = startOfDay(today);

  for (const task of activeUserTasks) {
    if (placed.has(task.id)) continue;
    if (!task.due_date) continue;
    const dueStart = startOfDay(task.due_date);
    if (dueStart >= todayStart) continue;

    placed.add(task.id);
    fallingBehind.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      badges: getActiveBadges(task, today),
      days_overdue: getDaysOverdue(task.due_date, today),
      time_spent_minutes: calcTimeSpent(task),
    });
  }

  // --- Section 4: Upcoming (due within 5 calendar days + P1-2, or large tasks) ---
  const upcoming: any[] = [];
  const fiveDaysOut = new Date(todayStart);
  fiveDaysOut.setDate(fiveDaysOut.getDate() + 5);

  for (const task of activeUserTasks) {
    if (placed.has(task.id)) continue;

    const isHighPriority = task.priority <= 2;
    const isLarge = (task.estimated_minutes || 0) >= 120;
    const dueWithin5 = task.due_date && startOfDay(task.due_date) <= fiveDaysOut;

    // Include if: (due within 5 days AND (high priority OR large)) OR (high priority with no due date)
    const qualifies =
      (dueWithin5 && (isHighPriority || isLarge)) ||
      (isHighPriority && !task.due_date);

    if (!qualifies) continue;

    placed.add(task.id);
    upcoming.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      badges: getActiveBadges(task, today),
      time_spent_minutes: calcTimeSpent(task),
    });
  }

  // --- Section 5: Unassigned ---
  const unassignedSection = unassignedTasks.map((task) => {
    const badges = getActiveBadges(task, today);
    const blockingDetails = getBlockingDetails(task, null, today);
    if (blockingDetails.length > 0) badges.push('blocking_others');

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimated_minutes: task.estimated_minutes,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      badges,
      blocking_details: blockingDetails.length > 0 ? blockingDetails : undefined,
    };
  });

  // --- Section 6: Review Queue ---
  const reviewSection = reviewTasks
    .filter((t) => !placed.has(t.id))
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date,
      project: task.project ? { id: task.project.id, name: task.project.name } : null,
      assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
      time_spent_minutes: calcTimeSpent(task),
    }));

  return {
    variant: 'pm' as const,
    user: { id: user.id, name: user.name },
    generated_at: new Date().toISOString(),
    focus_tasks: focusSection,
    blocking_others: {
      urgent: blockingOthersUrgent,
      standard: blockingOthersStandard,
    },
    falling_behind: fallingBehind,
    upcoming,
    unassigned: unassignedSection,
    review_queue: reviewSection,
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
