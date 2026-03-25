import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAddendumResponse } from '@/lib/api/formatters';
import { generatePortalToken, getTokenExpiry, logPortalSession, getClientIp } from '@/lib/services/portal';

// POST /api/accords/:id/addendums/:addendumId/send - Send addendum to client
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addendumId: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, addendumId } = await params;

    const existing = await prisma.addendum.findFirst({
      where: {
        id: addendumId,
        accord_id: id,
        is_deleted: false,
      },
      include: {
        accord: {
          include: {
            client: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!existing) {
      throw new ApiError('Addendum not found', 404);
    }

    if (existing.status !== 'draft') {
      throw new ApiError('Only draft addendums can be sent', 400);
    }

    // Generate portal token and snapshot content
    const portalToken = generatePortalToken();
    const tokenExpiry = getTokenExpiry();

    const addendum = await prisma.addendum.update({
      where: { id: addendumId },
      data: {
        status: 'sent',
        sent_at: new Date(),
        portal_token: portalToken,
        portal_token_expires_at: tokenExpiry,
        content_snapshot: existing.contract_content,
      },
      include: {
        created_by: {
          select: { id: true, name: true, email: true },
        },
        overridden_by: {
          select: { id: true, name: true },
        },
        charter_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        commission_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        keep_items: {
          where: { is_deleted: false },
          include: {
            site: { select: { id: true, name: true, url: true } },
            hosting_plan: { select: { id: true, name: true, rate: true } },
            maintenance_plan: { select: { id: true, name: true, rate: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    // Log portal session
    await logPortalSession({
      tokenType: 'addendum' as any,
      entityId: addendum.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
      metadata: { action: 'sent_by_user', sent_by: auth.userId },
    });

    // Attempt to send email notification (may not be implemented yet)
    try {
      const emailModule = await import('@/lib/services/email') as any;
      if (typeof emailModule.sendAddendumEmail === 'function') {
        await emailModule.sendAddendumEmail(addendum);
      }
    } catch {
      // Email service may not be implemented yet - continue silently
    }

    return NextResponse.json(formatAddendumResponse(addendum));
  } catch (error) {
    return handleApiError(error);
  }
}
