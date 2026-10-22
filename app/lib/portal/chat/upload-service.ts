/**
 * Staging an upload (phase C spec 6): validate by magic bytes, check the per-contact and
 * per-conversation limits, store privately, record the row unbound. Used by the portal route.
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { PortalAccess } from '@/lib/portal/access';
import { MAX_BYTES_PER_CONVERSATION, MAX_UPLOADS_PER_CONTACT_DAY, MAX_UPLOADS_PER_CONTACT_HOUR, validateUpload } from '@/lib/services/uploads';
import { putPrivate, storageKey } from '@/lib/services/private-storage';
import { threadTaskWhere } from '@/lib/portal/thread';

const DAY = 24 * 60 * 60 * 1000;

export async function stageUpload(
  access: PortalAccess,
  input: { buffer: Buffer; name: string; intake_id?: string | null; conversation_id?: string | null; task_id?: string | null },
  now: Date = new Date()
) {
  if (access.revoked || access.role === 'none') throw new ApiError('Not found', 404);
  if (!input.intake_id && !input.conversation_id && !input.task_id) throw new ApiError('Missing conversation', 400, 'bad_upload');
  const checked = validateUpload(input.buffer, input.name);
  if (!checked.ok) throw new ApiError(checked.reason, checked.status, 'bad_file');

  let conversationId: string | null = null;
  if (input.conversation_id) {
    const convo = await prisma.chatConversation.findUnique({ where: { id: input.conversation_id }, select: { id: true, client_id: true, task_id: true } });
    if (!convo || convo.client_id !== access.clientId) throw new ApiError('Not found', 404);
    const ok = await prisma.task.findFirst({ where: threadTaskWhere(access, convo.task_id), select: { id: true } });
    if (!ok) throw new ApiError('Not found', 404);
    conversationId = convo.id;
  }
  // A work page whose conversation is not open yet: files are scoped to the task and bind when it opens.
  let taskId: string | null = null;
  if (!conversationId && !input.intake_id && input.task_id) {
    const ok = await prisma.task.findFirst({ where: threadTaskWhere(access, input.task_id), select: { id: true } });
    if (!ok) throw new ApiError('Not found', 404);
    taskId = ok.id;
  }
  const ids = access.contactIds && access.contactIds.length > 0 ? access.contactIds : [access.contactId];
  const since = new Date(now.getTime() - DAY);
  const [today, lastHour, used] = await Promise.all([
    prisma.portalAttachment.count({ where: { uploaded_by_contact_id: { in: ids }, created_at: { gte: since } } }),
    prisma.portalAttachment.count({ where: { uploaded_by_contact_id: { in: ids }, created_at: { gte: new Date(now.getTime() - 60 * 60 * 1000) } } }),
    prisma.portalAttachment.aggregate({
      where: conversationId
        ? { conversation_id: conversationId, is_deleted: false }
        : taskId
          ? { task_id: taskId, client_id: access.clientId, is_deleted: false }
          : { intake_id: input.intake_id!, client_id: access.clientId, is_deleted: false },
      _sum: { size_bytes: true },
    }),
  ]);
  if (lastHour >= MAX_UPLOADS_PER_CONTACT_HOUR) throw new ApiError('You have uploaded a lot of files in a short time. Please try again in a few minutes.', 429, 'rate_limited', 'uploads_per_hour');
  if (today >= MAX_UPLOADS_PER_CONTACT_DAY) throw new ApiError('You have uploaded a lot of files today. Please try again tomorrow.', 429, 'rate_limited', 'uploads_per_day');
  if ((used._sum.size_bytes ?? 0) + checked.file.size_bytes > MAX_BYTES_PER_CONVERSATION) throw new ApiError('This conversation has reached its file limit.', 400, 'conversation_files_full');

  const id = crypto.randomUUID();
  const key = storageKey(access.clientId, id);
  await putPrivate(key, input.buffer, checked.file.content_type);
  return prisma.portalAttachment.create({
    data: {
      id,
      client_id: access.clientId,
      conversation_id: conversationId,
      task_id: taskId,
      intake_id: conversationId || taskId ? null : input.intake_id ?? null,
      uploaded_by_contact_id: access.contactId,
      source: 'portal',
      storage_key: key,
      filename: checked.file.filename,
      content_type: checked.file.content_type,
      size_bytes: checked.file.size_bytes,
      sha256: checked.file.sha256,
    },
    select: { id: true, filename: true, content_type: true, size_bytes: true },
  });
}
