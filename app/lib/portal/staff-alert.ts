/**
 * An in-app alert to the person who owns a task, for portal events that would otherwise be silent
 * (a client email that was not sent, a client note that arrived on a link with no contact). The
 * owner is the task's assignee when that is a person, otherwise Mike. Best-effort: a failed alert
 * never undoes the thing it reports.
 */
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { createNotification } from '@/lib/services/notifications';

export async function alertTaskOwner(taskId: string, title: string, message: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { assignee_id: true } });
    const userId = task?.assignee_id && task.assignee_id !== BAST_USER_ID ? task.assignee_id : MIKE_USER_ID;
    await createNotification({ userId, type: 'system_alert', title, message, entityType: 'task', entityId: taskId });
  } catch (error) {
    console.error('portal staff alert failed', error);
  }
}
