import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { ensureTaskPortalToken } from '@/lib/services/portal';

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

    const link = await ensureTaskPortalToken(taskId);
    if (!link) {
      throw new ApiError('Task not found', 404);
    }

    return NextResponse.json({
      url: link.url,
      token: link.token,
      expires_at: link.expiresAt,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
