import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';

// GET /api/design/runner/tracks/:id/assets/:assetId (SPEC 6.1a, 3.3): bytes of any asset of the track. Storage and
// serving are PLAN W1.3; until it lands the route answers 501 behind the runner gate.
export async function GET() {
  try {
    await requireTrackRunner();
    return NextResponse.json({ error: 'Track asset read is not built yet', code: 'not_implemented' }, { status: 501 });
  } catch (error) {
    return handleApiError(error);
  }
}
