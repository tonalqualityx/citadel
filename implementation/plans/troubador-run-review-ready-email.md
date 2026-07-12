# Feature: Run-level "review ready" email

## Overview
Notify a Troubador run's assignee once (per completing transition) that the whole run
has reached the review stage — every live article is `in_review` or beyond, and at
least one just became `in_review`.

## Files to Modify
- [ ] `lib/services/troubador-notifications.ts` — add `notifyRunReviewReady(runId)`
- [ ] `app/api/troubador/articles/[id]/route.ts` — after a transition to `in_review`,
      compute whether this transition completed the run's review-ready set; fire once
- [ ] `app/api/troubador/articles/[id]/__tests__/route.test.ts` — mock
      `notifyRunReviewReady`; add tests for fire / no-fire / already-complete guard

## Implementation Steps
1. `notifyRunReviewReady(runId)`: load run (title, assignee_id, client.name, live
   article count), fire `createNotification` type `troubador_run_review_ready`,
   priority `high`, entityType `troubador_run`. Try/catch internally, never throws
   (matches `notifyArticleNeedsReview` convention).
2. In the PATCH route's worker draft-field branch (`data.status === 'in_review'`),
   when `notifyReview` would fire, additionally load sibling live articles
   (`run_id`, `is_deleted:false`, `id != this`, `status notIn [dropped,postponed]`,
   select `status`).
   - `REVIEW_OR_BEYOND = {in_review, needs_revision, approved, scheduled, published}`
   - `wasComplete` = `[...siblingStatuses, article.status(old)]` all in the set AND
     at least one equals `in_review`.
   - `isComplete` = `[...siblingStatuses, 'in_review']` (this article's new status)
     all in the set (trivially includes an `in_review`, itself).
   - Fire `notifyRunReviewReady(article.run_id)` (fire-and-forget, `.catch`) iff
     `isComplete && !wasComplete`.
3. Keep `notifyArticleNeedsReview` call/guard untouched.

## Tests to Update
- `app/api/troubador/articles/[id]/__tests__/route.test.ts` — mock
  `notifyRunReviewReady` alongside `notifyArticleNeedsReview` (module mock currently
  only provides the latter — an unmocked second export would throw).

## Tests to Write
- Single-article run, drafting → in_review: fires `notifyRunReviewReady`.
- Run with a sibling still `drafting`: does NOT fire.
- Resubmission (`needs_revision` → `in_review`) completes the set (sibling already
  `approved`, none `in_review` yet): fires.
- Set already complete before this PATCH (a sibling already `in_review`): does NOT
  refire.

## Verification Checklist
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run app/api/troubador/articles/[id]/__tests__/route.test.ts`
