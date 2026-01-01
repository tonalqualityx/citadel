import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;
    const { searchParams } = new URL(request.url);

    // Filters
    const projectStatus = searchParams.get('project_status'); // 'open' | 'completed' | 'all'
    const taskType = searchParams.get('task_type'); // 'support' | 'billable' | 'all'
    const taskStatus = searchParams.get('task_status'); // 'open' | 'completed' | 'all'

    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id, is_deleted: false },
      select: { id: true, name: true },
    });

    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    // Build project filter
    const projectWhere: any = {
      client_id: id,
      is_deleted: false,
    };

    if (projectStatus === 'open') {
      projectWhere.status = { in: ['quote', 'queue', 'ready', 'in_progress', 'review'] };
    } else if (projectStatus === 'completed') {
      projectWhere.status = { in: ['done', 'cancelled'] };
    }

    // Fetch projects
    const projects = await prisma.project.findMany({
      where: projectWhere,
      select: {
        id: true,
        name: true,
        status: true,
        type: true,
        target_date: true,
        _count: {
          select: {
            tasks: { where: { is_deleted: false } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
      take: 50,
    });

    // Build task filter
    const taskWhere: any = {
      client_id: id,
      is_deleted: false,
    };

    if (taskType === 'support') {
      taskWhere.is_support = true;
    } else if (taskType === 'billable') {
      taskWhere.is_support = false;
      taskWhere.is_billable = true;
    }

    if (taskStatus === 'open') {
      taskWhere.status = { in: ['not_started', 'in_progress', 'review', 'blocked'] };
    } else if (taskStatus === 'completed') {
      taskWhere.status = { in: ['done', 'abandoned'] };
    }

    // Fetch tasks
    const tasks = await prisma.task.findMany({
      where: taskWhere,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        is_support: true,
        is_billable: true,
        due_date: true,
        completed_at: true,
        project: {
          select: { id: true, name: true },
        },
        assignee: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { updated_at: 'desc' }],
      take: 100,
    });

    // Calculate stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [openProjectsCount, openTasksCount, supportTasksThisMonth] = await Promise.all([
      prisma.project.count({
        where: {
          client_id: id,
          is_deleted: false,
          status: { in: ['quote', 'queue', 'ready', 'in_progress', 'review'] },
        },
      }),
      prisma.task.count({
        where: {
          client_id: id,
          is_deleted: false,
          status: { in: ['not_started', 'in_progress', 'review', 'blocked'] },
        },
      }),
      prisma.task.count({
        where: {
          client_id: id,
          is_deleted: false,
          is_support: true,
          created_at: { gte: startOfMonth },
        },
      }),
    ]);

    return NextResponse.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        type: p.type,
        target_date: p.target_date,
        task_count: p._count.tasks,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        is_support: t.is_support,
        is_billable: t.is_billable,
        due_date: t.due_date,
        completed_at: t.completed_at,
        project: t.project ? { id: t.project.id, name: t.project.name } : null,
        assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      })),
      stats: {
        open_projects: openProjectsCount,
        open_tasks: openTasksCount,
        support_tasks_this_month: supportTasksThisMonth,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
