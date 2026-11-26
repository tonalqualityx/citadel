/**
 * Charter Task Generator Service
 *
 * Automatically generates tasks for active charters based on their scheduled tasks.
 * Mirrors the pattern from maintenance-generator.ts.
 */

import { prisma } from '@/lib/db/prisma';
import { Prisma, TaskStatus } from '@prisma/client';
import { closeAsksForTasks } from '@/lib/work/ask-closure'; // Work stage A: the one closure of a finished task's emails

export interface CharterGenerationResult {
  charterId: string;
  charterName: string;
  period: string;
  tasksCreated: number;
  tasksAbandoned: number;
}

export interface RecurringGenerationResult {
  recurringWorkId: string;
  period: string;
  tasksCreated: number;
  tasksAbandoned: number;
}

export interface CharterGenerationSummary {
  totalChartersProcessed: number;
  totalTasksCreated: number;
  totalTasksAbandoned: number;
  results: CharterGenerationResult[];
  /** Recurring work with no charter (design.md 2.5 step 6); its tasks are also counted in the totals above. */
  standalone: RecurringGenerationResult[];
  errors: { charterId: string | null; recurringWorkId?: string; error: string }[];
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
 * Check if a recurring row is due for generation. The log is unique on (row, period), so one lookup answers it.
 */
export async function isRecurringTaskDue(scheduledTaskId: string, cadence: CharterCadence): Promise<boolean> {
  const currentPeriod = getCharterPeriodString(new Date(), cadence);

  const existingLog = await prisma.charterGenerationLog.findUnique({
    where: {
      scheduled_task_id_period: {
        scheduled_task_id: scheduledTaskId,
        period: currentPeriod,
      },
    },
  });

  return !existingLog;
}

/**
 * Check if a scheduled task is due for generation (kept for charter callers; the charter id no longer
 * takes part in the key).
 */
export async function isCharterTaskDue(
  _charterId: string,
  scheduledTaskId: string,
  cadence: CharterCadence
): Promise<boolean> {
  return isRecurringTaskDue(scheduledTaskId, cadence);
}

type GeneratableRow = Prisma.RecurringWorkGetPayload<{ include: { sop: true } }>;

interface RowContext {
  /** null for recurring work with no charter */
  charterId: string | null;
  clientId: string;
  siteId: string | null;
  isRetainerWork: boolean;
}

/**
 * Make one period's task for one recurring row: abandon the earlier periods' open tasks, create the new task
 * and write the log, all in one transaction. Returns null when the row is not generatable or not due.
 */
async function generateForRow(
  row: GeneratableRow,
  ctx: RowContext
): Promise<{ created: number; abandoned: number; period: string } | null> {
  if (row.kind !== 'citadel_task' || !row.sop || !row.cadence) return null;
  const sop = row.sop;
  const cadence = row.cadence as CharterCadence;
  const currentPeriod = getCharterPeriodString(new Date(), cadence);

  const isDue = await isRecurringTaskDue(row.id, cadence);
  if (!isDue) return null;

  const dueDate = getCharterPeriodEndDate(currentPeriod, cadence);

  // Earlier tasks of this row: by recurring_work_id, and (charter rows only) the old charter + SOP match for
  // tasks made before the column existed.
  const sameRow: Prisma.TaskWhereInput[] = [{ recurring_work_id: row.id }];
  if (ctx.charterId) sameRow.push({ recurring_work_id: null, charter_id: ctx.charterId, sop_id: sop.id });

  const result = await prisma.$transaction(async (tx) => {
    // Mark old incomplete tasks from this recurring row as abandoned
    const previousTasks = await tx.task.findMany({
      where: {
        OR: sameRow,
        status: { notIn: ['done', 'abandoned', 'triage'] }, // a triage task is Mike's to release or drop
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
      await closeAsksForTasks(tx, previousTasks.map((t) => t.id), 'abandoned'); // Work stage A
    }

    if (!sop.is_active) {
      // Still log even if SOP is inactive, to prevent re-checking
      await tx.charterGenerationLog.create({
        data: {
          charter_id: ctx.charterId,
          scheduled_task_id: row.id,
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
        client_id: ctx.clientId,
        charter_id: ctx.charterId,
        ...(ctx.siteId ? { site_id: ctx.siteId } : {}),
        sop_id: sop.id,
        recurring_work_id: row.id,
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
        is_billable: false,
        is_retainer_work: ctx.isRetainerWork,
      },
    });

    await tx.charterGenerationLog.create({
      data: {
        charter_id: ctx.charterId,
        scheduled_task_id: row.id,
        period: currentPeriod,
        tasks_created: 1,
        tasks_abandoned: abandoned,
      },
    });

    return { created: 1, abandoned };
  });

  return { ...result, period: currentPeriod };
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
        where: { is_active: true, kind: 'citadel_task' },
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
    const result = await generateForRow(scheduledTask, {
      charterId,
      clientId: charter.client_id,
      siteId: null, // charter rows behave exactly as before: the task carries no site
      isRetainerWork: true,
    });
    if (!result) continue;
    totalCreated += result.created;
    totalAbandoned += result.abandoned;
  }

  if (totalCreated === 0 && totalAbandoned === 0) {
    return null;
  }

  return {
    charterId,
    charterName: charter.name,
    period: getCharterPeriodString(new Date(), (charter.scheduled_tasks[0].cadence ?? 'monthly') as CharterCadence),
    tasksCreated: totalCreated,
    tasksAbandoned: totalAbandoned,
  };
}

/**
 * Indelible's own client: the Client named "Indelible" (case-insensitive). The codebase has no flag or constant for it.
 * Null when there is none.
 */
export async function findIndelibleClientId(): Promise<string | null> {
  const client = await prisma.client.findFirst({
    where: { name: { equals: 'Indelible', mode: 'insensitive' }, is_deleted: false },
    select: { id: true },
  });
  return client?.id ?? null;
}

/**
 * Generate tasks for active citadel_task recurring work that has no charter (design.md 2.5 step 6). The row's own
 * client, else Indelible's; never retainer work; no charter on the task. Machine and engine rows are never read.
 */
export async function generateStandaloneRecurringTasks(): Promise<{
  results: RecurringGenerationResult[];
  errors: { recurringWorkId: string; error: string }[];
}> {
  const out = { results: [] as RecurringGenerationResult[], errors: [] as { recurringWorkId: string; error: string }[] };

  const rows = await prisma.recurringWork.findMany({
    where: {
      is_active: true,
      kind: 'citadel_task',
      charter_id: null,
      sop_id: { not: null },
      cadence: { not: null },
    },
    include: { sop: true },
    orderBy: { sort_order: 'asc' },
  });
  if (rows.length === 0) return out;

  let indelibleId: string | null | undefined;

  for (const row of rows) {
    try {
      let clientId = row.client_id;
      if (!clientId) {
        if (indelibleId === undefined) indelibleId = await findIndelibleClientId();
        if (!indelibleId) {
          console.warn(`Recurring work ${row.id} has no client and no Indelible client was found; skipped`);
          continue;
        }
        clientId = indelibleId;
      }

      const result = await generateForRow(row, {
        charterId: null,
        clientId,
        siteId: row.site_id,
        isRetainerWork: false,
      });
      if (result && (result.created > 0 || result.abandoned > 0)) {
        out.results.push({ recurringWorkId: row.id, period: result.period, tasksCreated: result.created, tasksAbandoned: result.abandoned });
      }
    } catch (error) {
      out.errors.push({ recurringWorkId: row.id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  return out;
}

/**
 * Generate tasks for all active charters that are due, then for recurring work with no charter. One cron run covers both.
 */
export async function generateAllDueCharterTasks(): Promise<CharterGenerationSummary> {
  const summary: CharterGenerationSummary = {
    totalChartersProcessed: 0,
    totalTasksCreated: 0,
    totalTasksAbandoned: 0,
    results: [],
    standalone: [],
    errors: [],
  };

  const charters = await prisma.charter.findMany({
    where: {
      is_deleted: false,
      status: 'active',
      scheduled_tasks: {
        some: { is_active: true, kind: 'citadel_task' },
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

  try {
    const standalone = await generateStandaloneRecurringTasks();
    for (const r of standalone.results) {
      summary.standalone.push(r);
      summary.totalTasksCreated += r.tasksCreated;
      summary.totalTasksAbandoned += r.tasksAbandoned;
    }
    for (const e of standalone.errors) summary.errors.push({ charterId: null, ...e });
  } catch (error) {
    summary.errors.push({ charterId: null, error: error instanceof Error ? error.message : 'Unknown error' });
  }

  return summary;
}
