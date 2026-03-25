import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

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
        time_entries: {
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
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        time_spent_minutes: timeSpentMinutes,
      };
    });

    const totalMinutes = tasksWithTime.reduce(
      (sum, t) => sum + t.time_spent_minutes,
      0
    );

    return NextResponse.json({
      charter_id: id,
      period,
      budget_hours: charter.budget_hours ? Number(charter.budget_hours) : null,
      used_hours: totalMinutes / 60,
      tasks_count: tasks.length,
      tasks: tasksWithTime,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
