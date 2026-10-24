/**
 * Claim-time check for price review mail (EmailOutbox kind `price_review`), like the chat guard:
 * one plain address, and it must still belong to a portal owner of a client with an active
 * charter. A contact removed since the row was queued never gets the note.
 */
import { prisma } from '@/lib/db/prisma';

/** EmailOutbox.kind of the price note. */
export const PRICE_REVIEW_MAIL_KIND = 'price_review';

export async function priceReviewRecipientAllowed(row: { to: string; cc?: string | null }): Promise<boolean> {
  if (row.cc) return false;
  const to = row.to.trim();
  if (!to || to.includes(',') || to.includes(';') || /\s/.test(to)) return false;
  const n = await prisma.clientContact.count({
    where: {
      email: { equals: to, mode: 'insensitive' },
      is_deleted: false,
      portal_role: 'owner',
      client: { is_deleted: false, charters: { some: { is_deleted: false, status: 'active' } } },
    },
  });
  return n > 0;
}
