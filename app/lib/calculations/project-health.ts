import { prisma } from '@/lib/db/prisma';

export interface ProjectHealth {
  projectId: string;
  overallScore: number; // 0-100
  indicators: {
    tasksOnTrack: number; // % of tasks not blocked/overdue
    estimateAccuracy: number; // Estimated vs actual time
    velocityTrend: number; // Recent completion rate
    blockageLevel: number; // % of tasks blocked
  };
  status: 'healthy' | 'at-risk' | 'critical';
  alerts: string[];
}

/**
 * Calculate health metrics for a project
 */
export async function calculateProjectHealth(projectId: string): Promise<ProjectHealth> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      tasks: {
        where: { is_deleted: false },
        select: {
          id: true,
          status: true,
          due_date: true,
          estimated_minutes: true,
          time_entries: {
            where: { is_deleted: false },
            select: { duration: true },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const tasks = project.tasks;
  const totalTasks = tasks.length;
  const alerts: string[] = [];

  // No tasks = healthy by default
  if (totalTasks === 0) {
    return {
      projectId,
      overallScore: 100,
      indicators: {
        tasksOnTrack: 100,
        estimateAccuracy: 100,
        velocityTrend: 100,
        blockageLevel: 0,
      },
      status: 'healthy',
      alerts: [],
    };
  }

  const now = new Date();

  // Count blocked and overdue tasks
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
  const overdueTasks = tasks.filter(
    (t) => t.due_date && new Date(t.due_date) < now && t.status !== 'done' && t.status !== 'abandoned'
  ).length;
  const completedTasks = tasks.filter((t) => t.status === 'done').length;

  // Tasks on track (not blocked, not overdue)
  const tasksOnTrack = Math.round(
    ((totalTasks - blockedTasks - overdueTasks) / totalTasks) * 100
  );

  if (blockedTasks > 0) {
    alerts.push(`${blockedTasks} task${blockedTasks > 1 ? 's are' : ' is'} blocked`);
  }
  if (overdueTasks > 0) {
    alerts.push(`${overdueTasks} task${overdueTasks > 1 ? 's are' : ' is'} overdue`);
  }

  // Estimate accuracy (compare estimated vs actual time)
  let estimateAccuracy = 100;
  const tasksWithEstimates = tasks.filter((t) => t.estimated_minutes && t.estimated_minutes > 0);

  if (tasksWithEstimates.length > 0) {
    const completedWithEstimates = tasksWithEstimates.filter((t) => t.status === 'done');

    if (completedWithEstimates.length > 0) {
      const totalEstimated = completedWithEstimates.reduce(
        (sum, t) => sum + (t.estimated_minutes || 0),
        0
      );
      const totalActual = completedWithEstimates.reduce(
        (sum, t) => sum + t.time_entries.reduce((s, e) => s + e.duration, 0),
        0
      );

      if (totalActual > 0 && totalEstimated > 0) {
        const ratio = totalEstimated / totalActual;
        // Score based on how close ratio is to 1.0
        // If ratio is 1.0, accuracy is 100%
        // If ratio is 0.5 or 2.0, accuracy is ~50%
        estimateAccuracy = Math.max(0, Math.min(100, 100 - Math.abs(1 - ratio) * 50));
      }
    }
  }

  // Velocity trend (completion rate in recent period)
  const recentTasks = tasks.filter((t) => {
    if (t.status !== 'done') return false;
    // Consider tasks completed in last 30 days
    return true; // Simplified - would need completed_at field for accurate tracking
  });
  const velocityTrend = totalTasks > 0
    ? Math.round((completedTasks / totalTasks) * 100)
    : 100;

  // Blockage level
  const blockageLevel = Math.round((blockedTasks / totalTasks) * 100);

  // Calculate overall score (weighted average)
  const overallScore = Math.round(
    tasksOnTrack * 0.4 +
    estimateAccuracy * 0.3 +
    (100 - blockageLevel) * 0.2 +
    velocityTrend * 0.1
  );

  // Determine status
  let status: ProjectHealth['status'] = 'healthy';
  if (overallScore < 50) {
    status = 'critical';
  } else if (overallScore < 75) {
    status = 'at-risk';
  }

  return {
    projectId,
    overallScore,
    indicators: {
      tasksOnTrack,
      estimateAccuracy: Math.round(estimateAccuracy),
      velocityTrend,
      blockageLevel,
    },
    status,
    alerts,
  };
}

/**
 * Get health for multiple projects
 */
export async function getProjectsHealth(projectIds: string[]): Promise<Map<string, ProjectHealth>> {
  const healthMap = new Map<string, ProjectHealth>();

  const results = await Promise.all(
    projectIds.map(async (id) => {
      try {
        const health = await calculateProjectHealth(id);
        return { id, health };
      } catch {
        return null;
      }
    })
  );

  for (const result of results) {
    if (result) {
      healthMap.set(result.id, result.health);
    }
  }

  return healthMap;
}
