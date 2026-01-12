import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { listSlackUsers } from '@/lib/services/slack';

/**
 * GET /api/admin/slack/users
 * List all users in the connected Slack workspace
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const users = await listSlackUsers();

    return NextResponse.json({ users });
  } catch (error) {
    return handleApiError(error);
  }
}
