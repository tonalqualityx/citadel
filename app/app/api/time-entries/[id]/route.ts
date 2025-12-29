import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateTimeEntrySchema = z.object({
  task_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional().nullable(),
  duration: z.number().min(0).optional(),
  description: z.string().max(500).optional().nullable(),
  is_billable: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    });

    if (!entry || entry.is_deleted) {
      throw new ApiError('Time entry not found', 404);
    }

    // Tech users can only see their own entries
    if (auth.role === 'tech' && entry.user_id !== auth.userId) {
      throw new ApiError('Not authorized', 403);
    }

    return NextResponse.json({ entry });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const data = updateTimeEntrySchema.parse(body);

    const existing = await prisma.timeEntry.findUnique({
      where: { id },
    });

    if (!existing || existing.is_deleted) {
      throw new ApiError('Time entry not found', 404);
    }

    // Only the owner can edit their entries
    if (existing.user_id !== auth.userId) {
      throw new ApiError('Not authorized', 403);
    }

    const entry = await prisma.timeEntry.update({
      where: { id },
      data: {
        ...(data.task_id !== undefined && { task_id: data.task_id }),
        ...(data.project_id !== undefined && { project_id: data.project_id }),
        ...(data.started_at && { started_at: new Date(data.started_at) }),
        ...(data.ended_at !== undefined && {
          ended_at: data.ended_at ? new Date(data.ended_at) : null,
        }),
        ...(data.duration !== undefined && { duration: data.duration }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.is_billable !== undefined && { is_billable: data.is_billable }),
      },
      include: {
        user: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ entry });
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
    const { id } = await params;

    const existing = await prisma.timeEntry.findUnique({
      where: { id },
    });

    if (!existing || existing.is_deleted) {
      throw new ApiError('Time entry not found', 404);
    }

    // Only the owner can delete their entries
    if (existing.user_id !== auth.userId) {
      throw new ApiError('Not authorized', 403);
    }

    await prisma.timeEntry.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
