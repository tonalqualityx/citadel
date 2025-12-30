/**
 * Maintenance Task Generator Service
 *
 * Automatically generates maintenance tasks for sites based on their maintenance plan.
 */

import { prisma } from '@/lib/db/prisma';
import { MaintenanceFrequency, TaskStatus } from '@prisma/client';

export interface GenerationResult {
  siteId: string;
  siteName: string;
  period: string;
  tasksCreated: number;
  tasksAbandoned: number;
}

export interface GenerationSummary {
  totalSitesProcessed: number;
  totalTasksCreated: number;
  totalTasksAbandoned: number;
  results: GenerationResult[];
  errors: { siteId: string; error: string }[];
}

/**
 * Get the period string for a given date and frequency
 */
export function getPeriodString(date: Date, frequency: MaintenanceFrequency): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 0-indexed

  switch (frequency) {
    case 'monthly':
      return `${year}-${month.toString().padStart(2, '0')}`; // "2025-01"

    case 'bi_monthly':
      // Periods: Jan-Feb, Mar-Apr, May-Jun, Jul-Aug, Sep-Oct, Nov-Dec
      const biMonthlyPeriod = Math.ceil(month / 2);
      return `${year}-B${biMonthlyPeriod}`; // "2025-B1"

    case 'quarterly':
      const quarter = Math.ceil(month / 3);
      return `${year}-Q${quarter}`; // "2025-Q1"

    case 'semi_annually':
      const half = month <= 6 ? 1 : 2;
      return `${year}-H${half}`; // "2025-H1"

    case 'annually':
      return `${year}`; // "2025"

    default:
      return `${year}-${month.toString().padStart(2, '0')}`;
  }
}

/**
 * Get the end date for a given period
 */
export function getPeriodEndDate(periodString: string, frequency: MaintenanceFrequency): Date {
  const year = parseInt(periodString.slice(0, 4), 10);

  switch (frequency) {
    case 'monthly': {
      const month = parseInt(periodString.slice(5, 7), 10);
      // Last day of the month
      return new Date(year, month, 0, 23, 59, 59);
    }

    case 'bi_monthly': {
      const biPeriod = parseInt(periodString.slice(6), 10);
      const endMonth = biPeriod * 2; // Period 1 ends Feb, Period 2 ends Apr, etc.
      return new Date(year, endMonth, 0, 23, 59, 59);
    }

    case 'quarterly': {
      const quarter = parseInt(periodString.slice(6), 10);
      const endMonth = quarter * 3; // Q1 ends Mar, Q2 ends Jun, etc.
      return new Date(year, endMonth, 0, 23, 59, 59);
    }

    case 'semi_annually': {
      const half = parseInt(periodString.slice(6), 10);
      const endMonth = half === 1 ? 6 : 12; // H1 ends Jun, H2 ends Dec
      return new Date(year, endMonth, 0, 23, 59, 59);
    }

    case 'annually': {
      // Last day of year
      return new Date(year, 12, 0, 23, 59, 59);
    }

    default:
      return new Date(year, 12, 0, 23, 59, 59);
  }
}

/**
 * Check if a site is due for maintenance task generation
 */
export async function isDueForGeneration(
  siteId: string,
  maintenancePlanId: string,
  frequency: MaintenanceFrequency
): Promise<boolean> {
  const currentPeriod = getPeriodString(new Date(), frequency);

  // Check if we already generated for this period
  const existingLog = await prisma.maintenanceGenerationLog.findUnique({
    where: {
      maintenance_plan_id_site_id_period: {
        maintenance_plan_id: maintenancePlanId,
        site_id: siteId,
        period: currentPeriod,
      },
    },
  });

  return !existingLog;
}

/**
 * Generate maintenance tasks for a specific site
 */
export async function generateMaintenanceTasksForSite(siteId: string): Promise<GenerationResult | null> {
  // Get site with maintenance plan and its SOPs
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      client: true,
      maintenance_plan: {
        include: {
          sops: {
            include: {
              sop: true,
            },
            orderBy: { sort_order: 'asc' },
          },
        },
      },
    },
  });

  if (!site || !site.maintenance_plan || site.is_deleted) {
    return null;
  }

  const plan = site.maintenance_plan;
  const currentPeriod = getPeriodString(new Date(), plan.frequency);

  // Check if already generated
  const isDue = await isDueForGeneration(siteId, plan.id, plan.frequency);
  if (!isDue) {
    return null;
  }

  // Get previous period's incomplete maintenance tasks
  const previousPeriodTasks = await prisma.task.findMany({
    where: {
      site_id: siteId,
      is_maintenance_task: true,
      status: { notIn: ['done', 'abandoned'] },
      maintenance_period: { not: currentPeriod },
    },
  });

  const dueDate = getPeriodEndDate(currentPeriod, plan.frequency);

  // Use transaction to ensure atomicity
  const result = await prisma.$transaction(async (tx) => {
    // Mark old incomplete tasks as abandoned
    let tasksAbandoned = 0;
    if (previousPeriodTasks.length > 0) {
      const updateResult = await tx.task.updateMany({
        where: {
          id: { in: previousPeriodTasks.map((t) => t.id) },
        },
        data: {
          status: TaskStatus.abandoned,
          updated_at: new Date(),
        },
      });
      tasksAbandoned = updateResult.count;
    }

    // Create new tasks from plan's SOPs
    let tasksCreated = 0;
    for (const planSop of plan.sops) {
      const sop = planSop.sop;
      if (!sop.is_active) continue;

      await tx.task.create({
        data: {
          title: sop.title,
          description: sop.content ? JSON.stringify(sop.content) : null,
          status: 'not_started',
          priority: sop.default_priority,
          site_id: siteId,
          client_id: site.client_id,
          assignee_id: site.maintenance_assignee_id,
          function_id: sop.function_id,
          sop_id: sop.id,
          energy_estimate: sop.energy_estimate,
          mystery_factor: sop.mystery_factor,
          battery_impact: sop.battery_impact,
          estimated_minutes: sop.estimated_minutes,
          needs_review: sop.needs_review,
          requirements: sop.template_requirements as object | undefined,
          review_requirements: sop.review_requirements as object | undefined,
          is_maintenance_task: true,
          maintenance_period: currentPeriod,
          due_date: dueDate,
          is_billable: true,
        },
      });
      tasksCreated++;
    }

    // Log the generation
    await tx.maintenanceGenerationLog.create({
      data: {
        maintenance_plan_id: plan.id,
        site_id: siteId,
        period: currentPeriod,
        tasks_created: tasksCreated,
        tasks_abandoned: tasksAbandoned,
      },
    });

    return { tasksCreated, tasksAbandoned };
  });

  return {
    siteId,
    siteName: site.name,
    period: currentPeriod,
    tasksCreated: result.tasksCreated,
    tasksAbandoned: result.tasksAbandoned,
  };
}

/**
 * Generate maintenance tasks for all sites that are due
 */
export async function generateAllDueMaintenance(): Promise<GenerationSummary> {
  const summary: GenerationSummary = {
    totalSitesProcessed: 0,
    totalTasksCreated: 0,
    totalTasksAbandoned: 0,
    results: [],
    errors: [],
  };

  // Get all active sites with maintenance plans that have SOPs
  const sites = await prisma.site.findMany({
    where: {
      is_deleted: false,
      maintenance_plan_id: { not: null },
      maintenance_plan: {
        is_active: true,
        sops: {
          some: {},
        },
      },
    },
    include: {
      maintenance_plan: true,
    },
  });

  for (const site of sites) {
    try {
      const result = await generateMaintenanceTasksForSite(site.id);
      if (result) {
        summary.results.push(result);
        summary.totalTasksCreated += result.tasksCreated;
        summary.totalTasksAbandoned += result.tasksAbandoned;
        summary.totalSitesProcessed++;
      }
    } catch (error) {
      summary.errors.push({
        siteId: site.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return summary;
}

/**
 * Get upcoming maintenance schedule for a site
 */
export async function getUpcomingMaintenance(siteId: string): Promise<{
  nextPeriod: string;
  nextDueDate: Date;
  lastGenerated: Date | null;
} | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      maintenance_plan: true,
    },
  });

  if (!site?.maintenance_plan) {
    return null;
  }

  const frequency = site.maintenance_plan.frequency;
  const currentPeriod = getPeriodString(new Date(), frequency);
  const nextDueDate = getPeriodEndDate(currentPeriod, frequency);

  const lastLog = await prisma.maintenanceGenerationLog.findFirst({
    where: { site_id: siteId },
    orderBy: { generated_at: 'desc' },
  });

  return {
    nextPeriod: currentPeriod,
    nextDueDate,
    lastGenerated: lastLog?.generated_at || null,
  };
}
