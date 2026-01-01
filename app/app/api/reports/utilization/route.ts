import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { energyToMinutes, getMysteryMultiplier } from '@/lib/calculations/energy';

export interface UserUtilization {
  userId: string;
  userName: string;
  // Actual hours logged during period
  totalMinutes: number;
  totalHours: number;
  billableMinutes: number;
  billableHours: number;
  nonBillableMinutes: number;
  nonBillableHours: number;
  billablePercent: number;
  // Target hours (from user setting, scaled to period)
  targetHours: number;
  utilizationPercent: number;
  // Reserved hours = avg estimates for incomplete tasks + actual time for completed tasks
  reservedHours: number;
  status: 'under' | 'target' | 'over';
}

export interface UtilizationResponse {
  period: { start: string; end: string; type: 'week' | 'month' };
  team: UserUtilization[];
  summary: {
    totalHours: number;
    billableHours: number;
    avgUtilization: number;
    targetHours: number;
    reservedHours: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    // Only PM and admin can view utilization reports
    if (auth.role === 'tech') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);

    // Parse period type (week or month)
    const periodType = (searchParams.get('period') || 'month') as 'week' | 'month';
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const week = searchParams.get('week'); // ISO week number

    let periodStart: Date;
    let periodEnd: Date;

    if (periodType === 'week' && year && week) {
      // Calculate week start/end from ISO week number
      const y = parseInt(year);
      const w = parseInt(week);
      periodStart = getWeekStart(y, w);
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + 6);
      periodEnd.setHours(23, 59, 59, 999);
    } else if (year && month) {
      const y = parseInt(year);
      const m = parseInt(month) - 1; // 0-indexed
      periodStart = new Date(y, m, 1);
      periodEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
    } else {
      // Default to current month
      const now = new Date();
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // Get all active users with their target hours
    const users = await prisma.user.findMany({
      where: {
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        role: true,
        target_hours_per_week: true,
      },
      orderBy: { name: 'asc' },
    });

    // Get time entries for the period
    const timeEntries = await prisma.timeEntry.findMany({
      where: {
        started_at: { gte: periodStart, lte: periodEnd },
        is_deleted: false,
      },
      select: {
        user_id: true,
        duration: true,
        is_billable: true,
      },
    });

    // Get all assigned tasks for reserved hours calculation
    // Incomplete tasks: use average estimate
    // Completed tasks: use actual time tracked
    const assignedTasks = await prisma.task.findMany({
      where: {
        assignee_id: { not: null },
        is_deleted: false,
      },
      select: {
        assignee_id: true,
        status: true,
        energy_estimate: true,
        mystery_factor: true,
        estimated_minutes: true,
        time_entries: {
          where: { is_deleted: false },
          select: { duration: true },
        },
      },
    });

    // Calculate working days in period (excluding weekends)
    const workingDays = calculateWorkingDays(periodStart, periodEnd);
    const weeksInPeriod = workingDays / 5; // Approximate weeks

    // Aggregate time entries by user
    const userTimeMap = new Map<string, { billable: number; nonBillable: number }>();

    for (const entry of timeEntries) {
      const current = userTimeMap.get(entry.user_id) || { billable: 0, nonBillable: 0 };
      if (entry.is_billable) {
        current.billable += entry.duration;
      } else {
        current.nonBillable += entry.duration;
      }
      userTimeMap.set(entry.user_id, current);
    }

    // Aggregate reserved minutes by user
    // Reserved = avg estimate for incomplete tasks + actual time for completed tasks
    // Also track incomplete estimates separately for utilization calculation
    const userReservedMap = new Map<string, number>();
    const userIncompleteEstimateMap = new Map<string, number>();

    for (const task of assignedTasks) {
      if (!task.assignee_id) continue;

      let reservedMinutes = 0;
      const isComplete = task.status === 'done' || task.status === 'abandoned';

      if (isComplete) {
        // For completed tasks, use actual time tracked
        reservedMinutes = task.time_entries.reduce((sum, e) => sum + e.duration, 0);
      } else {
        // For incomplete tasks, use average of min/max estimate
        if (task.energy_estimate) {
          const baseMinutes = energyToMinutes(task.energy_estimate);
          const multiplier = getMysteryMultiplier(task.mystery_factor);
          const minMinutes = baseMinutes;
          const maxMinutes = baseMinutes * multiplier;
          reservedMinutes = (minMinutes + maxMinutes) / 2;
        } else if (task.estimated_minutes) {
          reservedMinutes = task.estimated_minutes;
        }

        // Track incomplete estimates separately for utilization
        const currentIncomplete = userIncompleteEstimateMap.get(task.assignee_id) || 0;
        userIncompleteEstimateMap.set(task.assignee_id, currentIncomplete + reservedMinutes);
      }

      const current = userReservedMap.get(task.assignee_id) || 0;
      userReservedMap.set(task.assignee_id, current + reservedMinutes);
    }

    // Build utilization for each user
    const team: UserUtilization[] = users.map((user) => {
      const time = userTimeMap.get(user.id) || { billable: 0, nonBillable: 0 };
      const totalMinutes = time.billable + time.nonBillable;
      const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
      const billableHours = Math.round((time.billable / 60) * 100) / 100;
      const nonBillableHours = Math.round((time.nonBillable / 60) * 100) / 100;
      const billablePercent =
        totalMinutes > 0 ? Math.round((time.billable / totalMinutes) * 100) : 0;

      // Calculate per-user target hours for the period
      const targetHoursPerPeriod = Math.round(user.target_hours_per_week * weeksInPeriod * 100) / 100;

      // Reserved hours from task estimates/actuals
      const reservedMinutes = userReservedMap.get(user.id) || 0;
      const reservedHours = Math.round((reservedMinutes / 60) * 100) / 100;

      // Utilization = logged hours + incomplete task estimates (avg)
      // This shows total commitment: work done + work still to do
      const incompleteEstimateMinutes = userIncompleteEstimateMap.get(user.id) || 0;
      const committedHours = totalHours + (incompleteEstimateMinutes / 60);
      const utilizationPercent =
        targetHoursPerPeriod > 0 ? Math.round((committedHours / targetHoursPerPeriod) * 100) : 0;

      let status: UserUtilization['status'] = 'target';
      if (utilizationPercent < 80) {
        status = 'under';
      } else if (utilizationPercent > 110) {
        status = 'over';
      }

      return {
        userId: user.id,
        userName: user.name,
        totalMinutes,
        totalHours,
        billableMinutes: time.billable,
        billableHours,
        nonBillableMinutes: time.nonBillable,
        nonBillableHours,
        billablePercent,
        targetHours: targetHoursPerPeriod,
        utilizationPercent,
        reservedHours,
        status,
      };
    });

    // Calculate summary
    const totalHours = team.reduce((sum, u) => sum + u.totalHours, 0);
    const billableHours = team.reduce((sum, u) => sum + u.billableHours, 0);
    const totalTarget = team.reduce((sum, u) => sum + u.targetHours, 0);
    const totalReserved = team.reduce((sum, u) => sum + u.reservedHours, 0);
    const avgUtilization =
      totalTarget > 0 ? Math.round((totalHours / totalTarget) * 100) : 0;

    return NextResponse.json({
      period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
        type: periodType,
      },
      team: team.sort((a, b) => b.totalHours - a.totalHours),
      summary: {
        totalHours: Math.round(totalHours * 100) / 100,
        billableHours: Math.round(billableHours * 100) / 100,
        avgUtilization,
        targetHours: Math.round(totalTarget * 100) / 100,
        reservedHours: Math.round(totalReserved * 100) / 100,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function calculateWorkingDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      // Not Sunday or Saturday
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

// Get the Monday of a given ISO week
function getWeekStart(year: number, week: number): Date {
  // January 4th is always in week 1
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7; // Convert Sunday from 0 to 7

  // Find Monday of week 1
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);

  // Add weeks to get to the desired week
  const targetMonday = new Date(week1Monday);
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7);

  return targetMonday;
}

// Get ISO week number for a date
export function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
