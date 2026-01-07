import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { ProjectStatus, TaskStatus } from '@prisma/client';

const PAGE_SIZE = 10;

// Non-readonly arrays for Prisma compatibility
const INCOMPLETE_STATUSES: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned];
const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [ProjectStatus.ready, ProjectStatus.in_progress];

// For "My Tasks" lists, also exclude blocked tasks - users shouldn't work on blocked tasks
const MY_TASKS_EXCLUDED_STATUSES: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned, TaskStatus.blocked];

type ListType = 'myTasks' | 'focusTasks' | 'awaitingReview' | 'unassignedTasks';

// Valid sort options for My Tasks
function getTaskOrderBy(sortBy: string): any[] {
  switch (sortBy) {
    case 'due_date':
      // Sort by due date ascending (nulls last), then by priority
      return [{ due_date: { sort: 'asc', nulls: 'last' } }, { priority: 'asc' }];
    case 'estimate':
      // Sort by estimated minutes descending (largest first, nulls last), then by priority
      return [{ estimated_minutes: { sort: 'desc', nulls: 'last' } }, { priority: 'asc' }];
    case 'priority':
    default:
      // Default: priority first, then creation date
      return [{ priority: 'asc' }, { created_at: 'asc' }];
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    const list = searchParams.get('list') as ListType;
    const skip = parseInt(searchParams.get('skip') || '0', 10);
    const take = parseInt(searchParams.get('take') || String(PAGE_SIZE), 10);
    const orderBy = searchParams.get('orderBy') || 'priority';

    if (!list) {
      return NextResponse.json({ error: 'Missing list parameter' }, { status: 400 });
    }

    const validLists: ListType[] = ['myTasks', 'focusTasks', 'awaitingReview', 'unassignedTasks'];
    if (!validLists.includes(list)) {
      return NextResponse.json({ error: 'Invalid list parameter' }, { status: 400 });
    }

    const result = await getListItems(auth.userId, auth.role, list, skip, take, orderBy);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

async function getListItems(
  userId: string,
  role: string,
  list: ListType,
  skip: number,
  take: number,
  orderBy: string = 'priority'
) {
  const taskInclude = {
    assignee: { select: { id: true, name: true } },
    project: {
      select: {
        id: true,
        name: true,
        status: true,
        client: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
      },
    },
    time_entries: {
      where: { is_deleted: false },
      select: { duration: true },
    },
  };

  const formatTask = (t: any) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    is_focus: t.is_focus,
    due_date: t.due_date?.toISOString() || null,
    energy_estimate: t.energy_estimate,
    mystery_factor: t.mystery_factor,
    battery_impact: t.battery_impact,
    estimated_minutes: t.estimated_minutes,
    time_logged_minutes: t.time_entries?.reduce((sum: number, e: { duration: number }) => sum + e.duration, 0) || 0,
    needs_review: t.needs_review,
    approved: t.approved,
    assignee: t.assignee,
    project: t.project,
    updated_at: t.updated_at?.toISOString(),
  });

  switch (list) {
    case 'myTasks': {
      const visibleStatuses: ProjectStatus[] = [
        ProjectStatus.ready,
        ProjectStatus.in_progress,
        ProjectStatus.review,
        ProjectStatus.done,
      ];

      const where = role === 'tech'
        ? {
            assignee_id: userId,
            is_deleted: false,
            OR: [{ project_id: null }, { project: { status: { in: visibleStatuses } } }],
            status: { notIn: MY_TASKS_EXCLUDED_STATUSES },
            // Exclude tasks with incomplete blockers (all non-deleted blockers must be done)
            blocked_by: { none: { status: { not: TaskStatus.done }, is_deleted: false } },
          }
        : {
            is_deleted: false,
            assignee_id: userId,
            status: { notIn: MY_TASKS_EXCLUDED_STATUSES },
            OR: [{ project_id: null }, { project: { status: ProjectStatus.in_progress } }],
            // Exclude tasks with incomplete blockers (all non-deleted blockers must be done)
            blocked_by: { none: { status: { not: TaskStatus.done }, is_deleted: false } },
          };

      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where,
          include: taskInclude,
          orderBy: getTaskOrderBy(orderBy),
          skip,
          take: take + 1,
        }),
        prisma.task.count({ where }),
      ]);

      const hasMore = tasks.length > take;
      return {
        items: tasks.slice(0, take).map(formatTask),
        total,
        hasMore,
      };
    }

    case 'focusTasks': {
      const where = {
        is_deleted: false,
        is_focus: true,
        assignee_id: userId,
        status: { notIn: MY_TASKS_EXCLUDED_STATUSES },
        // Exclude tasks with incomplete blockers (all non-deleted blockers must be done)
        blocked_by: { none: { status: { not: TaskStatus.done }, is_deleted: false } },
      };

      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where,
          include: taskInclude,
          orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
          skip,
          take: take + 1,
        }),
        prisma.task.count({ where }),
      ]);

      const hasMore = tasks.length > take;
      return {
        items: tasks.slice(0, take).map(formatTask),
        total,
        hasMore,
      };
    }

    case 'awaitingReview': {
      const where = {
        is_deleted: false,
        status: TaskStatus.done,
        needs_review: true,
        approved: false,
      };

      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where,
          include: taskInclude,
          orderBy: { updated_at: 'asc' },
          skip,
          take: take + 1,
        }),
        prisma.task.count({ where }),
      ]);

      const hasMore = tasks.length > take;
      return {
        items: tasks.slice(0, take).map(formatTask),
        total,
        hasMore,
      };
    }

    case 'unassignedTasks': {
      const where = {
        is_deleted: false,
        assignee_id: null,
        status: { notIn: INCOMPLETE_STATUSES },
        project: { status: { in: ACTIVE_PROJECT_STATUSES } },
        // Exclude tasks with incomplete blockers (all non-deleted blockers must be done)
        blocked_by: { none: { status: { not: TaskStatus.done }, is_deleted: false } },
      };

      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where,
          include: taskInclude,
          orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
          skip,
          take: take + 1,
        }),
        prisma.task.count({ where }),
      ]);

      const hasMore = tasks.length > take;
      return {
        items: tasks.slice(0, take).map(formatTask),
        total,
        hasMore,
      };
    }

    default:
      throw new Error(`Unknown list type: ${list}`);
  }
}
