/**
 * What happens when staff make a comment visible to the client (portal phase B slice 2, spec 3.3
 * to 3.5), on create or on toggle:
 *  - the wait effects: the reply and first-response clocks resolve, a question opens "awaiting
 *    the client";
 *  - the email notice is queued for the requester and everyone who wrote in the thread.
 * Nothing here sends mail; the notice waits in the outbox for the machine-side sender.
 *
 * Also the permission and wording gates for the flag, shared by POST /api/tasks/:id/comments and
 * PATCH /api/comments/:id so the two cannot drift.
 */
import type { TokenPayload } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { queuePortalNotices, cancelStaleNotices } from '@/lib/portal/notices';
import { bastWordError } from '@/lib/portal/thread';
import { onStaffReply } from '@/lib/portal/waits';

/** Who may set `client_visible`: staff pm and admin roles, and the Bast bot token. */
export function canShareWithClient(auth: Pick<TokenPayload, 'role' | 'userId'>): boolean {
  return auth.role === 'pm' || auth.role === 'admin' || auth.userId === BAST_USER_ID;
}

/** Throws the 403 or 400 that stops a comment from being shared. Pure apart from the throw. */
export function assertShareable(
  auth: Pick<TokenPayload, 'role' | 'userId'>,
  comment: { content: string; is_internal: boolean; client_question?: boolean }
): void {
  if (!canShareWithClient(auth)) {
    throw new ApiError('Only the team leads can show a comment to the client.', 403, 'forbidden');
  }
  if (comment.is_internal) {
    throw new ApiError('An internal note cannot be shown to the client.', 400, 'internal_note');
  }
  const bast = bastWordError(comment.content);
  if (bast) throw new ApiError(bast, 400, 'names_bast');
}

/** The comment just became client-visible. Best-effort: the comment is already saved. */
export async function afterReplyShared(comment: { id: string; task_id: string; client_question: boolean }): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: comment.task_id },
    select: {
      id: true,
      title: true,
      client_title: true,
      assignee_id: true,
      client_id: true,
      project_id: true,
      charter_id: true,
      site_id: true,
      requested_by_contact_id: true,
      site: { select: { client_id: true } },
    },
  });
  if (!task) return;
  const clientId = task.client_id ?? task.site?.client_id ?? null;
  const clientTitle = task.client_title ?? task.title;

  try {
    await onStaffReply(
      prisma,
      {
        id: task.id,
        client_title: clientTitle,
        assignee_id: task.assignee_id,
        client_id: clientId,
        project_id: task.project_id,
        charter_id: task.charter_id,
        site_id: task.site_id,
        requested_by_contact_id: task.requested_by_contact_id,
      },
      { id: comment.id, client_question: comment.client_question }
    );
  } catch (error) {
    console.error('portal wait effects failed after a shared reply', error);
  }
  try {
    await queuePortalNotices(
      { id: task.id, client_title: clientTitle, client_id: clientId, requested_by_contact_id: task.requested_by_contact_id },
      { id: comment.id }
    );
  } catch (error) {
    console.error('portal notice queueing failed after a shared reply', error);
  }
}

/** A reply stopped being client-visible (unflagged, made internal, edited or deleted): refresh the outbox. */
export async function afterReplyRetracted(): Promise<void> {
  try {
    await cancelStaleNotices();
  } catch (error) {
    console.error('portal notice cancel failed after a retracted reply', error);
  }
}
