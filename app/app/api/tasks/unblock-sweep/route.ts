import { NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { healBlockedTasks } from '@/lib/services/dependencies';
import { defaultDueQuestions } from '@/lib/tasks/questions';

/**
 * Self-healing backstop: unblock every `blocked` task whose blockers are all satisfied.
 * Idempotent — safe to call on a schedule. Lets a cron/worker guarantee no task stays
 * silently stuck in `blocked` (where the not_started-only loop can never see it) even if
 * a reactive propagation was ever missed.
 * First, every open go-ahead question whose default_at has passed is defaulted: its cards get the reason as a comment and are released when
 * nothing else holds them (Mike, 2026-11-19). The heal then never releases a card an open question still holds.
 */
export async function POST() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const went = await defaultDueQuestions();
    const healed = await healBlockedTasks();
    const ids = Array.from(new Set([...went.released, ...healed]));

    return NextResponse.json({ unblocked: ids.length, ids, questions_defaulted: went.defaulted.length });
  } catch (error) {
    return handleApiError(error);
  }
}
