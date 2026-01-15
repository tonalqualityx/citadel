import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/prisma';
import { getMonthPeriod, getCurrentMonthPeriod } from '@/lib/calculations/retainer';
import { energyToMinutes, getMysteryMultiplier } from '@/lib/calculations/energy';
import { MysteryFactor } from '@prisma/client';

// Task with time logged this month
interface RetainerTask {
  id: string;
  title: string;
  project_name: string | null;
  project_id: string | null;
  time_spent_minutes: number;
  completed_at: string | null;
  is_retainer_work: boolean;
  invoiced: boolean;
}

// Task scheduled for this month (has due_date, not done, no time logged)
interface ScheduledTask {
  id: string;
  title: string;
  project_name: string | null;
  project_id: string | null;
  due_date: string | null;
  status: string;
  assignee_id: string | null;
  assignee_name: string | null;
  energy_estimate: number | null;
  mystery_factor: string;
  estimated_minutes_min: number;
  estimated_minutes_max: number;
  is_retainer_work: boolean;
}

interface RetainerUsageResponse {
  month: string;
  period: { start: string; end: string };
  retainerHours: number;
  // Actual usage (time logged)
  usedMinutes: number;
  overageMinutes: number;
  tasks: RetainerTask[];
  // Scheduled usage (estimated from tasks due this month)
  scheduledMinutes: number;
  scheduledTasks: ScheduledTask[];
  // Projected totals
  projectedTotalMinutes: number;
  projectedOverageMinutes: number;
  // Unscheduled (no due date) - for warning display
  unscheduledTasksCount: number;
  unscheduledMinutes: number;
}

/**
 * Parse YYYY-MM format month string
 */
function parseMonthParam(monthParam: string): { year: number; month: number } | null {
  const match = monthParam.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // Convert to 0-indexed

  if (month < 0 || month > 11) return null;

  return { year, month };
}

/**
 * Format date to YYYY-MM string
 */
function formatMonthString(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Calculate estimated minutes (max) for a task
 */
function calculateTaskEstimateMax(
  energyEstimate: number | null,
  mysteryFactor: MysteryFactor
): number {
  if (!energyEstimate) return 0;
  const baseMinutes = energyToMinutes(energyEstimate);
  const multiplier = getMysteryMultiplier(mysteryFactor);
  return Math.round(baseMinutes * multiplier);
}

/**
 * GET /api/clients/[id]/retainer
 *
 * Fetches retainer usage data for a client for a specific month.
 * Query param: ?month=YYYY-MM (defaults to current month)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: clientId } = await params;

    // Parse month parameter
    const searchParams = request.nextUrl.searchParams;
    const monthParam = searchParams.get('month');

    let period: { start: Date; end: Date };
    let monthString: string;

    if (monthParam) {
      const parsed = parseMonthParam(monthParam);
      if (!parsed) {
        throw new ApiError('Invalid month format. Use YYYY-MM', 400);
      }
      period = getMonthPeriod(parsed.year, parsed.month);
      monthString = monthParam;
    } else {
      period = getCurrentMonthPeriod();
      monthString = formatMonthString(period.start);
    }

    // Fetch client
    const client = await prisma.client.findUnique({
      where: { id: clientId, is_deleted: false },
      select: {
        id: true,
        name: true,
        retainer_hours: true,
      },
    });

    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    const retainerHours = client.retainer_hours ? Number(client.retainer_hours) : 0;
    const retainerMinutesLimit = retainerHours * 60;

    // Check if month is in the future
    const now = new Date();
    if (period.start > now) {
      // Return empty data for future months
      return NextResponse.json({
        month: monthString,
        period: {
          start: period.start.toISOString(),
          end: period.end.toISOString(),
        },
        retainerHours,
        usedMinutes: 0,
        overageMinutes: 0,
        tasks: [],
        scheduledMinutes: 0,
        scheduledTasks: [],
        projectedTotalMinutes: 0,
        projectedOverageMinutes: 0,
        unscheduledTasksCount: 0,
        unscheduledMinutes: 0,
      } as RetainerUsageResponse);
    }

    // ============================================
    // PART 1: Fetch tasks with time logged this month
    // ============================================

    // Get time entries from project-based tasks
    const projectTimeEntries = await prisma.timeEntry.findMany({
      where: {
        is_deleted: false,
        is_billable: true,
        started_at: {
          gte: period.start,
          lte: period.end,
        },
        task: {
          is_deleted: false,
          project: {
            client_id: clientId,
            is_deleted: false,
          },
        },
      },
      select: {
        duration: true,
        task: {
          select: {
            id: true,
            title: true,
            is_retainer_work: true,
            billing_amount: true,
            is_support: true,
            invoiced: true,
            completed_at: true,
            project_id: true,
            project: {
              select: {
                name: true,
                is_retainer: true,
              },
            },
          },
        },
      },
    });

    // Get time entries from ad-hoc tasks (tasks with direct client_id, no project)
    const adHocTimeEntries = await prisma.timeEntry.findMany({
      where: {
        is_deleted: false,
        is_billable: true,
        started_at: {
          gte: period.start,
          lte: period.end,
        },
        task: {
          is_deleted: false,
          client_id: clientId,
          project_id: null,
        },
      },
      select: {
        duration: true,
        task: {
          select: {
            id: true,
            title: true,
            is_retainer_work: true,
            billing_amount: true,
            is_support: true,
            invoiced: true,
            completed_at: true,
          },
        },
      },
    });

    // Aggregate time by task (only include retainer work)
    const taskTimeMap = new Map<string, {
      id: string;
      title: string;
      project_name: string | null;
      project_id: string | null;
      time_spent_minutes: number;
      completed_at: Date | null;
      is_retainer_work: boolean;
      invoiced: boolean;
    }>();

    // Track task IDs that have time logged (to exclude from scheduled)
    const tasksWithTimeLogged = new Set<string>();

    // Process project-based time entries
    for (const entry of projectTimeEntries) {
      if (!entry.task) continue;

      // Exclude support tasks
      if (entry.task.is_support) continue;

      // Include if: explicitly marked as retainer, project is retainer, or (retainer client + no fixed billing_amount)
      const isExplicitRetainer = entry.task.is_retainer_work || entry.task.project?.is_retainer;
      const isDefaultRetainer = retainerHours > 0 && !entry.task.billing_amount;
      const isRetainerWork = isExplicitRetainer || isDefaultRetainer;
      if (!isRetainerWork) continue;

      const taskId = entry.task.id;
      tasksWithTimeLogged.add(taskId);
      const existing = taskTimeMap.get(taskId);

      if (existing) {
        existing.time_spent_minutes += entry.duration || 0;
      } else {
        taskTimeMap.set(taskId, {
          id: entry.task.id,
          title: entry.task.title,
          project_name: entry.task.project?.name || null,
          project_id: entry.task.project_id,
          time_spent_minutes: entry.duration || 0,
          completed_at: entry.task.completed_at,
          is_retainer_work: entry.task.is_retainer_work,
          invoiced: entry.task.invoiced,
        });
      }
    }

    // Process ad-hoc time entries
    for (const entry of adHocTimeEntries) {
      if (!entry.task) continue;

      // Exclude support tasks
      if (entry.task.is_support) continue;

      // Include if: explicitly marked as retainer, or (retainer client + no fixed billing_amount)
      const isExplicitRetainer = entry.task.is_retainer_work;
      const isDefaultRetainer = retainerHours > 0 && !entry.task.billing_amount;
      const isRetainerWork = isExplicitRetainer || isDefaultRetainer;
      if (!isRetainerWork) continue;

      const taskId = entry.task.id;
      tasksWithTimeLogged.add(taskId);
      const existing = taskTimeMap.get(taskId);

      if (existing) {
        existing.time_spent_minutes += entry.duration || 0;
      } else {
        taskTimeMap.set(taskId, {
          id: entry.task.id,
          title: entry.task.title,
          project_name: null,
          project_id: null,
          time_spent_minutes: entry.duration || 0,
          completed_at: entry.task.completed_at,
          is_retainer_work: entry.task.is_retainer_work,
          invoiced: entry.task.invoiced,
        });
      }
    }

    // Build tasks array
    const tasks: RetainerTask[] = Array.from(taskTimeMap.values()).map(task => ({
      id: task.id,
      title: task.title,
      project_name: task.project_name,
      project_id: task.project_id,
      time_spent_minutes: task.time_spent_minutes,
      completed_at: task.completed_at?.toISOString() || null,
      is_retainer_work: task.is_retainer_work,
      invoiced: task.invoiced,
    }));

    // Sort tasks by time spent (descending)
    tasks.sort((a, b) => b.time_spent_minutes - a.time_spent_minutes);

    const usedMinutes = tasks.reduce((sum, t) => sum + t.time_spent_minutes, 0);
    const overageMinutes = Math.max(usedMinutes - retainerMinutesLimit, 0);

    // ============================================
    // PART 2: Fetch scheduled tasks (due this month, not done, no time logged)
    // ============================================

    // Query scheduled retainer tasks
    const scheduledTasksRaw = await prisma.task.findMany({
      where: {
        is_deleted: false,
        is_support: false, // Exclude support tasks
        due_date: {
          gte: period.start,
          lte: period.end,
        },
        status: {
          notIn: ['done', 'abandoned'],
        },
        OR: [
          // Explicitly marked as retainer work
          { is_retainer_work: true },
          // Project is marked as retainer
          { project: { is_retainer: true } },
          // For retainer clients: include all tasks without fixed billing_amount
          ...(retainerHours > 0 ? [{
            billing_amount: null,
            OR: [
              // Project-based tasks for this client
              {
                project: {
                  client_id: clientId,
                  is_deleted: false,
                },
              },
              // Ad-hoc tasks for this client
              {
                client_id: clientId,
                project_id: null,
              },
            ],
          }] : []),
        ],
      },
      select: {
        id: true,
        title: true,
        due_date: true,
        status: true,
        energy_estimate: true,
        mystery_factor: true,
        is_retainer_work: true,
        assignee_id: true,
        assignee: {
          select: {
            name: true,
          },
        },
        project_id: true,
        project: {
          select: {
            name: true,
          },
        },
      },
    });

    // Filter out tasks that already have time logged this month
    const scheduledTasksFiltered = scheduledTasksRaw.filter(
      task => !tasksWithTimeLogged.has(task.id)
    );

    // Calculate scheduled minutes and format tasks
    let scheduledMinutes = 0;
    const scheduledTasks: ScheduledTask[] = scheduledTasksFiltered.map(task => {
      const baseMinutes = task.energy_estimate
        ? energyToMinutes(task.energy_estimate)
        : 0;
      const maxMinutes = calculateTaskEstimateMax(
        task.energy_estimate,
        task.mystery_factor as MysteryFactor
      );

      scheduledMinutes += maxMinutes;

      return {
        id: task.id,
        title: task.title,
        project_name: task.project?.name || null,
        project_id: task.project_id,
        due_date: task.due_date?.toISOString() || null,
        status: task.status,
        assignee_id: task.assignee_id,
        assignee_name: task.assignee?.name || null,
        energy_estimate: task.energy_estimate,
        mystery_factor: task.mystery_factor,
        estimated_minutes_min: baseMinutes,
        estimated_minutes_max: maxMinutes,
        is_retainer_work: task.is_retainer_work,
      };
    });

    // Sort scheduled tasks by due date
    scheduledTasks.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });

    // ============================================
    // PART 3: Fetch unscheduled tasks (no due date, not done)
    // ============================================

    const unscheduledTasksRaw = await prisma.task.findMany({
      where: {
        is_deleted: false,
        is_support: false, // Exclude support tasks
        due_date: null,
        status: {
          notIn: ['done', 'abandoned'],
        },
        OR: [
          // Explicitly marked as retainer work
          { is_retainer_work: true },
          // Project is marked as retainer
          { project: { is_retainer: true } },
          // For retainer clients: include all tasks without fixed billing_amount
          ...(retainerHours > 0 ? [{
            billing_amount: null,
            OR: [
              // Project-based tasks for this client
              {
                project: {
                  client_id: clientId,
                  is_deleted: false,
                },
              },
              // Ad-hoc tasks for this client
              {
                client_id: clientId,
                project_id: null,
              },
            ],
          }] : []),
        ],
      },
      select: {
        id: true,
        energy_estimate: true,
        mystery_factor: true,
      },
    });

    // Filter out tasks that have time logged
    const unscheduledTasksFiltered = unscheduledTasksRaw.filter(
      task => !tasksWithTimeLogged.has(task.id)
    );

    let unscheduledMinutes = 0;
    for (const task of unscheduledTasksFiltered) {
      unscheduledMinutes += calculateTaskEstimateMax(
        task.energy_estimate,
        task.mystery_factor as MysteryFactor
      );
    }

    // ============================================
    // PART 4: Calculate projections
    // ============================================

    const projectedTotalMinutes = usedMinutes + scheduledMinutes;
    const projectedOverageMinutes = Math.max(projectedTotalMinutes - retainerMinutesLimit, 0);

    const response: RetainerUsageResponse = {
      month: monthString,
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      retainerHours,
      usedMinutes,
      overageMinutes,
      tasks,
      scheduledMinutes,
      scheduledTasks,
      projectedTotalMinutes,
      projectedOverageMinutes,
      unscheduledTasksCount: unscheduledTasksFiltered.length,
      unscheduledMinutes,
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
