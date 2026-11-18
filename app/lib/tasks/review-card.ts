/**
 * A review is a CARD, not a flag (Mike, 2026-11-18: "the reviews inside a project are tasks themselves, not stamps on other
 * tasks. And the review tasks shouldn't get a review stamp because... that would be insane.").
 *
 * A task IS a review card when it carries one of the tags below. `review-card` is the tag new review cards are filed with;
 * the others are the names review stages already use (the design track's review stage, a client review). A review card has
 * its own title, owner and date, so asking somebody to review it is circular: it may never carry `needs_review`.
 * Pure: no database.
 */

import { ApiError } from '@/lib/api/errors';

export const REVIEW_CARD_TAG = 'review-card';

const REVIEW_CARD_TAGS: ReadonlySet<string> = new Set([REVIEW_CARD_TAG, 'review', 'client-review', 'design-stage:review']);

export function isReviewCard(tags: readonly string[] | null | undefined): boolean {
  return (tags ?? []).some((t) => REVIEW_CARD_TAGS.has(t));
}

export const REVIEW_CARD_STAMP_TEXT =
  'A review card cannot carry needs_review. The review IS this card: it has its own title, owner and date, and it is closed by the person who does it. ' +
  'Put the review stamp on nobody else\'s behalf here; if the work it covers needs a decision, file a separate review card for that.';

/**
 * Throws a clear 422 when a write would leave a review card with the stamp. `needsReview` and `tags` are the values the
 * task will have AFTER the write. Callers pass `stampRequested` = true when the request itself turned the stamp on or moved
 * the card into a review tag while stamped, so a legacy stamped card can still be edited as long as the edit does not
 * touch either field (and can always clear the stamp).
 */
export function assertNoReviewStampOnCard(needsReview: boolean, tags: readonly string[] | null | undefined): void {
  if (needsReview && isReviewCard(tags)) throw new ApiError(REVIEW_CARD_STAMP_TEXT, 422, 'review_card_no_stamp');
}
