import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam } from '@/lib/design/worker-kit';
import { MAX_RUNNER_IMAGE_BYTES, RUNNER_ASSET_KINDS, UPLOAD_BODY_SLACK, runnerAssetView, storeRunnerAsset } from '@/lib/design/track-assets';
import { loadTrack } from '@/lib/design/track-core';
import { prisma } from '@/lib/db/prisma';

const opt = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === null || v === '' ? undefined : v), t.optional());
const fields = z.object({
  kind: z.enum(RUNNER_ASSET_KINDS),
  parent_asset_id: opt(z.string().uuid()),
  page: opt(z.coerce.number().int().min(1).max(10)),
  page_path: opt(z.string().min(1).max(300).startsWith('/')),
  viewport_w: opt(z.coerce.number().int().min(200).max(4000)),
});

// POST /api/design/runner/tracks/:id/assets (SPEC 6.1a, 3.3): multipart `file` and `kind` (ref_fold, ref_full, brief_image,
// render, spot_shot, job_log). PNG or WebP at most 20 MB, or a text job log at most 1 MB; the type comes from the bytes.
// A `render` names the upload it came from (`parent_asset_id`) and marks it ready. `page` (1 to 10) is for renders,
// `page_path` for spot shots. 201 with the asset (no storage key).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTrackRunner();
    const trackId = idParam((await params).id, 'Track not found');
    await loadTrack(prisma, trackId);
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) throw new ApiError('Unsupported content type', 415, 'unsupported_media_type');
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_RUNNER_IMAGE_BYTES + UPLOAD_BODY_SLACK) throw new ApiError('That upload is too large', 413, 'payload_too_large');
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError('The upload could not be read', 400, 'bad_upload');
    }
    const file = form.get('file') as { name?: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } | string | null;
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw new ApiError('No file provided', 400, 'bad_upload');
    if (file.size > MAX_RUNNER_IMAGE_BYTES + UPLOAD_BODY_SLACK) throw new ApiError('That upload is too large', 413, 'payload_too_large');
    const f = fields.parse({ kind: form.get('kind'), parent_asset_id: form.get('parent_asset_id'), page: form.get('page'), page_path: form.get('page_path'), viewport_w: form.get('viewport_w') });
    if (f.parent_asset_id && f.kind !== 'render') throw new ApiError('parent_asset_id is only for a render', 400, 'bad_field');
    if (f.page !== undefined && f.kind !== 'render') throw new ApiError('page is only for a render', 400, 'bad_field');
    if (f.page_path !== undefined && f.kind !== 'spot_shot') throw new ApiError('page_path is only for a spot shot', 400, 'bad_field');
    const asset = await storeRunnerAsset({
      trackId, userId: auth.userId, kind: f.kind, name: typeof file.name === 'string' ? file.name : '', bytes: Buffer.from(await file.arrayBuffer()),
      parentAssetId: f.parent_asset_id ?? null, page: f.page ?? null, pagePath: f.page_path ?? null, viewportW: f.viewport_w ?? null,
    });
    return NextResponse.json({ asset: runnerAssetView(asset) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
