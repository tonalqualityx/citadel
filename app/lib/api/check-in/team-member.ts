import { prisma } from '@/lib/db/prisma';
import { TaskStatus } from '@prisma/client';
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

interface CheckInUser {
  id: string;
  name: string;
}

export async function buildTeamMemberCheckIn(user: CheckInUser) {
  const today = new Date();
  const todayStart = startOfDay(today);

  // Step 1: Fetch all active, non-deleted tasks for this user
  const tasks = await prisma.task.findMany({
    where: {
      assignee_id: user.id,
      is_deleted: false,
      status: { notIn: [TaskStatus.done, TaskStatus.abandoned] },
    },
    include: CHECKIN_TASK_INCLUDE,
    orderBy: [{ priority: 'asc' }, { due_date: 'asc' }, { title: 'asc' }],
  });

  // Step 1b: Project status filter — keep only active projects or null
  const activeTasks = tasks.filter(isFromActiveProject);

  // Step 2: Classify
  const readyToWork: any[] = [];
  const upcomingBlocked: any[] = [];

  for (const task of activeTasks) {
    const unblocked = isTaskUnblocked(task) && task.status !== TaskStatus.blocked;

    if (unblocked) {
      // Ready to work
      const badges = getActiveBadges(task, today);
      const daysOverdue = getDaysOverdue(task.due_date, today);

      readyToWork.push({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        estimated_minutes: task.estimated_minutes,
        due_date: task.due_date,
        project: task.project ? { id: task.project.id, name: task.project.name } : null,
        badges,
        days_overdue: daysOverdue > 0 ? daysOverdue : undefined,
        time_spent_minutes: calcTimeSpent(task),
      });
    } else {
      // Blocked — apply 5 business day filter
      if (!isWithinBusinessDays(task.due_date, 5, today)) continue;

      // Gather waiting_on from incomplete blockers
      const waitingOn = (task.blocked_by || [])
        .filter((b: any) => b.status !== TaskStatus.done)
        .map((b: any) => ({
          user: b.assignee?.name || 'Unassigned',
          task: b.title,
        }));

      upcomingBlocked.push({
        id: task.id,
        title: task.title,
        priority: task.priority,
        due_date: task.due_date,
        project_id: task.project_id,
        project: task.project ? { id: task.project.id, name: task.project.name } : null,
        waiting_on: waitingOn,
      });
    }
  }

  // Step 3: Sort ready_to_work — overdue first, then due_today, then priority, then due_date
  readyToWork.sort((a, b) => {
    // Overdue first
    const aOverdue = a.badges.includes('overdue') ? 0 : 1;
    const bOverdue = b.badges.includes('overdue') ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;

    // Due today next
    const aDueToday = a.badges.includes('due_today') ? 0 : 1;
    const bDueToday = b.badges.includes('due_today') ? 0 : 1;
    if (aDueToday !== bDueToday) return aDueToday - bDueToday;

    // Priority (lower = higher priority)
    if (a.priority !== b.priority) return a.priority - b.priority;

    // Due date ASC (null last)
    const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    if (aDate !== bDate) return aDate - bDate;

    // Title
    return (a.title || '').localeCompare(b.title || '');
  });

  // Step 3b: Consolidate blocked tasks by project
  const blockedByProject = new Map<string | null, any[]>();
  for (const task of upcomingBlocked) {
    const key = task.project_id || null;
    if (!blockedByProject.has(key)) blockedByProject.set(key, []);
    blockedByProject.get(key)!.push(task);
  }

  const individual: any[] = [];
  const consolidated: any[] = [];

  for (const [projectId, projectTasks] of blockedByProject) {
    if (projectTasks.length <= 2) {
      // Return individually
      for (const t of projectTasks) {
        individual.push({
          id: t.id,
          title: t.title,
          priority: t.priority,
          due_date: t.due_date,
          project: t.project,
          waiting_on: t.waiting_on,
        });
      }
    } else {
      // Consolidate
      const allWaitingOn = new Map<string, { user: string; tasks: string[] }>();
      for (const t of projectTasks) {
        for (const w of t.waiting_on) {
          if (!allWaitingOn.has(w.user)) {
            allWaitingOn.set(w.user, { user: w.user, tasks: [] });
          }
          allWaitingOn.get(w.user)!.tasks.push(w.task);
        }
      }

      const waitingOnSummary = Array.from(allWaitingOn.values()).map((w) => ({
        user: w.user,
        task_count: w.tasks.length,
        sample_task: w.tasks[0],
      }));

      consolidated.push({
        project: projectTasks[0].project,
        task_count: projectTasks.length,
        sample_titles: projectTasks.slice(0, 2).map((t: any) => t.title),
        waiting_on: waitingOnSummary,
      });
    }
  }

  // Sort individual blocked by priority, then due_date
  individual.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return aDate - bDate;
  });

  return {
    variant: 'team_member' as const,
    user: { id: user.id, name: user.name },
    generated_at: new Date().toISOString(),
    ready_to_work: readyToWork,
    upcoming_blocked: {
      individual,
      consolidated,
    },
  };
}
