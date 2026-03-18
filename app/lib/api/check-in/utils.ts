import { TaskStatus, ProjectStatus } from '@prisma/client';

const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.in_progress,
  ProjectStatus.ready,
];

/**
 * Check if a date is a business day (Mon-Fri)
 */
export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Add N business days to a date (skipping weekends)
 */
export function addBusinessDays(date: Date, n: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) {
      added++;
    }
  }
  return result;
}

/**
 * Check if a due date is within N business days of today.
 * Returns true if dueDate is null (no due date = include it).
 * Returns true if dueDate is in the past (overdue = include it).
 */
export function isWithinBusinessDays(dueDate: Date | null, n: number, today: Date): boolean {
  if (!dueDate) return true;
  const deadline = addBusinessDays(today, n);
  // Compare date-only (strip time)
  const dueDateOnly = startOfDay(dueDate);
  const deadlineOnly = startOfDay(deadline);
  return dueDateOnly <= deadlineOnly;
}

/**
 * Strip time from a date for date-only comparisons
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Check if a task is effectively unblocked:
 * blocked_by is empty OR every blocked_by item has status = 'done'
 */
export function isTaskUnblocked(task: { blocked_by?: { status: string }[] }): boolean {
  if (!task.blocked_by || task.blocked_by.length === 0) return true;
  return task.blocked_by.every((b) => b.status === TaskStatus.done);
}

/**
 * Check if a task's project is active (in_progress, ready) or has no project
 */
export function isFromActiveProject(task: { project?: { status: string } | null }): boolean {
  if (!task.project) return true;
  return ACTIVE_PROJECT_STATUSES.includes(task.project.status as ProjectStatus);
}

export type Badge = 'overdue' | 'due_today' | 'due_tomorrow' | 'high_priority' | 'blocking_others' | 'blocking_others_urgent';

/**
 * Compute badge array for a task
 */
export function getActiveBadges(task: { due_date: Date | null; priority: number }, today: Date): Badge[] {
  const badges: Badge[] = [];
  const todayStart = startOfDay(today);

  if (task.due_date) {
    const dueStart = startOfDay(task.due_date);
    if (dueStart < todayStart) badges.push('overdue');
    else if (dueStart.getTime() === todayStart.getTime()) badges.push('due_today');
    else {
      const tomorrow = new Date(todayStart);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (dueStart.getTime() === tomorrow.getTime()) badges.push('due_tomorrow');
    }
  }

  if (task.priority <= 2) badges.push('high_priority');

  return badges;
}

/**
 * Calculate business days overdue (negative = not overdue)
 */
export function getDaysOverdue(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0;
  const todayStart = startOfDay(today);
  const dueStart = startOfDay(dueDate);
  if (dueStart >= todayStart) return 0;

  let days = 0;
  const cursor = new Date(dueStart);
  while (cursor < todayStart) {
    cursor.setDate(cursor.getDate() + 1);
    if (isBusinessDay(cursor)) days++;
  }
  return days;
}

/**
 * Calculate time_spent_minutes from time_entries
 */
export function calcTimeSpent(task: { time_entries?: { duration: number }[] }): number {
  if (!task.time_entries) return 0;
  return task.time_entries.reduce((sum, e) => sum + (e.duration || 0), 0);
}

/**
 * Standard Prisma include block for check-in queries
 */
export const CHECKIN_TASK_INCLUDE = {
  assignee: {
    select: { id: true, name: true },
  },
  project: {
    select: {
      id: true,
      name: true,
      status: true,
      client: { select: { id: true, name: true } },
    },
  },
  blocked_by: {
    where: { is_deleted: false },
    select: {
      id: true,
      title: true,
      status: true,
      assignee_id: true,
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, status: true } },
    },
  },
  blocking: {
    where: { is_deleted: false },
    select: {
      id: true,
      title: true,
      status: true,
      assignee_id: true,
      assignee: { select: { id: true, name: true } },
      due_date: true,
      project: { select: { id: true, name: true, status: true } },
    },
  },
  time_entries: {
    where: { is_deleted: false },
    select: { duration: true },
  },
} as const;
