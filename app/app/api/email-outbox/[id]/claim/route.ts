import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const CLAIM_WINDOW_MS = 10 * 60 * 1000;

// POST: the drain claims one row before sending. Atomic: only an unsent row that is unclaimed (or
// whose claim is older than 10 minutes) can be claimed. Returns the full row, body included.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const now = new Date();
    const cutoff = new Date(now.getTime() - CLAIM_WINDOW_MS);
    const claimed = await prisma.emailOutbox.updateMany({
      where: {
        id,
        sent_at: null,
        OR: [{ claimed_at: null }, { claimed_at: { lt: cutoff } }],
      },
      data: { claimed_at: now },
    });

    const row = await prisma.emailOutbox.findUnique({ where: { id } });
    if (!row) throw new ApiError('Outbox row not found', 404);
    if (claimed.count === 0) {
      throw new ApiError(row.sent_at ? 'Already sent' : 'Already claimed', 409);
    }
    return NextResponse.json(row);
  } catch (error) {
    return handleApiError(error);
  }
}
