import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { portalReadRateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { getPrivate } from '@/lib/services/private-storage';
import { serveHeaders } from '@/lib/services/uploads';

// GET /api/portal/attachments/:id (portal phase C)
// The file, to the client who owns it only (client scope check; out of scope is 404). Images inline,
// everything else a download; nosniff always.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = portalReadRateLimit(request);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success || access.revoked) throw new ApiError('Not found', 404);
    const att = await prisma.portalAttachment.findFirst({ where: { id: id.data, client_id: access.clientId, is_deleted: false } });
    if (!att) throw new ApiError('Not found', 404);
    const buf = await getPrivate(att.storage_key);
    return new NextResponse(new Uint8Array(buf), { status: 200, headers: serveHeaders(att) });
  } catch (error) {
    return handleApiError(error);
  }
}
