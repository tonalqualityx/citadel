import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { authActor, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { readBrief } from '@/lib/design/track-board';

// GET /api/design/sessions/:id/brief (SPEC 4.1, 4.11 #1): the published brief, the caller's reactions and the client's own
// words as `client_statements`. Tracked sessions only (404 otherwise).
export async function GET(_request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'read');
    return NextResponse.json(await readBrief(track, session.id, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
