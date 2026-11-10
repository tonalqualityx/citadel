import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authActor, body, guardMutation } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { MARKUP_CATEGORIES, MARKUP_SENTIMENTS, patchMarkup } from '@/lib/design/track-board';

const schema = z.object({
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict().optional(),
  sentiment: z.enum(MARKUP_SENTIMENTS).optional(),
  category: z.enum(MARKUP_CATEGORIES).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  deleted: z.boolean().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change');

// PATCH /api/design/sessions/:id/markups/:markupId (SPEC 4.3, 4.11 #7): edit a box, or remove it with `{deleted: true}`.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; markupId: string }> }) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id, markupId } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { done: true });
    const input = await body(request, schema);
    return NextResponse.json({ markup: await patchMarkup(track.id, markupId, input) });
  } catch (error) {
    return handleApiError(error);
  }
}
