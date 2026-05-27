import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { energyToMinutes, getMysteryMultiplier, getBatteryMultiplier } from '@/lib/calculations/energy';
import type { MysteryFactor, BatteryImpact } from '@prisma/client';

type TaskType = 'scheduled' | 'ad_hoc' | 'commission';

interface RawTask {
  id: string;
  title: string;
  status: string;
  estimated_minutes: number | null;
  energy_estimate: number | null;
  mystery_factor: string;
  battery_impact: string;
  is_retainer_work: boolean;
  project_id: string | null;
  project: { id: string; name: string } | null;
  time_entries: { duration: number | null }[];
}

function classifyTask(task: RawTask): TaskType {
  if (task.project_id) return 'commission';
  if (task.is_retainer_work) return 'scheduled';
  return 'ad_hoc';
}

function processTask(task: RawTask) {
  const timeSpentMinutes = task.time_entries.reduce(
    (sum, entry) => sum + (entry.duration || 0),
    0
  );
  let estimateLowMinutes: number | null = null;
  let estimateHighMinutes: number | null = null;
  if (task.energy_estimate) {
    const baseMinutes = energyToMinutes(task.energy_estimate);
    const mysteryMult = getMysteryMultiplier(task.mystery_factor as MysteryFactor);
    const batteryMult = getBatteryMultiplier(task.battery_impact as BatteryImpact);
    estimateLowMinutes = baseMinutes;
    estimateHighMinutes = Math.round(baseMinutes * mysteryMult * batteryMult);
  }
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    estimated_minutes: task.estimated_minutes,
    estimate_low_minutes: estimateLowMinutes,
    estimate_high_minutes: estimateHighMinutes,
    time_spent_minutes: timeSpentMinutes,
    task_type: classifyTask(task),
    project_name: task.project?.name ?? null,
  };
}

const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  estimated_minutes: true,
  energy_estimate: true,
  mystery_factor: true,
  battery_impact: true,
  is_retainer_work: true,
  project_id: true,
  project: { select: { id: true, name: true } },
  time_entries: {
    where: { is_deleted: false },
    select: { duration: true },
  },
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const period = searchParams.get('period') ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Parse period into date range for commission task filtering
    const [periodYear, periodMonth] = period.split('-').map(Number);
    const periodStart = new Date(periodYear, periodMonth - 1, 1);
    const periodEnd = new Date(periodYear, periodMonth, 0, 23, 59, 59);

    const charter = await prisma.charter.findFirst({
      where: { id, is_deleted: false },
      select: {
        id: true,
        budget_hours: true,
        hourly_rate: true,
        charter_commissions: {
          where: {
            is_active: true,
            start_period: { lte: period },
            OR: [
              { end_period: null },
              { end_period: { gte: period } },
            ],
          },
          select: {
            commission_id: true,
            allocated_hours_per_period: true,
            commission: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!charter) {
      throw new ApiError('Charter not found', 404);
    }

    // 1. Charter tasks (scheduled + ad-hoc) — same as before
    const charterTasks = await prisma.task.findMany({
      where: {
        charter_id: id,
        maintenance_period: period,
        is_deleted: false,
      },
      select: TASK_SELECT,
    });

    // 2. Commission tasks — from linked projects, scoped to this period
    const commissionProjectIds = charter.charter_commissions.map((c) => c.commission_id);
    let commissionTasks: RawTask[] = [];
    if (commissionProjectIds.length > 0) {
      commissionTasks = await prisma.task.findMany({
        where: {
          project_id: { in: commissionProjectIds },
          is_deleted: false,
          // Exclude tasks already counted as charter tasks
          charter_id: null,
          OR: [
            // Completed/abandoned in this period
            {
              status: { in: ['done', 'abandoned'] },
              completed_at: { gte: periodStart, lte: periodEnd },
            },
            // In-progress or not started (active work)
            {
              status: { notIn: ['done', 'abandoned'] },
            },
          ],
        },
        select: TASK_SELECT,
      });
    }

    // Merge and process all tasks
    const allRawTasks = [...charterTasks, ...commissionTasks];
    const allTasks = allRawTasks.map(processTask);

    const completedStatuses = ['done', 'abandoned'];
    const completedTasks = allTasks.filter((t) => completedStatuses.includes(t.status));
    const plannedTasks = allTasks.filter((t) => !completedStatuses.includes(t.status));

    const totalSpentMinutes = allTasks.reduce(
      (sum, t) => sum + t.time_spent_minutes,
      0
    );
    const plannedLowMinutes = plannedTasks.reduce(
      (sum, t) => sum + (t.estimate_low_minutes || 0),
      0
    );
    const plannedHighMinutes = plannedTasks.reduce(
      (sum, t) => sum + (t.estimate_high_minutes || 0),
      0
    );

    const hourlyRate = charter.hourly_rate ? Number(charter.hourly_rate) : null;
    const usedHours = totalSpentMinutes / 60;
    const plannedLowHours = plannedLowMinutes / 60;
    const plannedHighHours = plannedHighMinutes / 60;

    // Commission allocation summary
    const commissionAllocations = charter.charter_commissions.map((c) => ({
      commission_id: c.commission_id,
      commission_name: c.commission?.name ?? null,
      allocated_hours_per_period: c.allocated_hours_per_period
        ? Number(c.allocated_hours_per_period)
        : null,
    }));
    const totalAllocatedHours = commissionAllocations.reduce(
      (sum, c) => sum + (c.allocated_hours_per_period ?? 0),
      0
    );

    return NextResponse.json({
      charter_id: id,
      period,
      budget_hours: charter.budget_hours ? Number(charter.budget_hours) : null,
      hourly_rate: hourlyRate,
      used_hours: usedHours,
      planned_low_hours: plannedLowHours,
      planned_high_hours: plannedHighHours,
      spent_amount: hourlyRate != null ? usedHours * hourlyRate : null,
      anticipated_low_amount: hourlyRate != null ? (usedHours + plannedLowHours) * hourlyRate : null,
      anticipated_high_amount: hourlyRate != null ? (usedHours + plannedHighHours) * hourlyRate : null,
      budget_amount: hourlyRate != null && charter.budget_hours
        ? Number(charter.budget_hours) * hourlyRate
        : null,
      commission_allocations: commissionAllocations,
      total_allocated_hours: totalAllocatedHours,
      tasks_count: allTasks.length,
      tasks: allTasks,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
