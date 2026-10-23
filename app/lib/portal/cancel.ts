/**
 * A client cancels their own request (Mike's ruling, 2026-10-21).
 *
 * Any portal user who can see the request may cancel it (the approve rule). What happens:
 *  - the task becomes `abandoned` and gets the `client-cancelled` tag, in one conditional UPDATE, so
 *    two people cancelling at once change it once;
 *  - one client-visible line, "You cancelled this request.", signed Indelible, marked so the chat
 *    sweep never emails it (no email goes to the client or anywhere else on the early path);
 *  - the conversation closes (the composer goes away), queued reply jobs expire, and every open
 *    wait on the task is closed with the resolution `cancelled`;
 *  - when work may be under way (in progress, blocked or in review) the assignee gets a Citadel
 *    notification and one email, so the person stops (staff-notify.notifyClientCancelled).
 *
 * Approved work that is not live yet is cancellable too (Mike, 2026-10-23): the client-approved tag
 * is removed so the publish pass never picks it up, and when the assignee is Bast, Mike is told
 * instead because a publish pass may be mid-run.
 *
 * Not cancellable: live work (status done, 409 `live`: the page offers "Ask for a change"). A cancelled
 * request stays cancelled for the client; staff reopen it in Citadel. A repeat is a no-op.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { taskAccessWhere, type PortalAccess } from '@/lib/portal/access';
import { clientVisibleTaskWhere } from '@/lib/portal/visibility';
import { CLIENT_CANCELLED_TAG } from '@/lib/portal/status-labels';
import { cancelMode, isApprovedNotLive, workMayBeUnderWay } from '@/lib/portal/cancel-state';
import { CANCEL_LINE, CANCEL_LIVE_ERROR } from '@/lib/portal/cancel-copy';
import { notifyClientCancelled } from '@/lib/portal/staff-notify';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { OPEN_STATES, resolveWait } from '@/lib/waits/sweeper';

export interface CancelResult {
  /** True when this call did the cancelling; false for a repeat. */
  cancelled: boolean;
  already_cancelled: boolean;
  /** A person was told to stop (the early path tells nobody). */
  staff_notified: boolean;
}

/** The task a contact may cancel: the same visibility and scope as the work page. */
async function findTask(access: PortalAccess, taskId: string) {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      is_deleted: false,
      AND: [{ OR: [{ client_id: access.clientId }, { site: { client_id: access.clientId } }] }, clientVisibleTaskWhere(), taskAccessWhere(access)],
    },
    select: { id: true, status: true, tags: true, client_approved_at: true, client_title: true, title: true },
  });
}

export async function cancelRequest(access: PortalAccess, taskId: string, now: Date = new Date()): Promise<CancelResult> {
  const task = await findTask(access, taskId);
  if (!task) throw new ApiError('Not found', 404);

  const mode = cancelMode(task);
  if (mode === 'cancelled') return { cancelled: false, already_cancelled: true, staff_notified: false };
  if (mode === 'live') throw new ApiError(CANCEL_LIVE_ERROR, 409, 'live');
  const approved = isApprovedNotLive(task);
  const underWay = workMayBeUnderWay(task.status);

  const won = await prisma.$transaction(async (tx) => {
    // One conditional UPDATE decides the winner. It re-checks the rules the read above used.
    const n = await tx.$executeRaw`
      UPDATE tasks
         SET status = 'abandoned'::"TaskStatus",
             tags = array_append(array_remove(array_remove(array_remove(tags, 'awaiting-clarification'), 'chat-clarifying'), 'client-approved'), ${CLIENT_CANCELLED_TAG}),
             updated_at = ${now}
       WHERE id = ${taskId}::uuid
         AND status NOT IN ('abandoned', 'done')`;
    if (n !== 1) return false;

    // chat_meta marks the line as already shown, so the chat sweep never emails it.
    await tx.comment.create({
      data: { task_id: taskId, user_id: BAST_USER_ID, content: CANCEL_LINE, is_internal: false, client_visible: true, chat_meta: { email_notice: 'cancelled' } },
    });
    const contact = await tx.clientContact.findFirst({ where: { id: access.contactId }, select: { name: true } });
    await tx.comment.create({
      data: {
        task_id: taskId,
        user_id: BAST_USER_ID,
        content: `The client cancelled this request in the portal${contact?.name ? ` (${contact.name})` : ''}. Status set to abandoned. Reopen it here if that was a mistake.`,
        is_internal: true,
        client_visible: false,
      },
    });

    const convo = await tx.chatConversation.findUnique({ where: { task_id: taskId }, select: { id: true } });
    if (convo) {
      await tx.chatConversation.update({ where: { id: convo.id }, data: { state: 'closed', open_ask: Prisma.DbNull } });
      await tx.engineJob.updateMany({ where: { conversation_id: convo.id, status: { in: ['queued', 'claimed'] } }, data: { status: 'expired' } });
    }

    const store = prismaSweepStore(tx as unknown as PrismaClient);
    const open = await tx.wait.findMany({ where: { task_id: taskId, state: { in: [...OPEN_STATES] } } });
    for (const w of open) {
      await resolveWait(store, w, 'cancelled', { now, source: 'api', reason: 'The client cancelled the request in the portal.' });
    }
    return true;
  });

  if (!won) {
    // Someone else got there first, or the task moved on while we read it. Say what is true now.
    const fresh = await findTask(access, taskId);
    if (!fresh) throw new ApiError('Not found', 404);
    const m = cancelMode(fresh);
    if (m === 'cancelled') return { cancelled: false, already_cancelled: true, staff_notified: false };
    throw new ApiError(CANCEL_LIVE_ERROR, 409, 'live');
  }

  let staffNotified = false;
  if (underWay || approved) {
    const sent = await notifyClientCancelled(taskId, access.contactId, { approved });
    staffNotified = sent.notified || sent.emailed;
  }
  return { cancelled: true, already_cancelled: false, staff_notified: staffNotified };
}
