# Feature: Clarity Phase 4c — Arc View Completeness

## Overview

Enrich the arc board (`/oracle/arcs/[id]`) header with a session panel, a time-estimate
badge (computed + hand-overridable), and assignee chips on every task card; convert task
cards from full-screen navigation to the Phase 4b peek drawer (drag unaffected); fix a
small waiting-since parity gap on the Seeing Stone's session-type Today picks.

## Files to Create

- [x] `prisma/migrations/20260722173000_clarity_phase4c_arc_estimate_override/migration.sql`
      — additive `arcs.estimate_override_minutes INTEGER`, `IF NOT EXISTS` guard.
- [x] `lib/arc-sessions.ts` — pure `mergeArcSessions` (dedupe arc_id-linked sessions +
      an optional origin session by id).
- [x] `lib/__tests__/arc-sessions.test.ts`
- [x] `components/domain/oracle/arc-board-logic.ts` — pure `formatEstimateMinutes`/
      `arcEstimateDisplay`.
- [x] `components/domain/oracle/__tests__/arc-board-logic.test.ts`
- [x] `components/domain/oracle/ArcSessionPanel.tsx` — the arc board's session panel.
- [x] `components/domain/oracle/__tests__/ArcSessionPanel.test.tsx`
- [x] `scripts/seed-clarity-phase4c-arc-board-fixtures.ts` — e2e fixtures (assigned/
      unassigned/done tasks with estimates, one arc_id-linked waiting+needs_attention
      session), writes the fixture arc id to `test-results/clarity-phase4c/fixture-ids.json`.
- [x] `__tests__/e2e/oracle-phase4c-arc-board.spec.ts` — new e2e coverage.
- [x] `__tests__/e2e/global-setup.ts` — shared one-login-for-the-whole-suite fix (see
      Deviations; not originally scoped, but required to keep the suite's gates green).

## Files to Modify

- [x] `prisma/schema.prisma` — `Arc.estimate_override_minutes Int?`.
- [x] `lib/arc-status.ts` — export `TERMINAL_TASK_STATUSES`; add `sumOpenEstimatedMinutes`.
- [x] `lib/api/formatters.ts` — `formatArcResponse` gains optional `extras`
      (`sessions`, `estimatedMinutesTotal`) + unconditional `estimate_override_minutes`;
      `formatTodayPickResponse`'s `sessionSummary` extras gain optional
      `needs_attention`/`last_event_at`.
- [x] `app/api/arcs/[id]/route.ts` — `ARC_DETAIL_INCLUDE` gains `tasks.estimated_minutes`
      + a `sessions` relation include; new `computeArcExtras` (origin-session lookup +
      merge + sum); `updateArcSchema` gains `estimate_override_minutes`; both GET/PATCH
      pass the computed extras through.
- [x] `lib/hooks/use-arcs.ts` — `ArcTask.estimated_minutes`; new `ArcSessionSummary`;
      `ArcDetail`/`ArcSummary` gain the new fields; new `useUpdateArcEstimate` hook.
- [x] `lib/services/today-picks-shape.ts` — session select/summary gains
      `needs_attention`/`last_event_at`.
- [x] `app/api/today/[id]/route.ts` — same session select parity fix (PATCH response
      shape stays consistent with GET /api/today).
- [x] `lib/hooks/use-today.ts` — `TodayPick.session` gains optional
      `needs_attention`/`last_event_at`.
- [x] `components/domain/oracle/ArcBoard.tsx` — renders `ArcSessionPanel` + new
      `EstimateBadge` (inline set/clear editor) in the header; `ArcTaskCard`'s title
      becomes an `openTaskPeek` button instead of a `<Link>`; new `AssigneeChip`
      (avatar/initials or a quiet "unassigned" placeholder).
- [x] `app/(app)/oracle/arcs/[id]/page.tsx` — wraps `ArcBoard` in `TaskPeekProvider`.
- [x] `components/domain/oracle/today/TodayPickCard.tsx` — renders the waiting-since line
      for `item_type === 'session'` picks whose session is `needs_attention`.
- [x] `lib/api/registry/clarity.ts` — `/api/arcs` GET responseExample gains
      `estimate_override_minutes`; `/api/arcs/{id}` GET/PATCH gain the new fields'
      documentation.
- [x] `app/api/arcs/[id]/__tests__/route.test.ts` — extended (estimate override
      set/clear/untouched/bounds; sessions merge/no-redundant-lookup/empty).
- [x] `lib/__tests__/arc-status.test.ts` — `sumOpenEstimatedMinutes` cases.
- [x] `components/domain/oracle/today/__tests__/TodayPickCard.test.tsx` — waiting-since
      parity cases.
- [x] (Deviation — see below) `__tests__/e2e/oracle-phase3.spec.ts`,
      `oracle-phase4a-email.spec.ts`, `oracle-phase4b-peek.spec.ts`,
      `oracle-phase5-soothsayer.spec.ts`, `search.spec.ts`, `mobile-nav.spec.ts`,
      `playwright.config.ts` — converted to the shared-login fix.

## Implementation Steps

1. Additive migration + schema field; apply via `prisma migrate dev` (checksum drift from
   prior phases was confirmed already resolved — clean apply, no hand-patching needed).
2. `lib/arc-status.ts`/`lib/arc-sessions.ts` pure helpers + unit tests.
3. `formatArcResponse`/`formatTodayPickResponse` extension; `app/api/arcs/[id]/route.ts`
   wiring (`computeArcExtras`); registry docs.
4. Today-picks-shape + `/api/today/[id]` parity fix for the session waiting-since line.
5. Frontend: `use-arcs.ts` types + `useUpdateArcEstimate`; `ArcSessionPanel.tsx`;
   `arc-board-logic.ts`; `ArcBoard.tsx` header + `AssigneeChip` + peek-open task cards;
   `TaskPeekProvider` wrap on the arc board page; `TodayPickCard.tsx` waiting-since line.
6. Seed script + new e2e file; screenshots.
7. Full gates; found and fixed the rate-limit contention deviation (below) before calling
   the suite green.

## Tests to Update (from Impact Analysis)

- `app/api/arcs/[id]/__tests__/route.test.ts` — new fields on the fixture arc shape
  (`estimate_override_minutes`, `sessions`), new `oracleSession.findFirst` mock.
- `lib/__tests__/arc-status.test.ts` — new `sumOpenEstimatedMinutes` describe block.
- `components/domain/oracle/today/__tests__/TodayPickCard.test.tsx` — new session-pick
  waiting-since describe block.
- `__tests__/e2e/*.spec.ts` (5 existing files) — converted off per-file logins onto the
  new shared `globalSetup` storageState (deviation, see below).

## Tests to Write

- `lib/__tests__/arc-sessions.test.ts` (5)
- `components/domain/oracle/__tests__/arc-board-logic.test.ts` (9)
- `components/domain/oracle/__tests__/ArcSessionPanel.test.tsx` (8)
- `app/api/arcs/[id]/__tests__/route.test.ts` additions (12 new cases)
- `lib/__tests__/arc-status.test.ts` additions (5 new cases)
- `components/domain/oracle/today/__tests__/TodayPickCard.test.tsx` additions (4 new cases)
- `__tests__/e2e/oracle-phase4c-arc-board.spec.ts` (4 tests)

## Verification Checklist

- [x] Feature works as expected (verified live via Playwright + screenshot)
- [x] TypeScript compiles without errors
- [x] Unit tests pass (1827/153, floor 1784/150 + 43 new/updated across 3 new files + 3
      extended files)
- [x] No regressions in existing tests
- [x] `next build` succeeds, `/oracle/arcs/[id]` present in the route table
- [x] Full Playwright suite green, 3 consecutive clean runs (33/0 each) after fixing the
      rate-limit deviation
