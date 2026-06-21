import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeRichText } from '@/lib/api/blocknote';
import {
  validateTaskToken,
  resolveTaskContact,
  getBastUserId,
  logPortalSession,
  getClientIp,
} from '@/lib/services/portal';

const newTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional().nullable(),
  site_id: z.string().uuid(),
});

// POST /api/portal/tasks/:token/new-task - Client files a new request from the portal.
// Public, token-gated. Creates a not_started task routed to Bast's triage queue, tagged with
// its client provenance (requested_by_contact_id, source: portal). The chosen site must belong
// to the acting contact's client.
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

    const body = await request.json();
    const data = newTaskSchema.parse(body);

    const contact = await resolveTaskContact(task);
    if (!contact) {
      throw new ApiError('No client contact is linked to this approval link', 400);
    }

    // The chosen site must belong to the contact's client (prevents filing against other clients).
    const site = await prisma.site.findFirst({
      where: { id: data.site_id, client_id: contact.client_id, is_deleted: false },
      select: { id: true, client_id: true },
    });
    if (!site) {
      throw new ApiError('That site is not available for this request', 400);
    }

    const bastUserId = await getBastUserId();

    const created = await prisma.task.create({
      data: {
        title: data.title,
        description: serializeRichText(data.description ?? null),
        status: 'not_started',
        priority: 3,
        site_id: site.id,
        client_id: site.client_id,
        // Route through Bast triage; Bast classifies/assigns on the next worker pass.
        assignee_id: bastUserId ?? undefined,
        created_by_id: bastUserId ?? undefined,
        source: 'portal',
        requested_by_contact_id: contact.id,
        needs_review: true,
      },
      select: { id: true, title: true, status: true },
    });

    await logPortalSession({
      tokenType: 'task_approval',
      entityId: task.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
      metadata: { new_task_id: created.id, contact_id: contact.id, site_id: site.id },
    });

    return NextResponse.json(
      { message: 'Thanks — your request has been received', task: created },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
