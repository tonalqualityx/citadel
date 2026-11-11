import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { chatRecipientAllowed } from '@/lib/portal/chat/outbox-guard';
import { PRICE_REVIEW_MAIL_KIND, priceReviewRecipientAllowed } from '@/lib/price-review/outbox-guard';
import { parseGovern } from '@/lib/sends/govern';
import { decideSend } from '@/lib/sends/policy';
import { releaseClaimForRow } from '@/lib/sends/release';
import { isOwedRow, OWED_FINAL_REASONS, recheckOwedReply } from '@/lib/sends/owed-reply';

function supersededResponse(reason: string) {
  return NextResponse.json({ error: 'superseded', code: 'superseded', reason }, { status: 409 });
}

// Home Slice 4b: a refusal that is not final (the 10-minute hold, the switch off). The row is left as it was, unclaimed.
function refusedResponse(reason: string) {
  return NextResponse.json({ error: reason, code: reason, reason }, { status: 409 });
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
        // Home Slice 4b: the hold. A row with no send_after (every kind but owed_reply) is not held.
        AND: [{ OR: [{ send_after: null }, { send_after: { lte: now } }] }],
      },
      data: { claimed_at: now },
    });

    const row = await prisma.emailOutbox.findUnique({ where: { id } });
    if (!row) throw new ApiError('Outbox row not found', 404);
    if (claimed.count === 0) {
      if (row.superseded_at && !row.sent_at) return supersededResponse(row.superseded_reason ?? 'superseded');
      if (!row.sent_at && row.send_after && row.send_after.getTime() > now.getTime()) return refusedResponse('held');
      throw new ApiError(row.sent_at ? 'Already sent' : 'Already claimed', 409);
    }
    // Home Slice 4b: "Send the draft". Always enforced (not subject to send_recheck_mode). Checked right after the claim, so a
    // refusal that is not final gives the claim back, and a final one stamps the row superseded. Nothing here sends.
    const governForOwed = parseGovern(row.govern);
    if (isOwedRow(row, governForOwed)) {
      const owed = await recheckOwedReply(governForOwed, row, now);
      if (!owed.ok) {
        if (OWED_FINAL_REASONS.includes(owed.reason)) {
          await prisma.emailOutbox.update({ where: { id }, data: { superseded_at: new Date(), superseded_reason: owed.reason, last_error: `superseded: ${owed.reason}` } });
          return supersededResponse(owed.reason);
        }
        await prisma.emailOutbox.update({ where: { id }, data: { claimed_at: null } });
        return refusedResponse(owed.reason);
      }
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
    const govern = governForOwed;
    if (!govern) {
      console.log(JSON.stringify({ event: 'send_recheck', ref: row.id, ok: true, reason: 'ungoverned' }));
    } else {
      // An owed reply was fully checked above; decideSend would only repeat it under the shadow switch.
      const decision = isOwedRow(row, govern) ? { ok: true as const, reason: undefined } : await decideSend(govern, row.id);
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
