import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { isUuid } from '@/lib/design/helpers';
import { authActor } from '@/lib/design/route-kit';
import { getPrivate } from '@/lib/services/private-storage';

// GET /api/design/sessions/:id/assets/:assetId (design 7.1): bytes from private storage. The asset must belong
// to the session; anyone who may not see the session gets 404. Text is served as text/plain only.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { actor } = await authActor();
    const { id, assetId } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'read' });
    if (!isUuid(assetId)) throw new ApiError('Asset not found', 404, 'not_found');
    const asset = await prisma.designAsset.findFirst({ where: { id: assetId, session_id: session.id } });
    if (!asset) throw new ApiError('Asset not found', 404, 'not_found');
    let bytes: Buffer;
    try {
      bytes = await getPrivate(asset.storage_key);
    } catch {
      throw new ApiError('Asset not found', 404, 'not_found');
    }
    const type = asset.content_type.toLowerCase();
    const contentType = type.startsWith('image/png') ? 'image/png' : type.startsWith('text/') ? 'text/plain; charset=utf-8' : 'application/octet-stream';
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
