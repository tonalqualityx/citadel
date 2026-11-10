import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam } from '@/lib/design/worker-kit';
import { readAssetForMachine } from '@/lib/design/track-assets';

// GET /api/design/runner/tracks/:id/assets/:assetId (SPEC 6.1a, 3.3): the bytes of any asset of this track, as
// application/octet-stream (the kind and the sniffed type travel in X-Design-Asset-Kind and X-Design-Asset-Type).
// An asset of another track is 404.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    await requireTrackRunner();
    const p = await params;
    const trackId = idParam(p.id, 'Track not found');
    const assetId = idParam(p.assetId, 'Asset not found');
    const { bytes, headers } = await readAssetForMachine(trackId, assetId);
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    return handleApiError(error);
  }
}
