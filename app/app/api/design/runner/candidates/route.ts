import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { listCandidates } from '@/lib/design/track-runner';

// GET /api/design/runner/candidates (SPEC 6.1a): provision and research tasks ready to start a track, and design-import
// tasks on tracked projects with no import row. `blocked_reason` is set when the site is not ready.
export async function GET() {
  try {
    await requireTrackRunner();
    return NextResponse.json({ candidates: await listCandidates() });
  } catch (error) {
    return handleApiError(error);
  }
}
