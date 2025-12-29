import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const createTimeEntrySchema = z.object({
  task_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional().nullable(),
  duration: z.number().min(0), // Duration in minutes
  description: z.string().max(500).optional().nullable(),
  is_billable: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const userId = searchParams.get('user_id') || undefined;
    const taskId = searchParams.get('task_id') || undefined;
    const projectId = searchParams.get('project_id') || undefined;
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;

    // Build where clause
    const where: any = {
      is_deleted: false,
      is_running: false, // Only return completed entries
      ...(userId && { user_id: userId }),
      ...(taskId && { task_id: taskId }),
      ...(projectId && { project_id: projectId }),
    };

    // Date range filter
    if (startDate || endDate) {
      where.started_at = {};
      if (startDate) {
        where.started_at.gte = new Date(startDate);
      }
      if (endDate) {
        where.started_at.lte = new Date(endDate);
      }
    }

    // For tech users, only show their own entries by default
    if (auth.role === 'tech' && !userId) {
      where.user_id = auth.userId;
    }

    const [entries, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: {
          user: { select: { id: true, name: true } },
          task: { select: { id: true, title: true } },
          project: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { started_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.timeEntry.count({ where }),
    ]);

    return NextResponse.json({
      entries,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await request.json();
    const data = createTimeEntrySchema.parse(body);

    // Resolve project_id from task if not provided
    let projectId = data.project_id;
    if (!projectId && data.task_id) {
      const task = await prisma.task.findUnique({
        where: { id: data.task_id },
        select: { project_id: true },
      });
      projectId = task?.project_id;
    }

    const entry = await prisma.timeEntry.create({
      data: {
        task_id: data.task_id,
        project_id: projectId,
        user_id: auth.userId,
        started_at: new Date(data.started_at),
        ended_at: data.ended_at ? new Date(data.ended_at) : null,
        duration: data.duration,
        description: data.description,
        is_billable: data.is_billable ?? true,
        is_running: false,
      },
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
