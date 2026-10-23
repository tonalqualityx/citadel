import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { findInScope, hasAnyScope } from '@/lib/decisions';

// The decisions that govern a task, project, charter, client or lane: fleet-wide ones, the
// lane's, the client's, the project's or charter's, and anything linked to the task.
// Active only (recorded_from_source + confirmed). Capped at 60; `truncated` says so.

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const sp = new URL(request.url).searchParams;
    const params = {
      task: sp.get('task'),
      project: sp.get('project'),
      charter: sp.get('charter'),
      client: sp.get('client'),
      lane: sp.get('lane'),
      accord: sp.get('accord'),
      site: sp.get('site'),
    };
    if (!hasAnyScope(params)) {
      throw new ApiError('Give at least one of task, project, charter, client, lane', 400);
    }
    return NextResponse.json(await findInScope(params));
  } catch (error) {
    return handleApiError(error);
  }
}
