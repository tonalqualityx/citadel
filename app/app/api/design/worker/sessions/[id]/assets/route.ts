import { NextRequest, NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker } from '@/lib/design/worker-kit';
import { MAX_IMAGE_BYTES, storeAsset } from '@/lib/design/assets';

// multipart/form-data: file, kind, width?  -> 201 {asset_id}. PNG magic bytes or text/plain; 4 MB image / 1 MB text.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES + 64 * 1024) throw new ApiError('Upload too large', 413, 'asset_too_large');
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError('Expected multipart/form-data', 400, 'bad_form');
    }
    const file = form.get('file');
    const kind = form.get('kind');
    if (!(file instanceof Blob) || typeof kind !== 'string') throw new ApiError('file and kind are required', 400, 'bad_form');
    if (file.size > MAX_IMAGE_BYTES) throw new ApiError('Upload too large', 413, 'asset_too_large');
    const w = form.get('width');
    let width: number | null = null;
    if (w !== null && w !== '') {
      width = Number(w);
      if (!Number.isInteger(width)) throw new ApiError('Bad width', 400, 'bad_width');
    }
    const asset = await storeAsset({ sessionId: id, kind, bytes: Buffer.from(await file.arrayBuffer()), width });
    return NextResponse.json({ asset_id: asset.id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
