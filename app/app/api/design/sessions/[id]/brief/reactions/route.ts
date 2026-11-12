import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { REACTIONS, upsertReaction } from '@/lib/design/track-board';

const schema = z.object({ card_id: z.string().min(1).max(40), reaction: z.enum(REACTIONS), note: z.string().trim().max(200).optional() }).strict();

// POST /api/design/sessions/:id/brief/reactions (SPEC 4.1, 4.11 #2): `{card_id, reaction, note?}`, one per card per person.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { done: true });
    const input = await body(request, schema);
    return NextResponse.json({ reaction: await upsertReaction(track, actor.userId, input) });
  } catch (error) {
    return handleApiError(error);
  }
}
