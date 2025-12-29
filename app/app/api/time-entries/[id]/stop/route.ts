import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

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

    const endedAt = new Date();
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
  } catch (error) {
    return handleApiError(error);
  }
}
