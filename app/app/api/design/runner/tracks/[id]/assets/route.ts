import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';

// POST /api/design/runner/tracks/:id/assets (SPEC 6.1a, 3.3): multipart upload of captures, renders, spot shots and job
// logs. The storage, validation and serving rules are PLAN W1.3; until it lands the route answers 501 behind the
// runner gate, so the lane entry is real and nothing can be stored without the 3.3 validators.
export async function POST() {
  try {
    await requireTrackRunner();
    return NextResponse.json({ error: 'Track asset upload is not built yet', code: 'not_implemented' }, { status: 501 });
  } catch (error) {
    return handleApiError(error);
  }
}
