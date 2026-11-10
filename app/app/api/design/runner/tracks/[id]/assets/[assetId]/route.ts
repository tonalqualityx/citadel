import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { z } from 'zod';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { UPLOAD_REJECT_CODES, readAssetForMachine, rejectUpload, runnerAssetView } from '@/lib/design/track-assets';

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

const rejectBody = z.object({ status: z.literal('rejected'), reject_reason: z.enum(UPLOAD_REJECT_CODES) }).strict();

// PATCH /api/design/runner/tracks/:id/assets/:assetId {status: "rejected", reject_reason: <code>} (SPEC 6.1a, 3.3): the
// runner marks a bad upload rejected. Only a pending `upload` of this track changes; an already rejected one is returned
// as it is (a retry); a ready one is 409 already_ready. The runner can never set `ready` here. 200 {asset}.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    await requireTrackRunner();
    const p = await params;
    const trackId = idParam(p.id, 'Track not found');
    const assetId = idParam(p.assetId, 'Asset not found');
    const b = await workerBody(request, rejectBody);
    return NextResponse.json({ asset: runnerAssetView(await rejectUpload(trackId, assetId, b.reject_reason)) });
  } catch (error) {
    return handleApiError(error);
  }
}
