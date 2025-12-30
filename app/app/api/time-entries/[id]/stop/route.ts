import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const stopTimerSchema = z.object({
  ended_at: z.string().datetime().optional(),
});

async function stopTimer(request: NextRequest, id: string) {
  const auth = await requireAuth();

  const entry = await prisma.timeEntry.findUnique({
    where: { id },
  });

  if (!entry) {
    throw new ApiError('Time entry not found', 404);
  }

  if (entry.user_id !== auth.userId) {
    throw new ApiError('Not authorized', 403);
  }

  if (!entry.is_running) {
    throw new ApiError('Timer is not running', 400);
  }

  // Parse optional body for ended_at override
  let endedAt = new Date();
  try {
    const body = await request.json().catch(() => ({}));
    const data = stopTimerSchema.parse(body);
    if (data.ended_at) {
      endedAt = new Date(data.ended_at);
      // Validate ended_at is after started_at
      if (endedAt < entry.started_at) {
        throw new ApiError('End time cannot be before start time', 400);
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // If parsing fails, just use current time
  }

  const durationSeconds = Math.floor(
    (endedAt.getTime() - entry.started_at.getTime()) / 1000
  );
  const durationMinutes = Math.ceil(durationSeconds / 60);

  const updatedEntry = await prisma.timeEntry.update({
    where: { id },
    data: {
      is_running: false,
      ended_at: endedAt,
      duration: durationMinutes,
    },
    include: {
      task: { select: { id: true, title: true } },
      project: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ entry: updatedEntry });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await stopTimer(request, id);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await stopTimer(request, id);
  } catch (error) {
    return handleApiError(error);
  }
}
