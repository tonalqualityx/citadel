/**
 * The sweeper's `applyProceed` for the wait record. One effect exists: `price_review_done`, the
 * last step of charter.price_review, which stamps Charter.price_review_done_at. Every other
 * effect is left alone, exactly as before (phase 1 applied none).
 */
import type { PrismaClient } from '@prisma/client';
import type { WaitRow } from '@/lib/waits/sweeper';

type Db = Pick<PrismaClient, 'charter'>;

/** Stamps the review done for a charter, once. A repeat never moves an earlier stamp. */
export async function stampPriceReviewDone(db: Db, charterId: string, now: Date): Promise<void> {
  await db.charter.updateMany({ where: { id: charterId, price_review_done_at: null }, data: { price_review_done_at: now } });
}

export function makeApplyProceed(db: Db, now: () => Date = () => new Date()) {
  return async function applyProceed(wait: WaitRow, effect: string | null): Promise<void> {
    if (effect !== 'price_review_done') return;
    if (wait.template_key !== 'charter.price_review' || !wait.charter_id) {
      throw new Error('price_review_done needs a charter.price_review wait with a charter.');
    }
    await stampPriceReviewDone(db, wait.charter_id, now());
  };
}
