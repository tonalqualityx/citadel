import { describe, it, expect } from 'vitest';
import { isReviewCard, assertNoReviewStampOnCard, REVIEW_CARD_TAG } from '../review-card';

describe('review-card', () => {
  it('knows a review card by its tag', () => {
    for (const t of [REVIEW_CARD_TAG, 'review', 'client-review', 'design-stage:review']) expect(isReviewCard(['x', t])).toBe(true);
    for (const t of ['needs-review', 'preview', 'design-stage:refine', 'review-later']) expect(isReviewCard([t])).toBe(false);
    expect(isReviewCard(null)).toBe(false);
  });
  it('refuses the stamp on a review card only', () => {
    expect(() => assertNoReviewStampOnCard(true, ['review-card'])).toThrow(/review card cannot carry needs_review/);
    expect(() => assertNoReviewStampOnCard(false, ['review-card'])).not.toThrow();
    expect(() => assertNoReviewStampOnCard(true, ['client-approval'])).not.toThrow();
  });
});
