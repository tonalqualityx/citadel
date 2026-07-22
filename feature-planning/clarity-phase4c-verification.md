# Clarity Phase 4c — Arc View Completeness — Verification Record

Spec: `feature-planning/clarity-phase4c-arc-view-completeness.md`. Plan:
`implementation/plans/clarity-phase4c-arc-view-completeness.md`. Continues on
`feat/clarity-phase1-data-plane` in worktree `citadel-clarity-wt`; Phases 1–5 already live.

## Baseline

- `npm run test:run`: **1784 tests / 150 files, exit 0.**
- `npx playwright test`: **29 passed / 0 failed, exit 0.**

Both matched the spec's stated floor exactly (Phase 5's own final gate).

## Migration

`prisma/migrations/20260722173000_clarity_phase4c_arc_estimate_override/` — one additive
nullable column, `arcs.estimate_override_minutes INTEGER`, `ADD COLUMN IF NOT EXISTS`
guard.

Applied cleanly via `prisma migrate dev --name clarity_phase4c_arc_estimate_override` —
`prisma migrate status` was already clean before this phase started (no checksum drift),
confirming Phase 5's own fix to the recurring `20260722021159_clarity_phase4a_email_asks`
checksum-drift issue held. This is the first phase in a while that didn't need any manual
`psql`/`_prisma_migrations` patching — `migrate dev` worked exactly as intended.

## Server-side additions

1. **`Arc.estimate_override_minutes`** — `PATCH /api/arcs/[id]` accepts it (set/null/
   untouched, same pattern as `closed_at`/`snoozed_until`), bounded `0..100000` (sanity
   ceiling, not a product constraint). `lib/arc-status.ts` gains `sumOpenEstimatedMinutes`
   (sums non-terminal tasks' `estimated_minutes`, null-safe) and exports
   `TERMINAL_TASK_STATUSES` so it never drifts from `getArcStatus`'s own terminal
   definition.
2. **Arc session panel data** — `GET`/`PATCH /api/arcs/[id]` (`ARC_DETAIL_INCLUDE`) now
   also fetch the arc's `sessions` relation (arc_id-linked `OracleSession` rows) and, when
   `origin_session_external_id` is set and not already among them, a second lookup by
   `external_id` — merged/deduped via new `lib/arc-sessions.ts`'s pure `mergeArcSessions`.
   A shared `computeArcExtras` helper keeps GET and PATCH's shaping identical.
3. **`formatArcResponse` extended** (`lib/api/formatters.ts`) — `estimate_override_minutes`
   unconditional (a raw column, no extra query); `sessions`/`estimated_minutes_total` only
   appear when the caller passes them as `extras` (mirrors `formatTodayPickResponse`'s own
   `withProgress`-gated `progress_percent` precedent) — the list/create arc endpoints'
   shape is byte-for-byte unchanged.
4. **Today pick session waiting-since parity fix** — `lib/services/today-picks-shape.ts`
   and `app/api/today/[id]/route.ts`'s session lookups both gained
   `needs_attention`/`last_event_at` in their `select` + the `sessionSummary` extras type,
   so a session-type Today pick's card can render the same quiet line the arc board's
   session panel does.

## UI

- `components/domain/oracle/ArcSessionPanel.tsx` — reuses `StatusDot`/`OracleStatusBadge`
  verbatim for the live-status chip (so `needs_attention` correctly outranks the plain
  status label, same priority every other Oracle status chip already has), `commandAge`
  for the waiting-since line. Renders nothing when the arc has no linked sessions
  (exception display, per the spec).
- `components/domain/oracle/arc-board-logic.ts` — pure `formatEstimateMinutes`/
  `arcEstimateDisplay` (prefers the override, labeled "(set by hand)").
- `ArcBoard.tsx`'s new `EstimateBadge` — a quiet pencil-affordance button that opens a
  minimal inline number-input form (mirrors the existing `QuickAddQuest` toggle-then-form
  pattern), `useUpdateArcEstimate()` → `PATCH /api/arcs/[id]`. Needed because the spec's
  "set by hand" framing implies a real in-app way for Mike to set the override, not an
  API-only field with no UI path to invoke it.
- `ArcBoard.tsx`'s new `AssigneeChip` — `Avatar` (initials, colored) for an assigned task,
  a quiet dashed-outline "?" placeholder (title="Unassigned") when there's no assignee —
  "every card shows its assignee" holds even for the empty state, and never implies a
  person exists that doesn't.
- `ArcTaskCard`'s title is now a button calling `openTaskPeek(task.id)` instead of a
  `<Link href="/tasks/[id]">` — `app/(app)/oracle/arcs/[id]/page.tsx` wraps `ArcBoard` in
  `TaskPeekProvider` (mirrors `OraclePage`'s own Phase 4b wrap). Drag is unaffected: the
  dnd-kit listeners are on the outer `DraggableCard` div (same as before this phase), the
  inner title element just changed from an anchor to a button — verified live via e2e
  (click opens the peek without moving the card; a real drag moves the card without
  opening the peek).
- `components/domain/oracle/today/TodayPickCard.tsx` — renders a quiet "waiting since
  <time>" line for `item_type === 'session'` picks whose session is `needs_attention` and
  has a `last_event_at`. Self-contained `useNow(30_000)` (same pattern
  `ArcSessionPanel` uses) rather than threading `nowMs` down through
  `TodaySection` → `TodayBoard` → `TodayBoardColumn` → `DraggableTodayPick` for one small
  line.

## Gates (all executed, exit codes recorded)

| Gate | Result |
|---|---|
| `npm run test:run` | **1827 tests / 153 files, exit 0** (baseline 1784/150 + 43 new/updated: `lib/__tests__/arc-sessions.test.ts` (5, new), `components/domain/oracle/__tests__/arc-board-logic.test.ts` (9, new), `components/domain/oracle/__tests__/ArcSessionPanel.test.tsx` (8, new), plus extensions to `lib/__tests__/arc-status.test.ts`, `app/api/arcs/[id]/__tests__/route.test.ts`, `components/domain/oracle/today/__tests__/TodayPickCard.test.tsx`) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 — `/oracle/arcs/[id]` and every other route present in the route table |
| `npx playwright test` (full suite) | **33 passed / 0 failed, exit 0** — re-run 3 consecutive times after the rate-limit fix below, all clean (33/33 every time) |

New e2e: `__tests__/e2e/oracle-phase4c-arc-board.spec.ts` (4 tests, fixtures from
`scripts/seed-clarity-phase4c-arc-board-fixtures.ts`): session panel + estimate badge +
assignee chips render correctly (desktop screenshot); a task card click opens the peek
drawer on the same page (URL unchanged) with a screenshot; a real drag still moves a task
between columns and persists through reload, with the peek drawer confirmed NOT opened as
a side effect; the estimate override sets via the inline editor, persists through reload,
and Clear reverts to the computed sum.

Screenshots: `app/test-results/clarity-phase4c/desktop-1280-arc-board-header.png` (session
panel + estimate badge + assignee chips all visible), `app/test-results/clarity-phase4c/desktop-1280-arc-board-peek-open.png`.

## Deviations

1. **A real, reproducible-every-time rate-limit contention found and fixed, not swept
   under the rug.** `POST /api/auth/login` is rate-limited 10 req/min, IP-bucketed
   (`lib/api/rate-limit.ts`), shared across the ENTIRE e2e suite regardless of spec file or
   worker. This phase's own new spec file added a 5th Oracle e2e file each doing its own
   real per-file login (the established Phase 4b pattern) — on top of that, a separate,
   previously-undiscovered bug in `search.spec.ts` (`beforeEach` instead of `beforeAll`,
   3 real logins for its 3 tests instead of 1) meant the full suite's true total was
   already higher than any single file's own comment accounted for. Confirmed via direct
   instrumentation (a temporary debug log in `authRateLimit`, removed after diagnosis) that
   a clean full-suite run made **11** real `POST /api/auth/login` calls against a limit of
   10 — the 11th deterministically blocked with a 429, and which file's login happened to
   land 11th varied run to run (parallel worker scheduling), explaining why the failure
   appeared to "move" between `oracle-phase5-soothsayer.spec.ts` and
   `oracle-phase4a-email.spec.ts` across different runs — not flakiness, a real over-budget
   condition. This is the THIRD time this exact contention class has surfaced (flagged in
   Phase 4a, patched once in Phase 4b for `oracle-phase3.spec.ts`'s own per-test-login bug),
   so per the repo's own "third recurrence needs actual investigation, not another one-off
   patch" precedent (established for the migration-checksum issue), fixed it at the root
   instead of patching one more file: added a Playwright `globalSetup`
   (`__tests__/e2e/global-setup.ts`) that performs exactly ONE real admin login for the
   entire suite and writes one shared `storageState` file; every spec file that used to
   perform its own login (`oracle-phase3`, `oracle-phase4a-email`, `oracle-phase4b-peek`,
   `oracle-phase5-soothsayer`, this phase's own `oracle-phase4c-arc-board`, `search.spec.ts`,
   `mobile-nav.spec.ts`) now just points `test.use({ storageState })` at that one shared
   file. `auth.spec.ts` is the one deliberate exception — it's the dedicated login-FLOW
   test, its 2 real submits (invalid + valid credentials) are the point of that file and
   stay real. New total real logins per full suite run: 1 (shared) + 2 (`auth.spec.ts`'s
   own) = 3, down from 11 — comfortably under budget with real headroom for future phases.
   Verified clean across 3 consecutive full-suite runs after the fix (33/33 every time).
   This touches 7 files outside this phase's nominal scope, but per the same precedent
   Phase 4b's own deviation set ("leaving a gate that reliably breaks because of this
   phase's own addition is not an acceptable trade"), the fix applies an already-
   established pattern (per-file storageState reuse) at a higher level (shared across
   files instead of duplicated per file) and changes zero test assertions.
2. **Session panel's live-status chip reads "Needs attention", not "Waiting", for a
   `needs_attention` session** — not a bug, a correct consequence of reusing
   `getStatusMeta` verbatim (its existing priority: `needs_attention` outranks the plain
   status label, same as every other Oracle status chip). The e2e's own assertion was
   written expecting "Waiting" first, caught and fixed to expect "Needs attention" with an
   explanatory comment before the gate was called green — never shipped as a wrong
   assertion.
3. **`estimate_override_minutes`/`sessions` made optional (not unconditional-with-a-fake-
   default) in `formatArcResponse`'s extras** — see the Server-side additions section
   above. Chose this over defaulting to `0`/`[]` for the list endpoint because a fake zero
   would misrepresent "not computed" as "computed to zero", which the codebase's own
   `progress_percent` precedent already avoids the same way.

## Session-contract note for Bast (machine-side, post-deploy)

None — this phase is Oracle-UI-only, no session/manifest contract changes.

## Commits

See `git log` on `feat/clarity-phase1-data-plane` — this spec + verification record
committed alongside the implementation, chunked per repo convention. No push.
