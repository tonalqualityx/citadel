import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { workerBody } from '@/lib/design/worker-kit';
import { startTrack, trackView } from '@/lib/design/track-runner';

const schema = z.object({ task_id: z.string().uuid() }).strict();

// POST /api/design/runner/tracks {task_id} (SPEC 6.1a): 200 with the site's open track, 201 with a new one.
export async function POST(request: NextRequest) {
  try {
    await requireTrackRunner();
    const b = await workerBody(request, schema, 8 * 1024);
    const { track, created } = await startTrack(b.task_id);
    return NextResponse.json({ track: trackView(track), created }, { status: created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
