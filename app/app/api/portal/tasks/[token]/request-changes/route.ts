import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { isStagedForApproval } from '@/lib/portal/visibility';
import {
  validateTaskToken,
  recordTaskClientRequestChanges,
  recordUnattributedSendBack,
  logPortalSession,
  getClientIp,
} from '@/lib/services/portal';

const requestChangesSchema = z.object({
  note: z.string().min(1, 'Please describe what needs changing').max(5000),
});

// POST /api/portal/tasks/:token/request-changes - Client asks for rework. Public, token-gated.
// Re-opens the task (status → not_started) and records the client's note as a client-visible
// comment (the "what"). This is the client side of the team review-feedback loop. Mutation core
// lives in recordTaskClientRequestChanges() (lib/services/portal.ts), shared with the
// session-scoped equivalent at POST /api/portal/tasks/:id/request-changes.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const task = await validateTaskToken(token);

    // A deleted requester revokes the link (no fallback to the primary contact: that would
    // attribute the action to someone who did not take it). Only work staged for the client can be acted on. A stale link to a task that was sent back
    // for changes (or is already published) must not record an approval that the worker would
    // later read as the client's yes on unseen rework.
    if (!task || task.requested_by_contact?.is_deleted || !isStagedForApproval(task)) {
      return NextResponse.json(
        { error: 'Approval link not found or has expired' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { note } = requestChangesSchema.parse(body);

    // Mike's ruling (overrides spec decision 11): no role gate on approval links for now.
    // The note is written under the link's own contact (the requester), and only theirs; it never
    // falls back to the client's primary contact. A link made without a requester has no contact to
    // attribute words to, but the client's note must not be lost: it is saved as an internal comment
    // for staff (tagged and alerted), and the page tells the client the same thing it always does.
    const contact = task.requested_by_contact;
    if (!contact) {
      await recordUnattributedSendBack(task, note);
      await logPortalSession({
        tokenType: 'task_approval',
        entityId: task.id,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent'),
        action: 'changes_requested',
        metadata: { contact_id: null, unattributed: true },
      });
      return NextResponse.json({ message: 'Thanks — sent back for changes', status: 'not_started' });
    }
    await recordTaskClientRequestChanges(task, note, contact.name ?? null, contact.id);

    await logPortalSession({
      tokenType: 'task_approval',
      entityId: task.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'changes_requested',
      metadata: { contact_id: contact.id },
    });

    return NextResponse.json({ message: 'Thanks — sent back for changes', status: 'not_started' });
  } catch (error) {
    return handleApiError(error);
  }
}
