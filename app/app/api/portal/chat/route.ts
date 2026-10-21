import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { MESSAGE_MAX_CHARS } from '@/lib/portal/thread';
import { startChat } from '@/lib/portal/chat/file-early';
import { chatAvailability } from '@/lib/portal/chat/switches';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

const bodySchema = z.object({
  intake_id: z.string().uuid(),
  client_ref: z.string().uuid(),
  text: z.string().max(MESSAGE_MAX_CHARS).default(''),
  site_id: z.string().uuid().nullish(),
  attachment_ids: z.array(z.string().uuid()).max(10).default([]),
}).refine((b) => b.text.trim().length > 0 || b.attachment_ids.length > 0, { message: 'A message needs words or a file.', path: ['text'] });

// Reasons that mean "this contact does not get the chat at all" (the page shows the stepper).
// A dead runner or a spend cap still opens the chat, in tree mode.
const STEPPER_REASONS = new Set(['mode_off', 'not_pilot', 'site_off']);

// POST /api/portal/chat { intake_id, client_ref, text, site_id?, attachment_ids[] } (portal phase C)
// The client's first message. Saves the words verbatim and files the task in the same transaction,
// then queues a reply job (or runs the question tree). 201 { conversation_id, task_id, mode } when
// new, 200 on a repeat. 409 chat_unavailable when the switches are off for this contact.
export async function POST(request: NextRequest) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const body = bodySchema.parse(await request.json());
    const contact = await prisma.clientContact.findFirst({ where: { id: access.contactId, is_deleted: false }, select: { id: true, name: true } });
    if (!contact) throw new ApiError('Not found', 404);

    const avail = await chatAvailability({ contactId: access.contactId, clientId: access.clientId, siteId: body.site_id ?? null });
    if (!avail.available && STEPPER_REASONS.has(avail.reason)) {
      const existing = await prisma.chatConversation.findUnique({ where: { intake_id: body.intake_id }, select: { id: true } });
      if (!existing) return NextResponse.json({ error: 'Chat is not available', code: 'chat_unavailable', reason: avail.reason }, { status: 409 });
    }
    const started = await startChat(access, contact, body);
    return NextResponse.json({ conversation_id: started.conversation_id, task_id: started.task_id, mode: started.mode, route: started.route }, { status: started.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
