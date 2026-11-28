import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { signArtDirection } from '@/lib/design/track-direction';

const schema = z.object({
  base_version: z.number().int().min(1).max(10_000),
  base_revision: z.string().min(1).max(40),
  mode: z.enum(['refinements', 'rebuild']).optional(),
  start: z.enum(['inspiration', 'own_design']).optional(), // HOME_STARTS in lib/design/track-stage.ts
}).strict();

// POST /api/design/sessions/:id/art-direction/sign (SPEC 4.4, 2.5, 4.11 #12): the session's designer or a tech user (an admin is
// 403 designer_only). Freezes the draft and queues the build jobs. `base_revision` is the `revision` her screen showed: only
// that revision is signed (409 version_moved otherwise). `mode` matters only for a later version. `start` (inspiration |
// own_design) is how the home build starts when the sign queues one; own_design needs a usable design file (409 no_design_file).
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    if (actor.role !== 'designer' && actor.role !== 'tech') throw new ApiError('Only the designer signs the direction', 403, 'designer_only');
    await assertTrackWritable(session, { done: true });
    const input = await body(request, schema);
    return NextResponse.json(await signArtDirection(track.id, actor.userId, input), { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
