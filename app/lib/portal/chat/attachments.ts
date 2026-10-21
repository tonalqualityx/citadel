/**
 * Binding staged uploads to a message (phase C spec 6). An upload is staged under the contact and
 * an intake id or a conversation, unbound until a message references it. Unbound files older than
 * 24 hours are treated as expired (never deleted by code).
 */
import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { MAX_BYTES_PER_CONVERSATION, MAX_FILES_PER_MESSAGE } from '@/lib/services/uploads';

const DAY = 24 * 60 * 60 * 1000;

export async function bindAttachments(
  tx: Prisma.TransactionClient,
  input: {
    clientId: string;
    ids: string[];
    taskId: string;
    commentId: string;
    conversationId: string;
    intakeId?: string | null;
    now: Date;
  }
): Promise<string[]> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return [];
  if (ids.length > MAX_FILES_PER_MESSAGE) throw new ApiError(`At most ${MAX_FILES_PER_MESSAGE} files a message.`, 400, 'too_many_files');
  const rows = await tx.portalAttachment.findMany({
    where: { id: { in: ids }, client_id: input.clientId, is_deleted: false },
    select: { id: true, comment_id: true, conversation_id: true, intake_id: true, created_at: true },
  });
  const ok = rows.filter(
    (r) =>
      r.comment_id === null &&
      r.created_at.getTime() > input.now.getTime() - DAY &&
      (r.conversation_id === input.conversationId || (r.conversation_id === null && input.intakeId && r.intake_id === input.intakeId))
  );
  if (ok.length !== ids.length) throw new ApiError('One of those files is not available any more. Please attach it again.', 400, 'bad_attachment');
  const total = await tx.portalAttachment.aggregate({ where: { conversation_id: input.conversationId, is_deleted: false }, _sum: { size_bytes: true } });
  const adding = await tx.portalAttachment.aggregate({ where: { id: { in: ids } }, _sum: { size_bytes: true } });
  if ((total._sum.size_bytes ?? 0) + (adding._sum.size_bytes ?? 0) > MAX_BYTES_PER_CONVERSATION) {
    throw new ApiError('This conversation has reached its file limit.', 400, 'conversation_files_full');
  }
  await tx.portalAttachment.updateMany({
    where: { id: { in: ids } },
    data: { comment_id: input.commentId, task_id: input.taskId, conversation_id: input.conversationId },
  });
  return ids;
}
