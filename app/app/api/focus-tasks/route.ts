import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatTaskResponse } from '@/lib/api/formatters';
import { TaskStatus } from '@prisma/client';

// Statuses to exclude from focus tasks (same as dashboard)
const MY_TASKS_EXCLUDED_STATUSES: TaskStatus[] = [
  TaskStatus.done,
  TaskStatus.abandoned,
  TaskStatus.blocked,
];

/**
 * GET /api/focus-tasks?assignee_id={id}
 *
 * Returns focus tasks for a specific user, matching the dashboard's Focus view logic.
 * This endpoint properly filters out tasks with incomplete blockers.
 *
 * Query parameters:
 * - assignee_id: UUID of the user (optional for PM/Admin, defaults to self)
 * - limit: Number of tasks to return (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const assigneeIdParam = searchParams.get('assignee_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Determine which user's focus tasks to fetch
    // - Tech users can only see their own focus tasks
    // - PM/Admin can view any user's focus tasks via assignee_id param
    let targetUserId: string;

    if (auth.role === 'tech') {
      // Tech users are restricted to their own tasks
      if (assigneeIdParam && assigneeIdParam !== auth.userId) {
        return NextResponse.json(
          { error: 'Tech users can only view their own focus tasks' },
          { status: 403 }
        );
      }
      targetUserId = auth.userId;
    } else {
      // PM/Admin can query any user's focus tasks
      targetUserId = assigneeIdParam || auth.userId;
    }

    // Validate limit
    const validatedLimit = Math.min(Math.max(limit, 1), 100);

    // Focus tasks where clause - EXACTLY matches dashboard logic
    const focusTasksWhere = {
      is_deleted: false,
      is_focus: true,
      assignee_id: targetUserId,
      status: { notIn: MY_TASKS_EXCLUDED_STATUSES },
      // Exclude tasks with incomplete blockers (all non-deleted blockers must be done)
      blocked_by: {
        none: { status: { not: TaskStatus.done }, is_deleted: false },
      },
    };

    // Fetch focus tasks with the same includes as dashboard
    const [focusTasks, total] = await Promise.all([
      prisma.task.findMany({
        where: focusTasksWhere,
        include: {
          assignee: {
            select: { id: true, name: true, email: true, avatar_url: true },
          },
          client: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
          project: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true } },
              site: { select: { id: true, name: true } },
            },
          },
          reviewer: {
            select: { id: true, name: true, email: true, avatar_url: true },
          },
          approved_by: { select: { id: true, name: true } },
          function: { select: { id: true, name: true } },
          sop: { select: { id: true, title: true } },
          created_by: { select: { id: true, name: true } },
          blocked_by: {
            select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } } },
          },
          blocking: {
            select: { id: true, title: true, status: true, assignee_id: true, assignee: { select: { id: true, name: true } } },
          },
          time_entries: {
            where: { is_deleted: false },
            select: { duration: true },
          },
        },
        // Same orderBy as dashboard
        orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
        take: validatedLimit,
      }),
      prisma.task.count({ where: focusTasksWhere }),
    ]);

    // Format tasks using the same formatter as other endpoints
    const formattedTasks = focusTasks.map(formatTaskResponse);

    return NextResponse.json({
      tasks: formattedTasks,
      total,
      limit: validatedLimit,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
