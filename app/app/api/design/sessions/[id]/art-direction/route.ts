import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { patchDirection, readDirection } from '@/lib/design/track-direction';

const schema = z.object({ patch: z.record(z.string(), z.unknown()), base_version: z.number().int().min(0).max(10_000) }).strict();

// GET /api/design/sessions/:id/art-direction (SPEC 4.4, 4.11 #10): the open draft or the latest signed version, and the
// client requests the record still does not answer.
export async function GET(_request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor();
    const { id } = await params;
    const { track } = await loadTrackedSession(actor, id, 'read');
    return NextResponse.json(await readDirection(track));
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/design/sessions/:id/art-direction (4.11 #11): `{patch, base_version}`, a JSON merge patch on the open draft.
// 409 version_moved on a stale base, 409 direction_signed on a signed version, 409 track_busy / track_done.
export async function PATCH(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { busy: true, done: true });
    const input = await body(request, schema);
    return NextResponse.json({ direction: await patchDirection(track.id, actor.userId, input) });
  } catch (error) {
    return handleApiError(error);
  }
}
