import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { generatePortalToken, getTokenExpiry } from '@/lib/services/portal';

// POST /api/tasks/:id/approval-link
// Mint (or reuse) the per-task client approval portal token and return its public URL.
// Authed (pm/admin). The returned URL opens the token-gated approval page.
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
        portal_token: true,
        portal_token_expires_at: true,
      },
    });

    if (!task || task.is_deleted) {
      throw new ApiError('Task not found', 404);
    }

    // Reuse an existing, unexpired token; otherwise mint a fresh one.
    const stillValid =
      task.portal_token &&
      (!task.portal_token_expires_at || task.portal_token_expires_at > new Date());

    let token = task.portal_token ?? undefined;
    let expiresAt = task.portal_token_expires_at ?? undefined;

    if (!stillValid) {
      token = generatePortalToken();
      expiresAt = getTokenExpiry();
      await prisma.task.update({
        where: { id: taskId },
        data: { portal_token: token, portal_token_expires_at: expiresAt },
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const url = `${baseUrl}/portal/task-approval/${token}`;

    return NextResponse.json({
      url,
      token,
      expires_at: expiresAt ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
