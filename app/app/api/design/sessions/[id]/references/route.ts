import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { addDesignerReference, listReferences } from '@/lib/design/track-board';

const schema = z.union([
  z.object({ url: z.string().max(600), title: z.string().trim().min(1).max(200).optional() }).strict(),
  z.object({ upload_asset_ids: z.array(z.string().uuid()).min(1).max(20), title: z.string().trim().min(1).max(200).optional() }).strict(),
]);

// GET /api/design/sessions/:id/references (SPEC 4.3, 4.11 #3): the board cards with live markups and capture states.
export async function GET(_request: NextRequest, { params }: IdParams) {
  try {
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'read');
    return NextResponse.json({ references: await listReferences(track.id, session.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/design/sessions/:id/references (4.11 #4): `{url}` (https parsed server side, one `capture` job queued, nothing
// fetched here) or `{upload_asset_ids}` (board uploads of this track). 201 with the new card.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { done: true });
    const input = await body(request, schema);
    return NextResponse.json({ reference: await addDesignerReference(track.id, session.id, input) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
