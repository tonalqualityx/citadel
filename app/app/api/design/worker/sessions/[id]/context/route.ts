import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker } from '@/lib/design/worker-kit';
import { loadWorkerTrackedSession, parseContextQuery, readWorkerContext } from '@/lib/design/worker-context';

// GET /api/design/worker/sessions/:id/context?part=brief|board|direction|client_statements|pages&ids= (SPEC 5.1, 3.5).
// The track comes from the session row; a session with no track is 404. `ids` (at most 20 uuids) narrow board,
// client_statements and pages inside that track.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const { session, track } = await loadWorkerTrackedSession(id);
    const { part, ids } = parseContextQuery(request.nextUrl.searchParams);
    return NextResponse.json(await readWorkerContext(track, session, auth.userId, part, ids), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
