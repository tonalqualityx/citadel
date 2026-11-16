import { NextRequest, NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { isUuid } from '@/lib/design/helpers';
import { authActor, guardMutation, requireAdmin, requireSessionVia, type IdParams } from '@/lib/design/route-kit';
import { jobView, retryFailedJob } from '@/lib/design/track-jobs';

// POST /api/design/admin/jobs/:id/retry: an admin puts a design job that failed for good back in the queue once the
// cause is fixed. Admin, signed-in session or the setup operator key, like the other admin routes.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor({ operator: 'setup' });
    requireSessionVia(actor, 'setup');
    requireAdmin(actor);
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError('Job not found', 404, 'not_found');
    const job = await retryFailedJob(id, actor);
    return NextResponse.json({ job: jobView(job) });
  } catch (error) {
    return handleApiError(error);
  }
}
