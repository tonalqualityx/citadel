import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { validateTaskToken, logPortalSession, getClientIp } from '@/lib/services/portal';
import { formatTaskForClient } from '@/lib/api/client-projections';

// GET /api/portal/tasks/:token - View a task's client approval page (public, no auth)
export async function GET(
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

    // Log portal access
    await logPortalSession({
      tokenType: 'task_approval',
      entityId: task.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
    });

    // The client-safe projection is the single source of truth for task fields.
    // staging_preview_url / staging_deployed_at are returned at the endpoint level
    // (they are client-facing here) so the projection stays internal-safe by default.
    return NextResponse.json({
      task: formatTaskForClient(task),
      staging_preview_url: task.staging_preview_url ?? null,
      staging_deployed_at: task.staging_deployed_at ?? null,
      already_approved: Boolean(task.client_approved_at),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
