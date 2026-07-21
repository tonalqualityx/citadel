import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatIdeaResponse } from '@/lib/api/formatters';

const updateIdeaSchema = z.object({
  status: z.enum(['open', 'kept', 'promoted', 'discarded']).optional(),
  text: z.string().min(1).optional(),
  promoted_task_id: z.string().uuid().optional().nullable(),
});

const IDEA_INCLUDE = {
  promoted_task: { select: { id: true, title: true } },
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const idea = await prisma.idea.findUnique({
      where: { id },
      include: IDEA_INCLUDE,
    });

    if (!idea) {
      throw new ApiError('Idea not found', 404);
    }

    return NextResponse.json(formatIdeaResponse(idea));
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

    const existing = await prisma.idea.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Idea not found', 404);
    }

    const body = await request.json();
    const data = updateIdeaSchema.parse(body);

    if (data.promoted_task_id) {
      const task = await prisma.task.findUnique({
        where: { id: data.promoted_task_id, is_deleted: false },
      });
      if (!task) {
        throw new ApiError('Task not found', 404);
      }
    }

    const idea = await prisma.idea.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.text !== undefined && { text: data.text }),
        ...(data.promoted_task_id !== undefined && { promoted_task_id: data.promoted_task_id }),
      },
      include: IDEA_INCLUDE,
    });

    return NextResponse.json(formatIdeaResponse(idea));
  } catch (error) {
    return handleApiError(error);
  }
}
