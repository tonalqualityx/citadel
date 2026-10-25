import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess, taskAccessWhere } from '@/lib/portal/access';
import {
  clientVisibleTaskWhere,
  stagedTaskWhere,
  isClientVisibleTask,
  isStagedForApproval,
  VISIBILITY_SELECT,
} from '@/lib/portal/visibility';
import { recordTaskClientApproval, logPortalSession, getClientIp } from '@/lib/services/portal';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';
import { expectedPreview, previewChangedResponse } from '@/lib/portal/approval-preview';

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
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const session = await requireClientAuth();
    const { id } = await params;

    // Mike's ruling (overrides spec decision 11): for now ANY portal user may approve / request
    // changes, so there is deliberately no role gate here. The task must still sit in a project
    // this contact may see (hidden/restricted closed by id too). 404, not 403.
    const access = await loadPortalAccess(session);

    const task = await prisma.task.findFirst({
      where: {
        id,
        is_deleted: false,
        OR: [{ client_id: session.clientId }, { site: { client_id: session.clientId } }],
        // Leak 2: act only on client-visible tasks that are staged for approval.
        AND: [clientVisibleTaskWhere(), stagedTaskWhere(), taskAccessWhere(access)],
      },
      select: {
        id: true,
        client_approved_at: true,
        site: { select: { auto_deploy: true } },
        ...VISIBILITY_SELECT,
      },
    });

    // 404 rather than 403 for both "not found" and "belongs to another client" — existence of
    // another client's task is never leaked, matching the articles session-route convention.
    if (!task || !isClientVisibleTask(task) || !isStagedForApproval(task)) {
      throw new ApiError('Task not found', 404);
    }

    const seen = await expectedPreview(request);
    const result = await recordTaskClientApproval(task, session.contactId, 'portal', seen.previewUrl, seen.deployedAt);

    if (result.preview_changed) return previewChangedResponse(result.staging_preview_url ?? null, result.staging_deployed_at ?? null);

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
