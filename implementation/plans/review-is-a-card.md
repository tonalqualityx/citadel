# Feature: A review is a card, not a flag

## Overview
Mike, 2026-11-18: tasks need no review unless a reason says so; reviews inside a project are tasks themselves, and a review task never carries a review stamp. The worker skill (outside this repo) stops stamping every shipped task. Here: the API refuses `needs_review` on a review card.

## Impact analysis
- Writers of needs_review in the API: `lib/services/task-patch.ts` (PATCH, the one place; bast-chat and the worker reach it through `/api/tasks/[id]`) and `app/api/tasks/route.ts` POST. Other routes set it on creation for non-review cards (charter commission, review-tasks list, oracle projects, sops) and are untouched.
- Review cards have no schema marker; they are identified by tag (`review-card` new, plus existing `review`, `client-review`, `design-stage:review`). No migration.
- Not touched: loadReviewFolds, the auto-approve sweep, keeper summaries.
- Tests touching the area: `combined-status.test.ts` sends `{status: done, needs_review: true}` on an untagged task: still passes.

## Files to Create
- [x] `app/lib/tasks/review-card.ts` - `isReviewCard`, `assertNoReviewStampOnCard` (422 `review_card_no_stamp`)
- [x] `app/lib/tasks/__tests__/review-card.test.ts`
- [x] `app/app/api/tasks/[id]/__tests__/review-card-stamp.test.ts`

## Files to Modify
- [x] `app/lib/services/task-patch.ts` - check after parse, only when the body touches needs_review or tags
- [x] `app/app/api/tasks/route.ts` - POST refuses an explicit stamp on a review card, drops an SOP-default stamp

## Behaviour
Refused: needs_review true on a review-tagged task, tagging a stamped task as a review card. Allowed: clearing the stamp, editing a legacy stamped card without touching stamp or tags.
