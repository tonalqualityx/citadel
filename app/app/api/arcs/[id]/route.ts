import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatArcResponse } from '@/lib/api/formatters';
import { getArcStatus } from '@/lib/arc-status';

const updateArcSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  // Setting closed_at is the "close thread" action; null reopens; absent leaves untouched.
  closed_at: z.string().datetime().optional().nullable(),
});

const ARC_DETAIL_INCLUDE = {
  client: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, status: true } },
  tasks: {
    where: { is_deleted: false },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      due_date: true,
      assignee_id: true,
      assignee: { select: { id: true, name: true } },
      // Phase 3 — the arc board card: awaiting-review badge, same signal CharterKanban
      // already uses (status=done && needs_review && !approved).
      needs_review: true,
      approved: true,
    },
    orderBy: [{ priority: 'asc' as const }, { created_at: 'desc' as const }],
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const arc = await prisma.arc.findUnique({
      where: { id },
      include: ARC_DETAIL_INCLUDE,
    });

    if (!arc) {
      throw new ApiError('Arc not found', 404);
    }

    return NextResponse.json({
      ...formatArcResponse(arc, getArcStatus(arc)),
      tasks: arc.tasks,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const existing = await prisma.arc.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Arc not found', 404);
    }

    const body = await request.json();
    const data = updateArcSchema.parse(body);

    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id, is_deleted: false },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    if (data.project_id) {
      const project = await prisma.project.findUnique({
        where: { id: data.project_id, is_deleted: false },
      });
      if (!project) {
        throw new ApiError('Project not found', 404);
      }
    }

    const arc = await prisma.arc.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.client_id !== undefined && { client_id: data.client_id }),
        ...(data.project_id !== undefined && { project_id: data.project_id }),
        ...(data.closed_at !== undefined && {
          closed_at: data.closed_at ? new Date(data.closed_at) : null,
        }),
      },
      include: ARC_DETAIL_INCLUDE,
    });

    return NextResponse.json({
      ...formatArcResponse(arc, getArcStatus(arc)),
      tasks: arc.tasks,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
