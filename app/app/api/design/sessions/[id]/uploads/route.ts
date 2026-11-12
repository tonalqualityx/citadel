import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { authActor, guardUpload, type IdParams } from '@/lib/design/route-kit';
import { loadTrackedSession } from '@/lib/design/track-route';
import { assertTrackWritable } from '@/lib/design/track-session';
import { MAX_UPLOAD_BYTES, UPLOAD_BODY_SLACK, UPLOAD_PURPOSES, storeDesignerUpload, trackAssetView } from '@/lib/design/track-assets';

const purposeSchema = z.enum(UPLOAD_PURPOSES);

// POST /api/design/sessions/:id/uploads (SPEC 3.3, 4.11 #8): multipart `file` and `purpose` (board | image | decor). The type
// comes from the bytes, never from the name or the declared type. 201 with the pending asset; a `process_upload` job is
// queued. A declared length over 25 MB plus 64 KB is 413 before the body is read.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    // Auth first: a key or an anonymous caller is refused (403 / 401) whatever the content type; then the multipart guard.
    const { actor } = await authActor();
    const blocked = guardUpload(request);
    if (blocked) return blocked;
    const { id } = await params;
    const { session, track } = await loadTrackedSession(actor, id, 'write');
    await assertTrackWritable(session, { done: true });
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + UPLOAD_BODY_SLACK) throw new ApiError('That upload is too large', 413, 'payload_too_large');
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError('The upload could not be read', 400, 'bad_upload');
    }
    const file = form.get('file') as { name?: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } | string | null;
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw new ApiError('No file provided', 400, 'bad_upload');
    if (file.size > MAX_UPLOAD_BYTES + UPLOAD_BODY_SLACK) throw new ApiError('That upload is too large', 413, 'payload_too_large');
    const purpose = purposeSchema.parse(form.get('purpose'));
    const asset = await storeDesignerUpload({
      trackId: track.id, userId: actor.userId, purpose, name: typeof file.name === 'string' ? file.name : '', bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ asset: trackAssetView(asset, session.id) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
