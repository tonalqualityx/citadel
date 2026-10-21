import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// PUT /api/portal-notices/:id/send-error (portal phase B slice 2)
// The sender's report that handing the email to gog FAILED, before any delivery. Mirrors PUT
// /api/approval-requests/:id/send-error with one difference: the third recorded error ends in
// 'failed' (a notice has no draft state to fall back to), where the first two release the
// notice back to 'queued' for the next pass. A 'queued' notice is also accepted: it is how the
// sender reports that its local send ledger refused the id, which goes straight to 'failed'.
const MAX_SEND_ERRORS = 3;
const MAX_ERROR_LENGTH = 2000;
const schema = z.object({ error: z.string().min(1) });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.portalNotice.findUnique({ where: { id }, select: { id: true, status: true, send_error_count: true } });
    if (!existing) throw new ApiError('Notice not found', 404);
    if (existing.status !== 'sending' && existing.status !== 'queued') {
      throw new ApiError(`Notice is '${existing.status}', not 'sending' or 'queued'`, 409);
    }
    const { error: reason } = schema.parse(await request.json());

    const fromQueued = existing.status === 'queued';
    const nextCount = existing.send_error_count + 1;
    const toFailed = fromQueued || nextCount >= MAX_SEND_ERRORS;

    const updated = await prisma.portalNotice.update({
      where: { id },
      data: {
        status: toFailed ? 'failed' : 'queued',
        send_attempt_at: null,
        send_error: reason.slice(0, MAX_ERROR_LENGTH),
        send_error_count: nextCount,
      },
    });
    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      send_error: updated.send_error,
      send_error_count: updated.send_error_count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
