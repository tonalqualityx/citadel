import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { reviseDirection } from '@/lib/design/track-direction';

const emptySchema = z.object({}).strict();

// POST /api/design/sessions/:id/art-direction/revise (SPEC 2.5, 4.11 #13): a new draft from the signed version. Allowed in
// refine and review, and in home_build only when the build has failed for good. 409 track_busy while a build runs.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { busy: true, done: true });
    await body(request, emptySchema, 4096);
    return NextResponse.json({ direction: await reviseDirection(track.id, actor.userId) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
