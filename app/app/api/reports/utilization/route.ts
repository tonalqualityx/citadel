import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export interface UserUtilization {
  userId: string;
  userName: string;
  totalMinutes: number;
  totalHours: number;
  billableMinutes: number;
  billableHours: number;
  nonBillableMinutes: number;
  nonBillableHours: number;
  billablePercent: number;
  targetHours: number;
  utilizationPercent: number;
  status: 'under' | 'target' | 'over';
}

export interface UtilizationResponse {
  period: { start: string; end: string };
  team: UserUtilization[];
  summary: {
    totalHours: number;
    billableHours: number;
    avgUtilization: number;
    targetHours: number;
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

    // Parse date filters or use current month
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    let periodStart: Date;
    let periodEnd: Date;

    if (year && month) {
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

    // Get all active users
    const users = await prisma.user.findMany({
      where: {
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        role: true,
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

    // Calculate working days in period (excluding weekends)
    const workingDays = calculateWorkingDays(periodStart, periodEnd);
    const targetHoursPerUser = workingDays * 8; // 8 hours per working day

    // Aggregate by user
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

    // Build utilization for each user
    const team: UserUtilization[] = users.map((user) => {
      const time = userTimeMap.get(user.id) || { billable: 0, nonBillable: 0 };
      const totalMinutes = time.billable + time.nonBillable;
      const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
      const billableHours = Math.round((time.billable / 60) * 100) / 100;
      const nonBillableHours = Math.round((time.nonBillable / 60) * 100) / 100;
      const billablePercent =
        totalMinutes > 0 ? Math.round((time.billable / totalMinutes) * 100) : 0;
      const utilizationPercent =
        targetHoursPerUser > 0 ? Math.round((totalHours / targetHoursPerUser) * 100) : 0;

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
        targetHours: targetHoursPerUser,
        utilizationPercent,
        status,
      };
    });

    // Calculate summary
    const totalHours = team.reduce((sum, u) => sum + u.totalHours, 0);
    const billableHours = team.reduce((sum, u) => sum + u.billableHours, 0);
    const totalTarget = targetHoursPerUser * users.length;
    const avgUtilization =
      totalTarget > 0 ? Math.round((totalHours / totalTarget) * 100) : 0;

    return NextResponse.json({
      period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
      },
      team: team.sort((a, b) => b.totalHours - a.totalHours),
      summary: {
        totalHours: Math.round(totalHours * 100) / 100,
        billableHours: Math.round(billableHours * 100) / 100,
        avgUtilization,
        targetHours: totalTarget,
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
