# Feature: PATCH /api/tasks/:id honors status sent with other fields

## Overview
`updateTaskSchema` had no `status` field, so a combined body such as
`{ status: 'done', needs_review: true }` was stripped by zod and returned 200 with the old
status. Citadel task 83411a46. Fix: accept `status` on the combined path through the same
transition rules and side effects as the status-only path; a disallowed transition or unknown
value returns 400 and writes nothing.

## Files to Create
- [x] `app/app/api/tasks/[id]/__tests__/combined-status.test.ts` - failing-on-main proof + coverage

## Files to Modify
- [x] `app/app/api/tasks/[id]/route.ts` - `status` in the schema; shared helpers
  `assertStatusTransition`, `statusTransitionData`, `afterStatusChange` used by both paths
- [x] `app/lib/api/registry/tasks.ts` - document `status` on the PATCH body

## Implementation Steps
1. Write the test, confirm it fails on main (8 of 11 failed).
2. Extract the status-only path's transition check, timestamp/focus writes, and side effects
   (activity log, dependent propagation, portal first response, completion nudge) into helpers.
3. Combined path: validate the transition right after parsing, before any other lookup or write;
   spread the transition fields first so an explicit `is_focus` in the body wins.
4. A dependency connect with an unsatisfied blocker still forces `blocked`, except when the
   task is, or is being moved to, `done`/`abandoned`. A forced block alone keeps its old
   behavior (no activity entry, no started_at stamp).
5. A combined body that re-sends the current status is not a status change (no completed_at
   reset, no re-focus, no activity entry). From the review pass.

## Tests to Update (from Impact Analysis)
- None. Sibling suites (`blocked-by-ids`, `completion-nudge`, `dependency-propagation`,
  `portal-progress`, `arc-update`) pass unchanged.

## Verification Checklist
- [x] New tests pass; failed on unmodified main
- [x] `npx tsc --noEmit` exit 0
- [x] Full vitest suite: no new failures (two pre-existing files need a local Postgres on :5433)
- [x] Production build exit 0
- [x] Lint on the changed route below its baseline
