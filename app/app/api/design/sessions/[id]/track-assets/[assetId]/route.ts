import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { authActor } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { readServableAsset } from '@/lib/design/track-assets';

// GET /api/design/sessions/:id/track-assets/:assetId (SPEC 3.3, 4.11 #9): raster images only, from private storage. PDF and
// SVG originals and job logs are never served by any Citadel route (404), nor is an asset of another track. Headers come
// from serveHeaders(): nosniff, `default-src 'none'; sandbox`, private no-store, inline.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { actor } = await authActor();
    const { id, assetId } = await params;
    const { track } = await loadTrackedSession(actor, id, 'read');
    const { bytes, headers } = await readServableAsset(track.id, assetId);
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    return handleApiError(error);
  }
}
