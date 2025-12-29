import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { getStartOfWeek } from '@/lib/utils/time';
import { ProjectStatus, TaskStatus } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const role = auth.role;

    // Base data all roles need
    const baseData = await getBaseData(auth.userId);

    if (role === 'tech') {
      return NextResponse.json({
        role,
        ...baseData,
        ...(await getTechDashboard(auth.userId)),
      });
    }

    if (role === 'pm') {
      return NextResponse.json({
        role,
        ...baseData,
        ...(await getPmDashboard(auth.userId)),
      });
    }

    if (role === 'admin') {
      return NextResponse.json({
        role,
        ...baseData,
        ...(await getAdminDashboard(auth.userId)),
      });
    }

    return NextResponse.json({ role, ...baseData });
  } catch (error) {
    return handleApiError(error);
  }
}

async function getBaseData(userId: string) {
  const [activeTimer, recentTimeEntries] = await Promise.all([
    prisma.timeEntry.findFirst({
      where: { user_id: userId, is_running: true, is_deleted: false },
      include: {
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.timeEntry.findMany({
      where: { user_id: userId, is_deleted: false },
      orderBy: { started_at: 'desc' },
      take: 5,
      include: {
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    activeTimer: activeTimer
      ? {
          id: activeTimer.id,
          started_at: activeTimer.started_at.toISOString(),
          task: activeTimer.task,
          project: activeTimer.project,
        }
      : null,
    recentTimeEntries: recentTimeEntries.map((entry) => ({
      id: entry.id,
      started_at: entry.started_at.toISOString(),
      duration: entry.duration,
      description: entry.description,
      task: entry.task,
      project: entry.project,
    })),
  };
}

async function getTechDashboard(userId: string) {
  const visibleStatuses: ProjectStatus[] = [
    ProjectStatus.ready,
    ProjectStatus.in_progress,
    ProjectStatus.review,
    ProjectStatus.done,
  ];

  // My tasks from visible projects + ad-hoc tasks
  const myTasks = await prisma.task.findMany({
    where: {
      assignee_id: userId,
      is_deleted: false,
      OR: [{ project_id: null }, { project: { status: { in: visibleStatuses } } }],
      status: { notIn: ['done', 'abandoned'] },
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          status: true,
          client: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    take: 20,
  });

  // Format tasks
  const formattedTasks = myTasks.map((t) => ({
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
    project: t.project,
  }));

  // Upcoming tasks (by due date)
  const upcomingTasks = formattedTasks
    .filter((t) => t.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
    .slice(0, 5);

  // Blocked tasks
  const blockedTasks = formattedTasks.filter((t) => t.status === 'blocked');

  // In progress tasks
  const inProgressTasks = formattedTasks.filter((t) => t.status === 'in_progress');

  // Time this week
  const weekStart = getStartOfWeek();
  const timeThisWeek = await prisma.timeEntry.aggregate({
    where: {
      user_id: userId,
      is_deleted: false,
      started_at: { gte: weekStart },
    },
    _sum: { duration: true },
  });

  // Time today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const timeToday = await prisma.timeEntry.aggregate({
    where: {
      user_id: userId,
      is_deleted: false,
      started_at: { gte: today },
    },
    _sum: { duration: true },
  });

  return {
    myTasks: formattedTasks,
    upcomingTasks,
    blockedTasks,
    inProgressTasks,
    timeThisWeekMinutes: timeThisWeek._sum.duration || 0,
    timeTodayMinutes: timeToday._sum.duration || 0,
  };
}

async function getPmDashboard(userId: string) {
  // Focus tasks - tasks flagged for focus by the current user
  const focusTasks = await prisma.task.findMany({
    where: {
      is_deleted: false,
      is_focus: true,
      assignee_id: userId,
      status: { notIn: ['done', 'abandoned'] },
    },
    include: {
      assignee: { select: { id: true, name: true } },
      project: {
        select: {
          id: true,
          name: true,
          client: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
    take: 10,
  });

  // Awaiting review - tasks that are done but need review and aren't approved yet
  const awaitingReview = await prisma.task.findMany({
    where: {
      is_deleted: false,
      status: 'done',
      needs_review: true,
      approved: false,
    },
    include: {
      assignee: { select: { id: true, name: true } },
      project: {
        select: {
          id: true,
          name: true,
          client: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
      time_entries: {
        where: { is_deleted: false },
        select: { duration: true },
      },
    },
    orderBy: { updated_at: 'asc' },
    take: 10,
  });

  // Unassigned tasks in active projects
  const unassignedTasks = await prisma.task.findMany({
    where: {
      is_deleted: false,
      assignee_id: null,
      status: { notIn: ['done', 'abandoned'] },
      project: { status: { in: ['ready', 'in_progress'] } },
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          client: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    take: 10,
  });

  // My tasks - tasks assigned to current user (not done/abandoned)
  const myTasks = await prisma.task.findMany({
    where: {
      is_deleted: false,
      assignee_id: userId,
      status: { notIn: ['done', 'abandoned'] },
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          status: true,
          client: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    take: 20,
  });

  // My projects (assigned via team assignments)
  const myProjects = await prisma.project.findMany({
    where: {
      is_deleted: false,
      status: { in: ['ready', 'in_progress', 'review'] },
      team_assignments: { some: { user_id: userId } },
    },
    include: {
      client: { select: { id: true, name: true } },
      _count: {
        select: {
          tasks: {
            where: { is_deleted: false, status: { notIn: ['done', 'abandoned'] } },
          },
        },
      },
    },
    orderBy: { updated_at: 'desc' },
    take: 10,
  });

  // Retainer alerts (clients near limit)
  const retainerAlerts = await getRetainerAlerts();

  // Recent task completions
  const recentCompletions = await prisma.task.findMany({
    where: {
      is_deleted: false,
      status: 'done',
      completed_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    include: {
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: { completed_at: 'desc' },
    take: 5,
  });

  return {
    focusTasks: focusTasks.map((t) => ({
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
      assignee: t.assignee,
      project: t.project,
    })),
    awaitingReview: awaitingReview.map((t) => ({
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
      time_logged_minutes: t.time_entries.reduce((sum, e) => sum + e.duration, 0),
      needs_review: t.needs_review,
      approved: t.approved,
      assignee: t.assignee,
      project: t.project,
      updated_at: t.updated_at.toISOString(),
    })),
    unassignedTasks: unassignedTasks.map((t) => ({
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
      project: t.project,
    })),
    myTasks: myTasks.map((t) => ({
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
      project: t.project,
    })),
    myProjects: myProjects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      client: p.client,
      taskCount: p._count.tasks,
    })),
    retainerAlerts,
    recentCompletions: recentCompletions.map((t) => ({
      id: t.id,
      title: t.title,
      assignee: t.assignee,
      project: t.project,
      completed_at: t.completed_at?.toISOString(),
    })),
  };
}

async function getAdminDashboard(userId: string) {
  // Get all PM dashboard data
  const pmData = await getPmDashboard(userId);

  // All active projects
  const allActiveProjects = await prisma.project.findMany({
    where: {
      is_deleted: false,
      status: { in: ['ready', 'in_progress', 'review'] },
    },
    include: {
      client: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      _count: {
        select: {
          tasks: {
            where: { is_deleted: false, status: { notIn: ['done', 'abandoned'] } },
          },
        },
      },
    },
    orderBy: { updated_at: 'desc' },
  });

  // Team utilization (simple version)
  const teamUtilization = await getTeamUtilization();

  // System stats
  const systemStats = await getSystemStats();

  return {
    ...pmData,
    allActiveProjects: allActiveProjects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      client: p.client,
      site: p.site,
      taskCount: p._count.tasks,
    })),
    teamUtilization,
    systemStats,
  };
}

// Helper functions
async function getRetainerAlerts() {
  // Find clients with retainer hours where usage is > 80%
  // This is a simplified implementation
  const clients = await prisma.client.findMany({
    where: {
      is_deleted: false,
      retainer_hours: { gt: 0 },
    },
    select: {
      id: true,
      name: true,
      retainer_hours: true,
    },
  });

  const alerts = [];
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  for (const client of clients) {
    const timeUsed = await prisma.timeEntry.aggregate({
      where: {
        is_deleted: false,
        started_at: { gte: monthStart },
        project: { client_id: client.id },
      },
      _sum: { duration: true },
    });

    const usedMinutes = timeUsed._sum.duration || 0;
    const retainerHours = client.retainer_hours ? Number(client.retainer_hours) : 0;
    const retainerMinutes = retainerHours * 60;
    const percentUsed = retainerMinutes > 0 ? (usedMinutes / retainerMinutes) * 100 : 0;

    if (percentUsed >= 80) {
      alerts.push({
        client_id: client.id,
        client_name: client.name,
        retainer_hours: retainerHours,
        used_minutes: usedMinutes,
        percent_used: Math.round(percentUsed),
      });
    }
  }

  return alerts.sort((a, b) => b.percent_used - a.percent_used);
}

async function getTeamUtilization() {
  const weekStart = getStartOfWeek();

  // Get all users with time entries this week
  const users = await prisma.user.findMany({
    where: {
      is_active: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  const utilization = [];

  for (const user of users) {
    const timeThisWeek = await prisma.timeEntry.aggregate({
      where: {
        user_id: user.id,
        is_deleted: false,
        started_at: { gte: weekStart },
      },
      _sum: { duration: true },
    });

    const totalMinutes = timeThisWeek._sum.duration || 0;
    if (totalMinutes > 0) {
      utilization.push({
        user_id: user.id,
        user_name: user.name,
        minutes_this_week: totalMinutes,
        hours_this_week: Math.round((totalMinutes / 60) * 10) / 10,
      });
    }
  }

  return utilization.sort((a, b) => b.minutes_this_week - a.minutes_this_week);
}

async function getSystemStats() {
  const [
    activeProjectCount,
    openTaskCount,
    activeUserCount,
    totalTimeThisMonth,
  ] = await Promise.all([
    prisma.project.count({
      where: { is_deleted: false, status: { in: ['ready', 'in_progress', 'review'] } },
    }),
    prisma.task.count({
      where: { is_deleted: false, status: { notIn: ['done', 'abandoned'] } },
    }),
    prisma.user.count({
      where: { is_active: true },
    }),
    prisma.timeEntry.aggregate({
      where: {
        is_deleted: false,
        started_at: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
      _sum: { duration: true },
    }),
  ]);

  return {
    activeProjectCount,
    openTaskCount,
    activeUserCount,
    totalTimeThisMonthMinutes: totalTimeThisMonth._sum.duration || 0,
  };
}
