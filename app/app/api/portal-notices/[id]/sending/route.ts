import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { cancelStaleNotices } from '@/lib/portal/notices';

// PUT /api/portal-notices/:id/sending (portal phase B slice 2)
// The sender's claim, called BEFORE the email is handed to gog: queued -> sending, and
// send_attempt_at stamped. Mirrors PUT /api/approval-requests/:id/sending: a notice not claimed
// here is never sent, and a notice not 'queued' answers 409. The claim re-checks that the reply is
// still client-visible (the hold is two minutes; staff may have unflagged it): if nothing is left
// to show, the notice is cancelled and the claim answers 409 so the sender skips it.
export async function PUT(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.portalNotice.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) throw new ApiError('Notice not found', 404);
    if (existing.status !== 'queued') {
      throw new ApiError(`Notice is '${existing.status}', not 'queued'. Cannot claim it for sending.`, 409);
    }

    await cancelStaleNotices();
    // Conditional update: only one claimant wins, and a notice cancelled just now no longer matches.
    const claimed = await prisma.portalNotice.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'sending', send_attempt_at: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ApiError('Notice is no longer queued (its reply was withdrawn or another sender took it).', 409);
    }
    const updated = await prisma.portalNotice.findUniqueOrThrow({ where: { id } });
    return NextResponse.json({ id: updated.id, status: updated.status, send_attempt_at: updated.send_attempt_at });
  } catch (error) {
    return handleApiError(error);
  }
}
