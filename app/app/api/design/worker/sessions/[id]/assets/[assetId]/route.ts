import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireWorker } from '@/lib/design/worker-kit';
import { readAsset } from '@/lib/design/assets';

// Pin crops and earlier screenshots for a resumed session. Session-scoped: no storage key leaves the server.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    await requireWorker();
    const { id, assetId } = await params;
    const { asset, bytes } = await readAsset(id, assetId);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': asset.content_type,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
