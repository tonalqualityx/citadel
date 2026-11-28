import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { inferRest } from '@/lib/design/track-stage';

const emptySchema = z.object({}).strict();

// POST /api/design/sessions/:id/infer-rest: the designer taps "Infer the rest", at any build stage (home_build, refine,
// rest_build, review). One `rest_build` job with `start: infer_rest` builds only the pages nobody has drawn or built yet.
// In refine the track moves to rest_build and her refine task is completed (as with "Home is ready"); elsewhere the stage
// stays. While a build runs the request is held and queued when that build ends: `after_build: true`, `job_id` null.
// Tracked sessions only (404 otherwise); 409 illegal_transition outside a build stage.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    await body(request, emptySchema, 4096);
    if (!session.track_id) throw new ApiError('Session not found', 404, 'not_found');
    const out = await inferRest(session.track_id, actor.userId);
    return NextResponse.json({ stage: out.stage, busy: true, job_id: out.jobId, after_build: out.afterBuild }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
