import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { MARKUP_CATEGORIES, MARKUP_SENTIMENTS, createMarkup } from '@/lib/design/track-board';

const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict();
const schema = z.object({
  reference_id: z.string().uuid(), asset_id: z.string().uuid(), rect: rectSchema,
  sentiment: z.enum(MARKUP_SENTIMENTS), category: z.enum(MARKUP_CATEGORIES), note: z.string().trim().max(500).optional(),
}).strict();

// POST /api/design/sessions/:id/markups (SPEC 4.3, 4.11 #6): a box on a shot or upload, as fractions of the image.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { done: true });
    const input = await body(request, schema);
    return NextResponse.json({ markup: await createMarkup(track.id, actor.userId, input) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
