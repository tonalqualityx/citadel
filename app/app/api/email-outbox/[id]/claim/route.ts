import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { chatRecipientAllowed } from '@/lib/portal/chat/outbox-guard';

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
    // A chat email may go outside the company only to a person on that conversation who can still open
    // the request. Checked again here, at the moment of sending (portal phase C, slice C4).
    if (row.kind === 'portal_chat' && !(await chatRecipientAllowed(row))) {
      await prisma.emailOutbox.update({ where: { id }, data: { attempts: 99, last_error: 'refused: recipient is not a person on this chat or lost access' } });
      throw new ApiError('Recipient not allowed', 409);
    }
    return NextResponse.json(row);
  } catch (error) {
    return handleApiError(error);
  }
}
