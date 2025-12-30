import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

/**
 * GET /api/dashboard/timeclock-issues
 * Returns timeclock issues for the current user:
 * 1. Completed tasks with no time tracked (and not marked as no_time_needed)
 * 2. Running time entries with no end time
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    // Find completed tasks assigned to user with no time entries
    const completedTasksNoTime = await prisma.task.findMany({
      where: {
        assignee_id: auth.userId,
        status: 'done',
        is_deleted: false,
        no_time_needed: false,
        time_entries: {
          none: {},
        },
      },
      select: {
        id: true,
        title: true,
        completed_at: true,
        project: {
          select: {
            id: true,
            name: true,
            client: {
              select: { id: true, name: true },
            },
          },
        },
        client: {
          select: { id: true, name: true },
        },
      },
      orderBy: { completed_at: 'desc' },
      take: 10,
    });

    // Find running time entries for this user
    const runningTimers = await prisma.timeEntry.findMany({
      where: {
        user_id: auth.userId,
        is_running: true,
        is_deleted: false,
      },
      select: {
        id: true,
        started_at: true,
        description: true,
        task: {
          select: {
            id: true,
            title: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { started_at: 'asc' },
    });

    return NextResponse.json({
      completedTasksNoTime: completedTasksNoTime.map((task) => ({
        id: task.id,
        title: task.title,
        completed_at: task.completed_at,
        project: task.project,
        client: task.client || task.project?.client || null,
      })),
      runningTimers: runningTimers.map((entry) => ({
        id: entry.id,
        started_at: entry.started_at,
        description: entry.description,
        task: entry.task,
        project: entry.project,
      })),
      hasIssues: completedTasksNoTime.length > 0 || runningTimers.length > 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
