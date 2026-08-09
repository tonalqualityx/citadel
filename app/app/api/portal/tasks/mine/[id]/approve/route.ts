import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { recordTaskClientApproval, logPortalSession, getClientIp } from '@/lib/services/portal';

// POST /api/portal/tasks/mine/:id/approve (Portal v2 phase 1)
// Session-scoped equivalent of POST /api/portal/tasks/:token/approve. Same mutation
// (recordTaskClientApproval, shared with the token flow) — only the auth layer differs: the
// client_session cookie IS the credential here, so no portal_token needs to exist or be minted.
// Requires a client_session cookie; scope is enforced via the query (client_id resolution
// mirrors the token flow's dual client_id/site.client_id fallback), never from the URL.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireClientAuth();
    const { id } = await params;

    const task = await prisma.task.findFirst({
      where: {
        id,
        is_deleted: false,
        OR: [{ client_id: session.clientId }, { site: { client_id: session.clientId } }],
      },
      select: {
        id: true,
        client_approved_at: true,
        site: { select: { auto_deploy: true } },
      },
    });

    // 404 rather than 403 for both "not found" and "belongs to another client" — existence of
    // another client's task is never leaked, matching the articles session-route convention.
    if (!task) {
      throw new ApiError('Task not found', 404);
    }

    const result = await recordTaskClientApproval(task, session.contactId);

    if (result.already_approved) {
      return NextResponse.json({
        message: 'Already approved',
        already_approved: true,
        approved_at: result.approved_at,
      });
    }

    await logPortalSession({
      tokenType: 'task_approval',
      entityId: task.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'accept',
      metadata: {
        approved_by_contact_id: session.contactId,
        promotion_pending: result.promotion_pending,
        via: 'session',
      },
    });

    return NextResponse.json({
      message: 'Approved',
      approved_at: result.approved_at,
      promotion_pending: result.promotion_pending,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
