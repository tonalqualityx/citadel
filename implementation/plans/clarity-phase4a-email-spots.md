# Feature: Clarity Phase 4a — Email on the Glass

Spec: `feature-planning/clarity-phase4a-email-spots.md`. Prior context: Phase 1 (arcs/ideas/
session-tasks/waiting-on-me), Phase 3 (Oracle Face: Today/Needs Reshi), 3b (real calendar),
3c (Fleet split), 3d (per-user timezone). Branch `feat/clarity-phase1-data-plane`, worktree
`~/.openclaw/workspace/citadel-clarity-wt`.

## Baseline (recorded before any change)

- `npm run test:run`: 1571 tests / 130 files, exit 0.
- `npx playwright test`: 11 passed / 0 failed, exit 0 — after fixing a pre-existing bug in
  `scripts/seed-clarity-phase3-fixtures.ts` (seeded today_picks/calendar_events on the raw
  UTC date; Phase 3d moved `/api/today`'s "today" to the admin's zoned date — the two
  diverge for several hours every evening ET, which is exactly when this baseline ran).
  Deviation, not scope creep: without it the floor cannot be established honestly, and it's
  test-fixture-only, zero product code touched.

## Overview

Email surfaces on the Seeing Stone: a crisis strip (urgent, exception-only) above Today, a
collapsed intake drawer (non-urgent client mail) under Needs Reshi, and a due-soon row at
the foot of Today. Plus a staged (not cron-wired) classifier script that reads both
mailboxes via `gog` and posts classifications to the new sync endpoint.

## Files to Create

- [ ] `prisma/migrations/<ts>_clarity_phase4a_email_asks/migration.sql` — additive, IF NOT
      EXISTS on the enum ALTER.
- [ ] `lib/email-asks.ts` — pure helpers: gist-never-for-personal guard (defense in depth,
      not the enforcement point), due-soon window/TZ math (incl. 8pm boundary), subject
      Re:/Fwd: stripping for create-task title.
- [ ] `lib/arc-resolution.ts` — shared arc_id/arc_name resolution extracted from
      `app/api/session-tasks/route.ts` (used by both session-tasks and create-task).
- [ ] `app/api/oracle/email-sync/route.ts` — POST, bearer auth, batch upsert by message_id,
      urgent -> Notification.
- [ ] `app/api/email-asks/[id]/route.ts` — PATCH state/task_id.
- [ ] `app/api/email-asks/[id]/create-task/route.ts` — POST, Task prefill + idempotency.
- [ ] `lib/hooks/use-email-asks.ts` — React Query hooks (crisis/intake read via
      waiting-on-me response; mutations: handled/dismiss/create-task).
- [ ] `components/domain/oracle/crisis/CrisisStrip.tsx` + `crisis-strip-logic.ts`.
- [ ] `components/domain/oracle/intake/IntakeDrawer.tsx` + `intake-drawer-logic.ts`.
- [ ] `components/domain/oracle/today/DueSoonRow.tsx` + due-soon logic (in
      `lib/email-asks.ts` or a sibling `due-soon-logic.ts` — decide during impact pass).
- [ ] `~/.claude/tools/oracle/clarity/email-classifier.py` + `classifier-crontab.snippet`
      (STAGED, not wired).
- [ ] `scripts/seed-clarity-phase4a-email-fixtures.ts` — e2e fixtures (crisis + intake +
      due-soon), zoned-date-aware from day one (learned from the baseline bug above).
- [ ] Test files alongside each of the above per repo convention.

## Files to Modify

- [ ] `prisma/schema.prisma` — `EmailAsk` model, `AskQueue`/`AskSeverity` reused,
      `EmailAskState` enum, `NotificationType` +`oracle_urgent_email`, `Task.email_ask`
      back-relation (optional 1:1 via `EmailAsk.task_id`).
- [ ] `app/api/session-tasks/route.ts` — swap inline arc resolution for the shared lib fn
      (behavior-preserving refactor; existing tests must stay green untouched).
- [ ] `app/api/waiting-on-me/route.ts` — add `crisis`/`intake` to the response.
- [ ] `app/api/today/route.ts` (or a new `app/api/today/due-soon/route.ts` — decide during
      impact pass which reads cleaner) — due-soon list.
- [ ] `lib/services/notifications.ts` — `notifyUrgentEmail()`.
- [ ] `lib/hooks/use-notification-preferences.ts`, `lib/services/notification-preferences.ts`,
      `lib/services/email-notifications.ts`, `lib/services/slack-notifications.ts` — extend
      the 4 exhaustive `NotificationType` maps.
- [ ] `lib/api/registry/clarity.ts` / `oracle.ts` — register email-sync, email-asks PATCH,
      create-task, waiting-on-me crisis/intake shape.
- [ ] `app/(app)/oracle/page.tsx` — mount CrisisStrip (above Today), IntakeDrawer (under
      Needs Reshi).
- [ ] `components/domain/oracle/today/TodaySection.tsx` — mount DueSoonRow at the foot.
- [ ] `__tests__/e2e/oracle-phase3.spec.ts` or a new `oracle-phase4a-email.spec.ts` — new
      e2e (decide during impact pass whether to extend or add a file; likely a new file
      given the spec's own "regenerate screenshots incl. one WITH crisis" instruction).

## Impact Analysis (dispatched before implementation)

Sub-agent A (codebase impact): confirm nothing else reads `waiting-on-me`'s shape
positionally (array-destructuring that a new key would break), confirm `NotificationType`
maps are exhaustively typed (`Record<NotificationType, ...>`) so a missing case is a
TS-level compile error, not silent.

Sub-agent B (test impact): enumerate every test file touching `session-tasks` (arc
resolution refactor must not change behavior), `waiting-on-me`, `notification-preferences`,
`email-notifications`, `slack-notifications`.

## Tests to Update

- [ ] `app/api/session-tasks/__tests__/route.test.ts` — stays green untouched (refactor is
      behavior-preserving); add nothing here unless the extraction reveals an uncovered
      edge.
- [ ] `app/api/waiting-on-me/__tests__/route.test.ts` — add crisis/intake shape assertions.
- [ ] `lib/services/__tests__/notification-preferences.test.ts`,
      `lib/hooks/__tests__/use-notification-preferences.test.ts` (if present) — new type in
      exhaustive maps.

## Tests to Write

- email_asks CRUD/state machine (lib + route).
- sync upsert + urgent-notification side effect (idempotent re-POST doesn't duplicate).
- create-task prefill/idempotency/client-match/arc passthrough.
- waiting-on-me crisis/intake shape.
- due-soon TZ logic incl. the 8pm boundary (mirrors the exact bug class hit in baselining).
- shared arc-resolution lib: unit tests + session-tasks regression stays green.
- component tests: CrisisStrip render-only-when-nonempty, IntakeDrawer collapsed-by-default.
- e2e: crisis strip renders with seeded urgent + disappears on Handled; intake drawer
  expand/cards; due-soon row + add-to-Today; screenshots incl. one WITH crisis visible.

## Verification Checklist

- [ ] Migration applied (`prisma migrate dev`), psql evidence.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run test:run` >= 1571+new, 0 failures.
- [ ] `npm run build` clean.
- [ ] `npx playwright test` >= 11+new, 0 failures, screenshots saved.
- [ ] Classifier real run against both live mailboxes (becomeindelible + whoismikedion),
      posting to local dev on :3005, DB rows + notification row as evidence.
- [ ] Registry updated.
- [ ] Commit(s), no push.
