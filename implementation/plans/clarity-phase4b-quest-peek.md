# Feature: Clarity Phase 4b — Quest Peek View

Spec: `feature-planning/clarity-phase4b-quest-peek.md`. Branch
`feat/clarity-phase1-data-plane`, worktree `~/.openclaw/workspace/citadel-clarity-wt`.

## Baseline (recorded before any change)

- `npm run test:run`: 1658 tests / 141 files, exit 0.
- `npx playwright test`: 15 passed / 0 failed, exit 0.

## Impact analysis

**Codebase impact:** `AskCard.tsx`, `TodayPickCard.tsx`, `DueSoonRow.tsx`, `IntakeDrawer.tsx`
are used ONLY within the Oracle page tree (`grep` confirmed — no other page imports them),
so swapping their navigation for peek-open is scoped to `/oracle` and cannot regress other
pages. `TaskPeekDrawer` (`components/domain/tasks/task-peek-drawer.tsx`) IS used elsewhere
(`/tasks`, `/projects/[id]`, `/deals/[id]`, dashboard Overlooks) — any change to it must be
purely additive (arc display gated on `task.arc` presence) and must not touch its existing
props/behavior. `formatTaskResponse` (`lib/api/formatters.ts`) is used by every task GET/PATCH
response across the app — adding `arc`/`arc_id` fields is additive (new keys only) and safe
as long as no test does exact-shape equality on its output (confirmed: none does).
`updateTaskSchema` (`app/api/tasks/[id]/route.ts`) is zod-validated and strips unknown keys
by construction — adding `arc_id` is additive; `allowedTechFields` list is unaffected (arc_id
stays PM/Admin-only, consistent with `project_id`/`client_id` not being tech-editable either).

**Test impact:** `app/api/tasks/[id]/__tests__/dependency-propagation.test.ts` mocks
`prisma.task.update`'s resolved shape manually per-test — adding a field to
`formatTaskResponse`'s real output doesn't touch these mocks (it's mocked, not the real
formatter, in that file). `app/api/today/due-soon/__tests__/route.test.ts` mocks
`prisma.todayPick.findMany` with a single shared mock; the due-soon route change adds a
*second* Prisma call for arc-picks — existing tests calling `.mockResolvedValue(...)` (not
`Once`) apply that same value to both calls, which is harmless (verified: the fixture
`task()` has no `arc_id`, so the new exclusion clause never triggers on old test data).
`components/domain/oracle/intake/__tests__/IntakeDrawer.test.tsx` mocks
`next/navigation`'s `useRouter` — that mock becomes unused once `handleCreateAndOpen` no
longer calls `router.push`; removed along with the `useRouter` import in the component.
`components/domain/oracle/today/__tests__/DueSoonRow.test.tsx` has no assertion on the title
being a plain `<span>` — safe to swap for a button.

## Files to Create

- [x] `lib/contexts/task-peek-context.tsx` — `TaskPeekProvider` + `useTaskPeek()`.
- [x] `lib/contexts/__tests__/task-peek-context.test.tsx` — provider/hook unit tests.
- [x] `app/api/tasks/[id]/__tests__/arc-update.test.ts` — PATCH arc_id tests.
- [x] `app/api/today/due-soon/__tests__/` extension (existing file, new cases).
- [x] `scripts/seed-clarity-phase4b-peek-fixtures.ts` — e2e fixtures (a review-queue task,
      an arc-linked due-soon task with its arc picked vs not picked).
- [x] `__tests__/e2e/oracle-phase4b-peek.spec.ts` — new e2e file.

## Files to Modify

- [x] `app/(app)/oracle/page.tsx` — wrap in `<TaskPeekProvider>`.
- [x] `components/domain/oracle/needs-reshi/AskCard.tsx` — `open_review` action calls
      `openTaskPeek` instead of `<Link>`.
- [x] `components/domain/oracle/today/TodayPickCard.tsx` — `quest` action calls
      `openTaskPeek` instead of `<Link>`.
- [x] `components/domain/oracle/today/DueSoonRow.tsx` — title becomes a button calling
      `openTaskPeek`.
- [x] `components/domain/oracle/intake/IntakeDrawer.tsx` — `handleCreateAndOpen` calls
      `openTaskPeek` instead of `router.push`; drop unused `useRouter`.
- [x] `app/api/tasks/[id]/route.ts` — `arc_id` in `updateTaskSchema` + validate/attach/detach
      logic in PATCH; `arc` added to GET/PATCH `include` blocks.
- [x] `lib/api/formatters.ts` — `formatTaskResponse` gains `arc_id`/`arc`.
- [x] `lib/hooks/use-tasks.ts` — `Task` interface gains `arc_id`/`arc`.
- [x] `components/domain/tasks/task-peek-drawer.tsx` — additive Arc context row (mirrors the
      existing Charter block), only rendered when `task.arc` is present.
- [x] `app/api/today/due-soon/route.ts` — exclude tasks whose `arc_id` is picked today.

## Tests to Update

- [x] `components/domain/oracle/intake/__tests__/IntakeDrawer.test.tsx` — Create+open now
      calls `openTaskPeek`, not `router.push`; drop the `next/navigation` mock.
- [x] `components/domain/oracle/today/__tests__/DueSoonRow.test.tsx` — title click opens
      peek.
- [x] `app/api/today/due-soon/__tests__/route.test.ts` — new arc-exclusion cases.

## Tests to Write

- `task-peek-context` provider/hook (opens with right id, no-op default outside a provider).
- `AskCard` review-open calls `openTaskPeek`, not navigation.
- `TodayPickCard` quest action calls `openTaskPeek`.
- PATCH `/api/tasks/[id]` arc_id: attach, detach (explicit null), invalid-arc 404,
  absent-untouched, unknown-fields-still-stripped regression.
- Due-soon: task whose arc is picked today → excluded; same task, arc not picked → included.
- e2e: Review card peek opens on-page (URL unchanged), Escape closes, "View in Fullscreen"
  navigates; screenshots desktop + mobile with peek open.

## Verification Checklist

- [x] `npx tsc --noEmit` clean.
- [x] `npm run test:run` — 1705/147 (baseline 1658/141), 0 failures.
- [x] `npm run build` clean.
- [x] `npx playwright test` — 20/0 (baseline 15/0), 0 failures, screenshots saved; verified
      stable across 6 consecutive full-suite runs (see verification record Deviations #2
      and #5).
- [x] Registry updated: `lib/api/registry/tasks.ts` gets `arc_id`/`arc` in GET's
      responseExample and a `bodySchema` entry for `arc_id` on PATCH; `lib/api/registry/
      clarity.ts` gets a new GET `/api/email-asks` entry + PATCH `/api/email-asks/{id}`'s
      bodySchema extended with `training_note` and the `archive_requested` state value.
- [x] Commit(s), no push. — see verification record for full details.

## Addenda (mid-task additions from the coordinator, folded into this same plan/gates)

1. `arc_id` accepted by `PATCH /api/tasks/[id]` (attach/detach/404/untouched).
2. Due-soon row excludes tasks whose arc was picked today (not just directly-picked tasks).
3. Today board lens: real persisted Doing column (`today_picks.started_at`) + drag-and-drop
   between all three columns, same dnd-kit pattern as ArcBoard.
4. Intake relocated out of the main column into a header trigger chip + slide-over drawer
   (reusing the quest-peek Drawer pattern); `EmailAskState` gains `archive_requested` +
   new GET `/api/email-asks` for the machine-side classifier; `email_asks.training_note`
   for Mike's own calibration notes on a classification.

See `feature-planning/clarity-phase4b-verification.md` for full details, gate numbers, and
deviations.
