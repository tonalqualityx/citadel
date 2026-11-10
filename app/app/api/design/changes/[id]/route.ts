import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { decideChange, decideChangeSchema } from '@/lib/design/changes';
import { isUuid } from '@/lib/design/helpers';
import { projectChange } from '@/lib/design/projections';
import { assertTrackWritable } from '@/lib/design/track-session';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

// PATCH /api/design/changes/:id (design 7.1): accepted | denied + note; a denial reaches the worker as a designer event.
// On a tracked session it is held like a message: 409 track_busy while Bast builds, 409 track_done once finished.
export async function PATCH(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    if (!isUuid(id)) throw new ApiError('Change not found', 404, 'not_found');
    const change = await prisma.designChange.findUnique({ where: { id } });
    if (!change) throw new ApiError('Change not found', 404, 'not_found');
    const session = await loadSessionFor(actor, change.session_id, { mode: 'write' });
    await assertTrackWritable(session, { busy: true, done: true }); // SPEC 2.2, 2.3: a denial is a designer message
    const input = await body(request, decideChangeSchema, 16 * 1024);
    const updated = await decideChange(actor, change, session, input);
    return NextResponse.json({ change: projectChange(updated) });
  } catch (error) {
    return handleApiError(error);
  }
}
