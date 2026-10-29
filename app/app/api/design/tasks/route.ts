import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { loadDrawer } from '@/lib/design/access';
import { projectDrawer } from '@/lib/design/projections';
import { authActor } from '@/lib/design/route-kit';
import { loadStartSites } from '@/lib/design/work';
import { isUuid } from '@/lib/design/helpers';
import { ApiError } from '@/lib/api/errors';

// GET /api/design/tasks (design 7.1): the drawer. Designer, admin, pm.
export async function GET(request: NextRequest) {
  try {
    const { actor } = await authActor();
    const projectId = request.nextUrl.searchParams.get('project_id');
    if (projectId && !isUuid(projectId)) throw new ApiError('project_id must be a uuid', 400, 'bad_project_id');
    const data = await loadDrawer(actor, { projectId });
    // start_sites feeds the "Start new work" picker (a designer may not call /api/sites).
    return NextResponse.json({ ...projectDrawer(data, actor), start_sites: await loadStartSites(actor) });
  } catch (error) {
    return handleApiError(error);
  }
}
