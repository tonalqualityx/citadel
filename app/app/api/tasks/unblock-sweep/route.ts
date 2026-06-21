import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { healBlockedTasks } from '@/lib/services/dependencies';

/**
 * Self-healing backstop: unblock every `blocked` task whose blockers are all satisfied.
 * Idempotent — safe to call on a schedule. Lets a cron/worker guarantee no task stays
 * silently stuck in `blocked` (where the not_started-only loop can never see it) even if
 * a reactive propagation was ever missed.
 */
export async function POST() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const ids = await healBlockedTasks();

    return NextResponse.json({ unblocked: ids.length, ids });
  } catch (error) {
    return handleApiError(error);
  }
}
