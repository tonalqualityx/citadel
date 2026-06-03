import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatScheduleResponse } from '@/lib/api/troubador-formatters';

const scheduleInclude = {
  client: { select: { id: true, name: true } },
  site: { select: { id: true, name: true, url: true, site_type: true } },
  default_assignee: { select: { id: true, name: true, email: true } },
  _count: { select: { runs: true } },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const schedule = await prisma.troubadorSchedule.findFirst({
      where: { id, is_deleted: false },
      include: scheduleInclude,
    });
    if (!schedule) throw new ApiError('Schedule not found', 404);

    return NextResponse.json(formatScheduleResponse(schedule));
  } catch (error) {
    return handleApiError(error);
  }
}

const updateScheduleSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'ended']).optional(),
  target_article_count: z.number().optional(),
  publish_per_week: z.number().optional(),
  lead_time_days: z.number().optional(),
  overarching_goals: z.string().optional(),
  default_assignee_id: z.string().uuid().optional(),
  allow_concurrent: z.boolean().optional(),
  start_date: z.string().optional(),
  skip_next: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.troubadorSchedule.findFirst({
      where: { id, is_deleted: false },
    });
    if (!existing) throw new ApiError('Schedule not found', 404);

    const data = updateScheduleSchema.parse(await request.json());

    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.status !== undefined) update.status = data.status;
    if (data.target_article_count !== undefined) update.target_article_count = data.target_article_count;
    if (data.publish_per_week !== undefined) update.publish_per_week = data.publish_per_week;
    if (data.lead_time_days !== undefined) update.lead_time_days = data.lead_time_days;
    if (data.overarching_goals !== undefined) update.overarching_goals = data.overarching_goals;
    if (data.default_assignee_id !== undefined) update.default_assignee_id = data.default_assignee_id;
    if (data.allow_concurrent !== undefined) update.allow_concurrent = data.allow_concurrent;
    if (data.start_date !== undefined) update.start_date = new Date(data.start_date);
    if (data.skip_next !== undefined) update.skip_next = data.skip_next;

    const schedule = await prisma.troubadorSchedule.update({
      where: { id },
      data: update,
      include: scheduleInclude,
    });

    return NextResponse.json(formatScheduleResponse(schedule));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.troubadorSchedule.findFirst({
      where: { id, is_deleted: false },
    });
    if (!existing) throw new ApiError('Schedule not found', 404);

    await prisma.troubadorSchedule.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
