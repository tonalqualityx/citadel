import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { energyToMinutes, getMysteryMultiplier, getBatteryMultiplier } from '@/lib/calculations/energy';
import type { MysteryFactor, BatteryImpact } from '@prisma/client';

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

    const charter = await prisma.charter.findFirst({
      where: { id, is_deleted: false },
      select: {
        id: true,
        budget_hours: true,
        hourly_rate: true,
      },
    });

    if (!charter) {
      throw new ApiError('Charter not found', 404);
    }

    const tasks = await prisma.task.findMany({
      where: {
        charter_id: id,
        maintenance_period: period,
        is_deleted: false,
      },
      select: {
        id: true,
        title: true,
        status: true,
        estimated_minutes: true,
        energy_estimate: true,
        mystery_factor: true,
        battery_impact: true,
        time_entries: {
          where: { is_deleted: false },
          select: {
            duration: true,
          },
        },
      },
    });

    const tasksWithTime = tasks.map((task) => {
      const timeSpentMinutes = task.time_entries.reduce(
        (sum, entry) => sum + (entry.duration || 0),
        0
      );
      // Calculate estimate range from energy/mystery/battery
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
      };
    });

    const completedStatuses = ['done', 'abandoned'];
    const completedTasks = tasksWithTime.filter((t) => completedStatuses.includes(t.status));
    const plannedTasks = tasksWithTime.filter((t) => !completedStatuses.includes(t.status));

    const totalSpentMinutes = tasksWithTime.reduce(
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
      tasks_count: tasks.length,
      tasks: tasksWithTime,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
