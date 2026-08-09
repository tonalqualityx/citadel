import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import {
  validateTaskToken,
  resolveTaskContact,
  recordTaskClientRequestChanges,
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

    if (!task) {
      return NextResponse.json(
        { error: 'Approval link not found or has expired' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { note } = requestChangesSchema.parse(body);

    const contact = await resolveTaskContact(task);
    await recordTaskClientRequestChanges(task, note, contact?.name ?? null);

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
