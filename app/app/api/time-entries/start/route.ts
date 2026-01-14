import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const startTimerSchema = z.object({
  task_id: z.string().uuid(),
  project_id: z.string().uuid().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await request.json();
    const { task_id, project_id } = startTimerSchema.parse(body);

    // Stop any existing running timer for this user
    const existingTimers = await prisma.timeEntry.findMany({
      where: {
        user_id: auth.userId,
        is_running: true,
      },
    });

    for (const existing of existingTimers) {
      const endedAt = new Date();
      const durationSeconds = Math.floor(
        (endedAt.getTime() - existing.started_at.getTime()) / 1000
      );
      const durationMinutes = Math.ceil(durationSeconds / 60);

      await prisma.timeEntry.update({
        where: { id: existing.id },
        data: {
          is_running: false,
          ended_at: endedAt,
          duration: durationMinutes,
        },
      });
    }

    // Get task for project_id if not provided
    let resolvedProjectId = project_id;
    if (!resolvedProjectId) {
      const task = await prisma.task.findUnique({
        where: { id: task_id },
        select: { project_id: true },
      });
      resolvedProjectId = task?.project_id;
    }

    // Create new running timer
    const timer = await prisma.timeEntry.create({
      data: {
        task_id,
        project_id: resolvedProjectId,
        user_id: auth.userId,
        started_at: new Date(),
        is_running: true,
        duration: 0,
      },
      include: {
        task: { select: { id: true, title: true } },
        project: { select: { id: true, name: true } },
      },
    });

    // Update task: set to in_progress if not_started, and always set is_focus
    // First, update status if not_started
    await prisma.task.updateMany({
      where: {
        id: task_id,
        status: 'not_started',
      },
      data: {
        status: 'in_progress',
        started_at: new Date(),
        is_focus: true,
      },
    });

    // Also set is_focus=true for tasks already in progress
    await prisma.task.updateMany({
      where: {
        id: task_id,
        status: { not: 'not_started' },
      },
      data: {
        is_focus: true,
      },
    });

    // Auto-assign task to current user if unassigned
    await prisma.task.updateMany({
      where: {
        id: task_id,
        assignee_id: null,
      },
      data: {
        assignee_id: auth.userId,
      },
    });

    return NextResponse.json({ timer });
  } catch (error) {
    return handleApiError(error);
  }
}
