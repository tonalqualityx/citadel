import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import {
  validateTaskToken,
  resolveTaskContact,
  getBastUserId,
  logPortalSession,
  getClientIp,
} from '@/lib/services/portal';

const requestChangesSchema = z.object({
  note: z.string().min(1, 'Please describe what needs changing').max(5000),
});

// POST /api/portal/tasks/:token/request-changes - Client asks for rework. Public, token-gated.
// Re-opens the task (status → not_started) and records the client's note as a client-visible
// comment (the "what"). This is the client side of the team review-feedback loop.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const task = await validateTaskToken(token);

    if (!task) {
      return NextResponse.json(
        { error: 'Approval link not found or has expired' },
        { status: 404 }
      );
    }

    if (task.client_approved_at) {
      throw new ApiError('This work has already been approved', 400);
    }

    const body = await request.json();
    const { note } = requestChangesSchema.parse(body);

    const contact = await resolveTaskContact(task);
    const bastUserId = await getBastUserId();
    if (!bastUserId) {
      throw new ApiError('Unable to record your feedback right now', 500);
    }

    // Comments require a User author; the client is a ClientContact, so attribute to Bast and
    // label the source in the body. Client-visible (is_internal: false) so it shows in-thread.
    const attribution = contact?.name ? `${contact.name} (client)` : 'Client';
    await prisma.$transaction([
      prisma.comment.create({
        data: {
          task_id: task.id,
          user_id: bastUserId,
          content: `${attribution} requested changes via the approval portal:\n\n${note}`,
          is_internal: false,
        },
      }),
      prisma.task.update({
        where: { id: task.id },
        data: { status: 'not_started' },
      }),
    ]);

    await logPortalSession({
      tokenType: 'task_approval',
      entityId: task.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'changes_requested',
      metadata: { contact_id: contact?.id ?? null },
    });

    return NextResponse.json({ message: 'Thanks — sent back for changes', status: 'not_started' });
  } catch (error) {
    return handleApiError(error);
  }
}
