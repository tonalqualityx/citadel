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

    const [periodYear, periodMonth] = period.split('-').map(Number);
    const periodStart = new Date(periodYear, periodMonth - 1, 1);
    const periodEnd = new Date(periodYear, periodMonth, 0, 23, 59, 59);

    const charter = await prisma.charter.findFirst({
      where: { id, is_deleted: false },
      select: {
        id: true,
        charter_commissions: {
          where: {
            is_active: true,
            start_period: { lte: period },
            OR: [
              { end_period: null },
              { end_period: { gte: period } },
            ],
          },
          select: { commission_id: true },
        },
      },
    });

    if (!charter) {
      throw new ApiError('Charter not found', 404);
    }

    const commissionIds = charter.charter_commissions.map((c) => c.commission_id);

    if (commissionIds.length === 0) {
      return NextResponse.json({ tasks: [] });
    }

    const tasks = await prisma.task.findMany({
      where: {
        project_id: { in: commissionIds },
        is_deleted: false,
        charter_id: null,
        OR: [
          {
            status: { in: ['done', 'abandoned'] },
            completed_at: { gte: periodStart, lte: periodEnd },
          },
          {
            status: { notIn: ['done', 'abandoned'] },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        energy_estimate: true,
        mystery_factor: true,
        battery_impact: true,
        estimated_minutes: true,
        due_date: true,
        started_at: true,
        completed_at: true,
        needs_review: true,
        approved: true,
        project_id: true,
        project: { select: { id: true, name: true } },
        assignee_id: true,
        assignee: { select: { id: true, name: true } },
        time_entries: {
          where: { is_deleted: false },
          select: { duration: true },
        },
      },
    });

    // Format to match the Task type expected by the kanban
    const formatted = tasks.map((task) => ({
      ...task,
      time_spent_minutes: task.time_entries.reduce((sum, e) => sum + (e.duration || 0), 0),
      time_entries: undefined,
    }));

    return NextResponse.json({ tasks: formatted });
  } catch (error) {
    return handleApiError(error);
  }
}
