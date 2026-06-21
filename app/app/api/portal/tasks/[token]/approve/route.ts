import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import {
  validateTaskToken,
  resolveTaskContact,
  logPortalSession,
  getClientIp,
} from '@/lib/services/portal';

// POST /api/portal/tasks/:token/approve - Client approves the staged work. Public, token-gated.
// Sets client_approved_at + approved_by_contact_id. For staged client sites
// (site.auto_deploy === false) the actual staging→prod promotion is a separate operator step
// (no in-app deploy pipeline yet), so we record a promotion-pending marker rather than deploy.
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

    // Idempotent: a second approve is a no-op.
    if (task.client_approved_at) {
      return NextResponse.json({
        message: 'Already approved',
        already_approved: true,
        approved_at: task.client_approved_at,
      });
    }

    const contact = await resolveTaskContact(task);
    const approvedAt = new Date();

    await prisma.task.update({
      where: { id: task.id },
      data: {
        client_approved_at: approvedAt,
        approved_by_contact_id: contact?.id ?? null,
      },
    });

    // Staged client sites need a staging→prod promotion. There is no in-app deploy pipeline,
    // so flag it for the operator via an internal (never client-visible) note instead of
    // performing an irreversible deploy here.
    const promotionPending = task.site?.auto_deploy === false;
    if (promotionPending) {
      const bastUserId = await prisma.user
        .findFirst({ where: { email: 'bast@becomeindelible.com' }, select: { id: true } })
        .then((u) => u?.id ?? null);
      if (bastUserId) {
        await prisma.comment.create({
          data: {
            task_id: task.id,
            user_id: bastUserId,
            content:
              '~ Bast: Client approved the staged work via the portal. Staging→prod promotion is pending an operator (no auto-deploy on this site).',
            is_internal: true,
          },
        });
      }
    }

    await logPortalSession({
      tokenType: 'task_approval',
      entityId: task.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'accept',
      metadata: { approved_by_contact_id: contact?.id ?? null, promotion_pending: promotionPending },
    });

    return NextResponse.json({
      message: 'Approved',
      approved_at: approvedAt,
      promotion_pending: promotionPending,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
