import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { notifyTaskDueSoon } from '@/lib/services/notifications';

/**
 * POST /api/cron/task-due-soon
 *
 * Sends notifications for tasks due within the next 24 hours.
 * Should be called daily by a cron job.
 *
 * Requires CRON_SECRET header for authorization.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const cronSecret = request.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find tasks due in the next 24 hours that:
    // - Have an assignee
    // - Are not done or abandoned
    // - Haven't already been notified (check via notification table)
    const tasksDueSoon = await prisma.task.findMany({
      where: {
        is_deleted: false,
        assignee_id: { not: null },
        status: { notIn: ['done', 'abandoned'] },
        due_date: {
          gte: now,
          lte: tomorrow,
        },
      },
      select: {
        id: true,
        title: true,
        assignee_id: true,
        due_date: true,
      },
    });

    // Check which ones haven't been notified yet today
    const notifiedToday = await prisma.notification.findMany({
      where: {
        type: 'task_due_soon',
        created_at: {
          gte: new Date(now.setHours(0, 0, 0, 0)),
        },
      },
      select: {
        entity_id: true,
        user_id: true,
      },
    });

    const notifiedSet = new Set(
      notifiedToday.map((n) => `${n.entity_id}:${n.user_id}`)
    );

    let notificationsSent = 0;

    for (const task of tasksDueSoon) {
      const key = `${task.id}:${task.assignee_id}`;
      if (!notifiedSet.has(key) && task.assignee_id) {
        await notifyTaskDueSoon(task.id, task.assignee_id);
        notificationsSent++;
      }
    }

    return NextResponse.json({
      success: true,
      tasksChecked: tasksDueSoon.length,
      notificationsSent,
    });
  } catch (error) {
    console.error('Error in task-due-soon cron:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
