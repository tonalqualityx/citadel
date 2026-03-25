/**
 * Charter Task Generator Service
 *
 * Automatically generates tasks for active charters based on their scheduled tasks.
 * Mirrors the pattern from maintenance-generator.ts.
 */

import { prisma } from '@/lib/db/prisma';
import { TaskStatus } from '@prisma/client';

export interface CharterGenerationResult {
  charterId: string;
  charterName: string;
  period: string;
  tasksCreated: number;
  tasksAbandoned: number;
}

export interface CharterGenerationSummary {
  totalChartersProcessed: number;
  totalTasksCreated: number;
  totalTasksAbandoned: number;
  results: CharterGenerationResult[];
  errors: { charterId: string; error: string }[];
}

type CharterCadence = 'weekly' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';

/**
 * Get the period string for a given date and cadence
 */
export function getCharterPeriodString(date: Date, cadence: CharterCadence): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  switch (cadence) {
    case 'weekly': {
      // ISO week number
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
    }
    case 'monthly':
      return `${year}-${month.toString().padStart(2, '0')}`;
    case 'quarterly': {
      const quarter = Math.ceil(month / 3);
      return `${year}-Q${quarter}`;
    }
    case 'semi_annually': {
      const half = month <= 6 ? 1 : 2;
      return `${year}-H${half}`;
    }
    case 'annually':
      return `${year}`;
    default:
      return `${year}-${month.toString().padStart(2, '0')}`;
  }
}

/**
 * Get the end date for a given period
 */
export function getCharterPeriodEndDate(periodString: string, cadence: CharterCadence): Date {
  const year = parseInt(periodString.slice(0, 4), 10);

  switch (cadence) {
    case 'weekly': {
      const weekNo = parseInt(periodString.slice(6), 10);
      // Find the first Thursday of the year, then offset to target week's Sunday
      const jan4 = new Date(year, 0, 4);
      const dayOfWeek = jan4.getDay() || 7;
      const firstMonday = new Date(year, 0, 4 - dayOfWeek + 1);
      const weekStart = new Date(firstMonday);
      weekStart.setDate(weekStart.getDate() + (weekNo - 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59);
      return weekEnd;
    }
    case 'monthly': {
      const month = parseInt(periodString.slice(5, 7), 10);
      return new Date(year, month, 0, 23, 59, 59);
    }
    case 'quarterly': {
      const quarter = parseInt(periodString.slice(6), 10);
      const endMonth = quarter * 3;
      return new Date(year, endMonth, 0, 23, 59, 59);
    }
    case 'semi_annually': {
      const half = parseInt(periodString.slice(6), 10);
      const endMonth = half === 1 ? 6 : 12;
      return new Date(year, endMonth, 0, 23, 59, 59);
    }
    case 'annually':
      return new Date(year, 12, 0, 23, 59, 59);
    default:
      return new Date(year, 12, 0, 23, 59, 59);
  }
}

/**
 * Check if a scheduled task is due for generation
 */
export async function isCharterTaskDue(
  charterId: string,
  scheduledTaskId: string,
  cadence: CharterCadence
): Promise<boolean> {
  const currentPeriod = getCharterPeriodString(new Date(), cadence);

  const existingLog = await prisma.charterGenerationLog.findUnique({
    where: {
      charter_id_scheduled_task_id_period: {
        charter_id: charterId,
        scheduled_task_id: scheduledTaskId,
        period: currentPeriod,
      },
    },
  });

  return !existingLog;
}

/**
 * Generate tasks for a specific charter
 */
export async function generateCharterTasks(charterId: string): Promise<CharterGenerationResult | null> {
  const charter = await prisma.charter.findUnique({
    where: { id: charterId },
    include: {
      client: true,
      scheduled_tasks: {
        where: { is_active: true },
        include: {
          sop: true,
          charter_ware: true,
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });

  if (!charter || charter.status !== 'active' || charter.is_deleted) {
    return null;
  }

  if (charter.scheduled_tasks.length === 0) {
    return null;
  }

  let totalCreated = 0;
  let totalAbandoned = 0;

  for (const scheduledTask of charter.scheduled_tasks) {
    const cadence = scheduledTask.cadence as CharterCadence;
    const currentPeriod = getCharterPeriodString(new Date(), cadence);

    const isDue = await isCharterTaskDue(charterId, scheduledTask.id, cadence);
    if (!isDue) continue;

    const dueDate = getCharterPeriodEndDate(currentPeriod, cadence);

    const result = await prisma.$transaction(async (tx) => {
      // Mark old incomplete tasks from this scheduled task as abandoned
      const previousTasks = await tx.task.findMany({
        where: {
          charter_id: charterId,
          sop_id: scheduledTask.sop_id,
          status: { notIn: ['done', 'abandoned'] },
          maintenance_period: { not: currentPeriod },
        },
      });

      let abandoned = 0;
      if (previousTasks.length > 0) {
        const updateResult = await tx.task.updateMany({
          where: { id: { in: previousTasks.map((t) => t.id) } },
          data: { status: TaskStatus.abandoned, updated_at: new Date() },
        });
        abandoned = updateResult.count;
      }

      const sop = scheduledTask.sop;
      if (!sop.is_active) {
        // Still log even if SOP is inactive, to prevent re-checking
        await tx.charterGenerationLog.create({
          data: {
            charter_id: charterId,
            scheduled_task_id: scheduledTask.id,
            period: currentPeriod,
            tasks_created: 0,
            tasks_abandoned: abandoned,
          },
        });
        return { created: 0, abandoned };
      }

      await tx.task.create({
        data: {
          title: sop.title,
          description: sop.content ? JSON.stringify(sop.content) : null,
          status: 'not_started',
          priority: sop.default_priority,
          client_id: charter.client_id,
          charter_id: charterId,
          sop_id: sop.id,
          function_id: sop.function_id,
          energy_estimate: sop.energy_estimate,
          mystery_factor: sop.mystery_factor,
          battery_impact: sop.battery_impact,
          estimated_minutes: sop.estimated_minutes,
          needs_review: sop.needs_review,
          requirements: sop.template_requirements as object | undefined,
          review_requirements: sop.review_requirements as object | undefined,
          is_maintenance_task: false,
          maintenance_period: currentPeriod,
          due_date: dueDate,
          is_billable: true,
          is_retainer_work: true,
        },
      });

      await tx.charterGenerationLog.create({
        data: {
          charter_id: charterId,
          scheduled_task_id: scheduledTask.id,
          period: currentPeriod,
          tasks_created: 1,
          tasks_abandoned: abandoned,
        },
      });

      return { created: 1, abandoned };
    });

    totalCreated += result.created;
    totalAbandoned += result.abandoned;
  }

  if (totalCreated === 0 && totalAbandoned === 0) {
    return null;
  }

  return {
    charterId,
    charterName: charter.name,
    period: getCharterPeriodString(new Date(), charter.scheduled_tasks[0].cadence as CharterCadence),
    tasksCreated: totalCreated,
    tasksAbandoned: totalAbandoned,
  };
}

/**
 * Generate tasks for all active charters that are due
 */
export async function generateAllDueCharterTasks(): Promise<CharterGenerationSummary> {
  const summary: CharterGenerationSummary = {
    totalChartersProcessed: 0,
    totalTasksCreated: 0,
    totalTasksAbandoned: 0,
    results: [],
    errors: [],
  };

  const charters = await prisma.charter.findMany({
    where: {
      is_deleted: false,
      status: 'active',
      scheduled_tasks: {
        some: { is_active: true },
      },
    },
  });

  for (const charter of charters) {
    try {
      const result = await generateCharterTasks(charter.id);
      if (result) {
        summary.results.push(result);
        summary.totalTasksCreated += result.tasksCreated;
        summary.totalTasksAbandoned += result.tasksAbandoned;
        summary.totalChartersProcessed++;
      }
    } catch (error) {
      summary.errors.push({
        charterId: charter.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return summary;
}
