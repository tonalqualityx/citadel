import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { isStagedForApproval } from '@/lib/portal/visibility';
import {
  validateTaskToken,
  resolveTaskContact,
  recordTaskClientApproval,
  logPortalSession,
  getClientIp,
} from '@/lib/services/portal';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';
import { expectedPreview, previewChangedResponse } from '@/lib/portal/approval-preview';

// POST /api/portal/tasks/:token/approve - Client approves the staged work. Public, token-gated.
// Sets client_approved_at + approved_by_contact_id. For staged client sites
// (site.auto_deploy === false) the actual staging→prod promotion is a separate operator step
// (no in-app deploy pipeline yet), so we record a promotion-pending marker rather than deploy.
// Mutation core lives in recordTaskClientApproval() (lib/services/portal.ts), shared with the
// session-scoped equivalent at POST /api/portal/tasks/:id/approve.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  try {
    const { token } = await params;
    const task = await validateTaskToken(token);

    // A deleted requester revokes the link (no fallback to the primary contact: that would
    // attribute the action to someone who did not take it). Only work staged for the client can be acted on. A stale link to a task that was sent back
    // for changes (or is already published) must not record an approval that the worker would
    // later read as the client's yes on unseen rework.
    if (!task || task.requested_by_contact?.is_deleted || (!isStagedForApproval(task) && !task.client_approved_at)) {
      return NextResponse.json(
        { error: 'Approval link not found or has expired' },
        { status: 404 }
      );
    }

    const contact = await resolveTaskContact(task);

    // Mike's ruling (overrides spec decision 11): no role gate on approval links for now.
    const result = await recordTaskClientApproval(task, contact?.id ?? null, 'approval_link', await expectedPreview(request));

    if (result.preview_changed) return previewChangedResponse(result.staging_preview_url ?? null);

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
      metadata: { approved_by_contact_id: contact?.id ?? null, promotion_pending: result.promotion_pending },
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
