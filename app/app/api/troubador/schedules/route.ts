import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatScheduleResponse } from '@/lib/api/troubador-formatters';
import { logCreate } from '@/lib/services/activity';

const scheduleInclude = {
  client: { select: { id: true, name: true } },
  site: { select: { id: true, name: true, url: true, site_type: true } },
  default_assignee: { select: { id: true, name: true, email: true } },
  _count: { select: { runs: true } },
};

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') ?? 'active';
    const client_id = searchParams.get('client_id') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where = {
      is_deleted: false,
      ...(status !== 'all' && { status: status as any }),
      ...(client_id && { client_id }),
    };

    const [items, total] = await Promise.all([
      prisma.troubadorSchedule.findMany({
        where,
        include: scheduleInclude,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.troubadorSchedule.count({ where }),
    ]);

    return NextResponse.json({
      schedules: items.map(formatScheduleResponse),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createScheduleSchema = z.object({
  client_id: z.string().uuid(),
  site_id: z.string().uuid(),
  name: z.string().min(1),
  target_article_count: z.number().optional(),
  publish_per_week: z.number().optional(),
  lead_time_days: z.number().optional(),
  overarching_goals: z.string().optional(),
  default_assignee_id: z.string().uuid().optional(),
  allow_concurrent: z.boolean().optional(),
  start_date: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createScheduleSchema.parse(body);

    const [client, site] = await Promise.all([
      prisma.client.findFirst({ where: { id: data.client_id, is_deleted: false } }),
      prisma.site.findFirst({ where: { id: data.site_id, is_deleted: false } }),
    ]);
    if (!client) throw new ApiError('Client not found', 404);
    if (!site) throw new ApiError('Site not found', 404);

    const schedule = await prisma.troubadorSchedule.create({
      data: {
        client_id: data.client_id,
        site_id: data.site_id,
        name: data.name,
        ...(data.target_article_count !== undefined && { target_article_count: data.target_article_count }),
        ...(data.publish_per_week !== undefined && { publish_per_week: data.publish_per_week }),
        ...(data.lead_time_days !== undefined && { lead_time_days: data.lead_time_days }),
        ...(data.overarching_goals !== undefined && { overarching_goals: data.overarching_goals }),
        ...(data.default_assignee_id !== undefined && { default_assignee_id: data.default_assignee_id }),
        ...(data.allow_concurrent !== undefined && { allow_concurrent: data.allow_concurrent }),
        start_date: new Date(data.start_date),
        created_by_id: auth.userId,
      },
      include: scheduleInclude,
    });

    logCreate(auth.userId, 'troubador_schedule', schedule.id, schedule.name);

    return NextResponse.json(formatScheduleResponse(schedule), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
