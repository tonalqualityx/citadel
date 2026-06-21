import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { ensureTaskPortalToken, resolveTaskContact } from '@/lib/services/portal';
import { sendTaskApprovalRequestEmail } from '@/lib/services/email';

// POST /api/tasks/:id/notify-requestor
// Email the original requestor (or the client's primary contact) that the work is ready for
// review, with the staging preview link (if any) and the token-gated approval-page link.
// Authed (pm/admin) — the worker loop calls this at close-out for client work. Neutral voice.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: taskId } = await params;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        is_deleted: true,
        title: true,
        staging_preview_url: true,
        client_id: true,
        requested_by_contact: {
          select: { id: true, name: true, email: true, client_id: true },
        },
        site: { select: { client_id: true } },
      },
    });

    if (!task || task.is_deleted) {
      throw new ApiError('Task not found', 404);
    }

    const contact = await resolveTaskContact(task);
    if (!contact?.email) {
      throw new ApiError('No requestor contact email to notify', 422);
    }

    const link = await ensureTaskPortalToken(taskId);
    if (!link) {
      throw new ApiError('Task not found', 404);
    }

    await sendTaskApprovalRequestEmail({
      to: contact.email,
      approvalUrl: link.url,
      taskTitle: task.title,
      contactName: contact.name,
      stagingUrl: task.staging_preview_url,
    });

    return NextResponse.json({
      sent: true,
      to: contact.email,
      approval_url: link.url,
      staging_url: task.staging_preview_url ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
