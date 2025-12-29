import { prisma } from '@/lib/db/prisma';
import { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  bundleKey?: string;
}

export async function createNotification(params: CreateNotificationParams) {
  const { userId, type, title, message, entityType, entityId, bundleKey } = params;

  // If bundling, check for existing recent notification with same bundle key
  if (bundleKey) {
    const existingBundle = await prisma.notification.findFirst({
      where: {
        user_id: userId,
        bundle_key: bundleKey,
        is_read: false,
        created_at: {
          gte: new Date(Date.now() - 30 * 60 * 1000), // Last 30 minutes
        },
      },
    });

    if (existingBundle) {
      // Update bundle count instead of creating new
      return prisma.notification.update({
        where: { id: existingBundle.id },
        data: {
          bundle_count: existingBundle.bundle_count + 1,
          title: `${title.replace(/ \(\d+\)$/, '')} (${existingBundle.bundle_count + 1})`,
          created_at: new Date(), // Bump to top
        },
      });
    }
  }

  return prisma.notification.create({
    data: {
      user_id: userId,
      type,
      title,
      message,
      entity_type: entityType,
      entity_id: entityId,
      bundle_key: bundleKey,
    },
  });
}

// Notification triggers
export async function notifyTaskAssigned(
  taskId: string,
  assigneeId: string,
  assignerName: string
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, project: { select: { name: true } } },
  });

  if (!task) return;

  await createNotification({
    userId: assigneeId,
    type: 'task_assigned',
    title: `New quest assigned: ${task.title}`,
    message: task.project ? `In pact: ${task.project.name}` : undefined,
    entityType: 'task',
    entityId: taskId,
    bundleKey: `task_assigned_${assigneeId}`,
  });
}

export async function notifyTaskStatusChanged(
  taskId: string,
  newStatus: string,
  interestedUserIds: string[]
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true },
  });

  if (!task) return;

  const statusLabels: Record<string, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
    blocked: 'Blocked',
    abandoned: 'Abandoned',
  };

  for (const userId of interestedUserIds) {
    await createNotification({
      userId,
      type: 'task_status_changed',
      title: `Quest "${task.title}" is now ${statusLabels[newStatus] || newStatus}`,
      entityType: 'task',
      entityId: taskId,
      bundleKey: `task_status_${userId}`,
    });
  }
}

export async function notifyReviewRequested(taskId: string, reviewerIds: string[]) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, assignee: { select: { name: true } } },
  });

  if (!task) return;

  for (const reviewerId of reviewerIds) {
    await createNotification({
      userId: reviewerId,
      type: 'review_requested',
      title: `Review requested: ${task.title}`,
      message: task.assignee ? `From: ${task.assignee.name}` : undefined,
      entityType: 'task',
      entityId: taskId,
    });
  }
}

export async function notifyTaskDueSoon(taskId: string, assigneeId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, due_date: true },
  });

  if (!task || !task.due_date) return;

  await createNotification({
    userId: assigneeId,
    type: 'task_due_soon',
    title: `Quest due soon: ${task.title}`,
    message: `Due: ${task.due_date.toLocaleDateString()}`,
    entityType: 'task',
    entityId: taskId,
  });
}

export async function notifyProjectStatusChanged(
  projectId: string,
  newStatus: string,
  teamMemberIds: string[]
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });

  if (!project) return;

  const statusLabels: Record<string, string> = {
    draft: 'Draft',
    quote: 'Quote',
    ready: 'Ready',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
    archived: 'Archived',
  };

  for (const userId of teamMemberIds) {
    await createNotification({
      userId,
      type: 'project_status_changed',
      title: `Pact "${project.name}" is now ${statusLabels[newStatus] || newStatus}`,
      entityType: 'project',
      entityId: projectId,
      bundleKey: `project_status_${userId}`,
    });
  }
}

export async function notifyRetainerAlert(
  clientId: string,
  clientName: string,
  hoursUsed: number,
  hoursTotal: number,
  pmUserIds: string[]
) {
  const percentUsed = Math.round((hoursUsed / hoursTotal) * 100);

  for (const userId of pmUserIds) {
    await createNotification({
      userId,
      type: 'retainer_alert',
      title: `Retainer alert: ${clientName}`,
      message: `${percentUsed}% used (${hoursUsed}/${hoursTotal} hours)`,
      entityType: 'client',
      entityId: clientId,
    });
  }
}
