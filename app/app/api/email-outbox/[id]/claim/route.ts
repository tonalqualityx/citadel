import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { chatRecipientAllowed } from '@/lib/portal/chat/outbox-guard';
import { PRICE_REVIEW_MAIL_KIND, priceReviewRecipientAllowed } from '@/lib/price-review/outbox-guard';
import { parseGovern } from '@/lib/sends/govern';
import { decideSend } from '@/lib/sends/policy';
import { releaseClaimForRow } from '@/lib/sends/release';

function supersededResponse(reason: string) {
  return NextResponse.json({ error: 'superseded', code: 'superseded', reason }, { status: 409 });
}

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
        superseded_at: null,
        OR: [{ claimed_at: null }, { claimed_at: { lt: cutoff } }],
      },
      data: { claimed_at: now },
    });

    const row = await prisma.emailOutbox.findUnique({ where: { id } });
    if (!row) throw new ApiError('Outbox row not found', 404);
    if (claimed.count === 0) {
      if (row.superseded_at && !row.sent_at) return supersededResponse(row.superseded_reason ?? 'superseded');
      throw new ApiError(row.sent_at ? 'Already sent' : 'Already claimed', 409);
    }
    // A chat email may go outside the company only to a person on that conversation who can still open
    // the request. Checked again here, at the moment of sending (portal phase C, slice C4).
    if (row.kind === 'portal_chat' && !(await chatRecipientAllowed(row))) {
      await prisma.emailOutbox.update({ where: { id }, data: { attempts: 99, last_error: 'refused: recipient is not a person on this chat or lost access' } });
      throw new ApiError('Recipient not allowed', 409);
    }
    // A price note goes only to one portal owner of a client that still has an active charter.
    if (row.kind === PRICE_REVIEW_MAIL_KIND && !(await priceReviewRecipientAllowed(row))) {
      await prisma.emailOutbox.update({ where: { id }, data: { attempts: 99, last_error: 'refused: recipient is not a portal owner of a client with an active charter' } });
      throw new ApiError('Recipient not allowed', 409);
    }
    // Send-time recheck (Fleet item 4): read the governing record again and drop a send the state made wrong.
    const govern = parseGovern(row.govern);
    if (!govern) {
      console.log(JSON.stringify({ event: 'send_recheck', ref: row.id, ok: true, reason: 'ungoverned' }));
    } else {
      const decision = await decideSend(govern, row.id);
      if (!decision.ok) {
        const reason = (decision.reason ?? 'superseded').slice(0, 64);
        await prisma.emailOutbox.update({ where: { id }, data: { superseded_at: new Date(), superseded_reason: reason, last_error: `superseded: ${reason}` } });
        await releaseClaimForRow(row);
        return supersededResponse(reason);
      }
    }
    return NextResponse.json(row);
  } catch (error) {
    return handleApiError(error);
  }
}
