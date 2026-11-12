import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { homeReady } from '@/lib/design/track-stage';

const emptySchema = z.object({}).strict();

// POST /api/design/sessions/:id/home-ready (SPEC 2.5, 4.11 #14): the designer taps "Home is ready". refine -> rest_build:
// her refine task is completed and approved, busy is set and `rest_build` is queued. Tracked sessions only (404
// otherwise); any other stage is 409 illegal_transition.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    await body(request, emptySchema, 4096);
    if (!session.track_id) throw new ApiError('Session not found', 404, 'not_found');
    const track = await homeReady(session.track_id, actor.userId);
    return NextResponse.json({ stage: 'rest_build', busy: true, job_id: track.jobId }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
