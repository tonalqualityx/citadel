import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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
import { recordTaskClientRequestChanges, logPortalSession, getClientIp } from '@/lib/services/portal';

const requestChangesSchema = z.object({
  note: z.string().min(1, 'Please describe what needs changing').max(5000),
});

// POST /api/portal/tasks/mine/:id/request-changes (Portal v2 phase 1)
// Session-scoped equivalent of POST /api/portal/tasks/:token/request-changes. Same mutation
// (recordTaskClientRequestChanges, shared with the token flow). Requires a client_session cookie;
// scope enforced via the query, never the URL.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
        title: true,
        client_title: true,
        assignee_id: true,
        client_id: true,
        project_id: true,
        charter_id: true,
        site_id: true,
        client_approved_at: true,
        ...VISIBILITY_SELECT,
      },
    });

    if (!task || !isClientVisibleTask(task) || !isStagedForApproval(task)) {
      throw new ApiError('Task not found', 404);
    }

    const body = await request.json();
    const { note } = requestChangesSchema.parse(body);

    // The session identifies the acting contact directly (more precise than the token flow's
    // best-guess resolveTaskContact, which has no login to anchor on).
    const contact = await prisma.clientContact.findUnique({
      where: { id: session.contactId },
      select: { name: true },
    });

    await recordTaskClientRequestChanges(task, note, contact?.name ?? null, session.contactId);

    await logPortalSession({
      tokenType: 'task_approval',
      entityId: task.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'changes_requested',
      metadata: { contact_id: session.contactId, via: 'session' },
    });

    return NextResponse.json({ message: 'Thanks — sent back for changes', status: 'not_started' });
  } catch (error) {
    return handleApiError(error);
  }
}
