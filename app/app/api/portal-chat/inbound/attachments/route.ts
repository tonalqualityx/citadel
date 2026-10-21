import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { effectiveClientRole } from '@/lib/portal/access';
import { MAX_FILE_BYTES } from '@/lib/services/uploads';
import { stageUpload } from '@/lib/portal/chat/upload-service';
import { findConversation, senderContact } from '@/lib/portal/chat/inbound';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

// POST /api/portal-chat/inbound/attachments (portal phase C, slice C4; bot)
// multipart: file, from_email, token | task_id. Stages one email attachment under the verified
// sender with the portal's own allowlist (magic bytes, no SVG, HTML, archives or macro Office).
export async function POST(request: NextRequest) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const form = await request.formData();
    const file = form.get('file') as { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } | string | null;
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw new ApiError('No file provided', 400, 'bad_upload');
    if (file.size > MAX_FILE_BYTES) throw new ApiError('That file is too large. The limit is 20 MB.', 413, 'file_too_large');
    const token = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/).nullish().parse(form.get('token') || null);
    const taskId = z.string().uuid().nullish().parse(form.get('task_id') || null);
    const from = z.string().min(3).max(320).parse(form.get('from_email'));
    const convo = await findConversation({ token: token ?? undefined, task_id: taskId ?? undefined });
    if (!convo) throw new ApiError('Not found', 404);
    const person = await senderContact(convo, from);
    if (!person) throw new ApiError('Not found', 404);
    const contact = await prisma.clientContact.findUniqueOrThrow({ where: { id: person.id } });
    const client = await prisma.client.findUniqueOrThrow({ where: { id: convo.client_id }, select: { id: true, parent_agency_id: true } });
    const access = { contactId: contact.id, contactIds: [contact.id], clientId: convo.client_id, role: effectiveClientRole(contact, client) };
    const att = await stageUpload(access, { buffer: Buffer.from(await file.arrayBuffer()), name: file.name, conversation_id: convo.id });
    await prisma.portalAttachment.update({ where: { id: att.id }, data: { source: 'email' } });
    return NextResponse.json({ attachment: { id: att.id, name: att.filename, type: att.content_type, size: att.size_bytes } }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
