import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker } from '@/lib/design/worker-kit';
import { loadWorkerTrackedSession } from '@/lib/design/worker-context';
import { readAssetForMachine } from '@/lib/design/track-assets';

// GET /api/design/worker/sessions/:id/track-assets/:assetId (SPEC 3.3 "Machine reads"): the bytes of an asset of the
// session's track as application/octet-stream. An asset of another track, or an id that is not one, is 404.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    await requireWorker();
    const p = await params;
    const id = idParam(p.id, 'Session not found');
    const { track } = await loadWorkerTrackedSession(id);
    const { bytes, headers } = await readAssetForMachine(track.id, p.assetId);
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    return handleApiError(error);
  }
}
