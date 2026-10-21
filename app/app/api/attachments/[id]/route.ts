import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { getPrivate } from '@/lib/services/private-storage';
import { serveHeaders } from '@/lib/services/uploads';

// GET /api/attachments/:id (portal phase C; staff)
// A client's attachment, for the people working the task. nosniff; images inline, the rest download.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Not found', 404);
    const att = await prisma.portalAttachment.findFirst({ where: { id: id.data, is_deleted: false } });
    if (!att) throw new ApiError('Not found', 404);
    const buf = await getPrivate(att.storage_key);
    return new NextResponse(new Uint8Array(buf), { status: 200, headers: serveHeaders(att) });
  } catch (error) {
    return handleApiError(error);
  }
}
