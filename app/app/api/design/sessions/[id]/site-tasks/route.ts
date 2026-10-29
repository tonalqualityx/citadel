import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { authActor, type IdParams } from '@/lib/design/route-kit';
import { loadSiteTasks } from '@/lib/design/site-tasks';

// GET /api/design/sessions/:id/site-tasks?mine=1: open tasks on this session's site (the Tasks tab). Session cookie
// only; designer (own session, projects she is on), admin, pm (read). Another designer's session is 404.
export async function GET(request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'read' });
    const mine = request.nextUrl.searchParams.get('mine') === '1';
    const tasks = await loadSiteTasks(actor, session, { mine });
    return NextResponse.json({ tasks, mine });
  } catch (error) {
    return handleApiError(error);
  }
}
