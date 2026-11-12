import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { REFERENCE_DECISIONS, patchReference } from '@/lib/design/track-board';

const schema = z.object({
  decision: z.enum(REFERENCE_DECISIONS).optional(),
  decision_note: z.string().trim().max(500).nullable().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');

// PATCH /api/design/sessions/:id/references/:refId (SPEC 4.3, 4.11 #5): yes / no / pending, a note, the order.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; refId: string }> }) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id, refId } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { done: true });
    const input = await body(request, schema);
    return NextResponse.json({ reference: await patchReference(track.id, session.id, refId, actor.userId, input) });
  } catch (error) {
    return handleApiError(error);
  }
}
