# Clarity Phase 5 — The Soothsayer + Needs Reshi rework — Verification Record

Spec: `feature-planning/clarity-phase5-soothsayer.md`. Plan:
`implementation/plans/clarity-phase5-soothsayer.md`. Continues on
`feat/clarity-phase1-data-plane` in worktree `citadel-clarity-wt`; phases 1-4b already live.

Mid-build addition from the coordinator (folded in before the phase froze): the arc board
gains a "+ Quest" quick-add and a back-to-Seeing-Stone link.

## Baseline

- `npm run test:run`: **1705 tests / 147 files, exit 0.**
- `npx playwright test`: **20 passed / 0 failed, exit 0.**

Both matched the spec's stated floor exactly.

## Migration

`prisma/migrations/20260722162324_clarity_phase5_arc_snooze/` — one additive nullable
column, `arcs.snoozed_until TIMESTAMP(3)`, `ADD COLUMN IF NOT EXISTS` guard.

Applied by hand (`docker exec citadel-postgres psql`), then registered via a direct
`INSERT` into `_prisma_migrations` with the real file's sha256 checksum — `prisma migrate
dev` refused with the SAME pre-existing checksum-drift error Phase 4b's own verification
record flagged (`20260722021159_clarity_phase4a_email_asks` "modified after it was
applied"). This time the drift was actually **resolved**, not just re-flagged: the recorded
checksum for that migration still didn't match its file's real sha256 (confirmed by
computing both and diffing them), meaning Phase 4b's own fix never actually landed in this
dev DB's `_prisma_migrations` table (or was undone by a later reset). Corrected it with a
direct `UPDATE ... SET checksum = <real sha256>`, then confirmed `prisma migrate status`
reports clean. `prisma migrate dev` should work normally for the next phase now — but this
is the SECOND time this exact drift has needed a manual fix, so if it recurs a third time
the underlying cause (why the checksum keeps reverting) needs actual investigation, not
another one-off patch.

## Server-side additions

1. **`Arc.snoozed_until`** — `PATCH /api/arcs/[id]` accepts it (set/null/untouched, same
   pattern as `closed_at`). `formatArcResponse` carries it. `lib/arc-snooze.ts` — pure
   `computeSnoozeUntil` (1d/3d/next_week/pick-date) + `isArcSnoozed`.
2. **Future-dated Today picks verified, not fixed** — `POST /api/today` already accepted
   any date with no special-casing (`parseDateParam` just parses the given string; the WIP
   cap is already scoped `where: { date: targetDate }`, per-day). Added regression tests
   (GET + POST) proving it, per the spec's own instruction ("verify... if anything blocks
   future dates, fix it" — nothing did).
3. **`GET /api/oracle/soothsayer`** (new, admin-gated) — one consolidated read: `days[]`
   (today + 6 forward, each with picks + meeting_count/meeting_minutes), `unplanned` (open
   un-snoozed arcs with no future-or-today pick + live not-ended/stale sessions with no
   future-or-today pick — evaluated across ALL arcs/sessions, not just the visible window),
   `snoozed` (arcs with `snoozed_until` in the future, oldest-wake-first). Reuses
   `lib/services/today-picks-shape.ts` (extracted from `/api/today` — behavior-identical
   refactor, both routes now share one implementation) so the day columns' pick shape can
   never drift from `/api/today`'s own.
4. **`GET /api/today/calendar`** gains an optional `days` param (default 5, unchanged for
   the Today header's own week strip; the Soothsayer requests 7).
5. **`GET /api/waiting-on-me`** — merged `waiting: []` (decide+answer, decide first, each
   item tagged `queue_type: decision|reply`); `decide`/`answer` kept in the response,
   unchanged, for one release of back-compat. Every card now also carries `client` (task
   cards only — the Review grouping's client-then-arc-then-Other fallback) and
   `waiting_since` (task `updated_at` / session `last_event_at` — best-available "when did
   this start waiting" proxy).
6. **`POST /api/tasks`** gains additive `arc_id` (coordinator addition, the arc board's "+
   Quest") — 404-checked; when given with no `assignee_id` and no project/function
   auto-assign match, defaults to the primary operator (mike@becomeindelible.com), same
   fallback `/api/session-tasks` uses, scoped ONLY to arc-linked creation so the general
   no-arc creation path (dashboard "add task", etc.) is completely unaffected — verified by
   a dedicated regression test asserting `prisma.arc.findMany`/`prisma.user.findMany` are
   never called when `arc_id` is absent.

## The Soothsayer (UI)

New route `/oracle/soothsayer`, admin-gated (same pattern as every other Oracle screen), nav
item under Oracle (🌙 Soothsayer, both `Sidebar.tsx` and `MobileNav.tsx`).

- `components/domain/oracle/soothsayer/Soothsayer.tsx` — top-level; day columns (pure CSS
  responsive grid, `grid-cols-1` up through `lg:grid-cols-7` — no JS layout branch, no
  hydration flash), `UnplannedSection`, `SnoozedRow`.
- `DayColumn.tsx` — reuses `TodayPickCard` VERBATIM for the day's picks (arc name +
  progress via a new optional `progress_percent` on the arc summary, session title, task
  title, the existing type-adaptive primary action, the attention dot, the snooze menu) —
  the spec's "reuse existing card components where possible" satisfied by literally reusing
  the same component rather than building a parallel one. Today's column gets an accent
  border + "Today" label.
- `UnplannedSection.tsx` — the can-never-lose-an-arc guarantee. Each row: a day-picker
  `Select` (POST `/api/today` for that date, the 409 WIP-cap surfacing via the EXISTING
  `useCreateTodayPick` error toast — no new error-handling path needed) and, for arcs, the
  snooze menu.
- `SnoozedRow.tsx` — reuses the existing (previously used only by the Fleet crons/recently-
  ended groups) `CollapsibleGroup` component for the collapsed "Snoozed" row.
- `SnoozeMenu.tsx` — 1d / 3d / next week / pick date, or "Unsnooze" once already snoozed.
  Mounted on: Soothsayer's unplanned arc rows, Soothsayer's snoozed rows, AND `TodayPickCard`
  for arc-type picks (so "arc cards elsewhere get a snooze action" per the spec, not just on
  the Soothsayer) — required threading `snoozed_until` through the arc summary shape in
  `lib/services/today-picks-shape.ts` and `formatTodayPickResponse`'s `arcSummary` extra.

**Deviation (density fix, caught by screenshot review, not by unit tests):** the first
render of the Soothsayer against this dev DB's REAL data (not clean unit-test fixtures)
showed the "No day assigned" section dumping **every idle Claude Code session across every
client repo Mike has ever had a session in** — dozens of rows, since "every live session
with no pick" is trivially true for any session nobody has ever bothered to pick (Today
picks are a Phase-3-era concept; no historical session was ever going to have one). This
directly violated the binding evidence-bound kanban density rule (5-7 visible cards, "+N
more" overflow) that governs every other list in the Oracle — I'd simply failed to apply it
to this new section. Fixed by running `unplanned.arcs`/`unplanned.sessions` through the
existing `capColumnCards` (same cap, same "+N more" static overflow line pattern
`ArcBoard.tsx`'s own columns already use), plus adding `orderBy: { last_event_at: 'desc' }`
to the live-sessions query (it had none — meaning the cap was trimming to an
effectively-arbitrary insertion order, burying genuinely fresh sessions behind ancient
ones). Confirmed via a second screenshot pass that the section now reads as a short, useful
list. New test case added to `app/api/oracle/soothsayer/__tests__/route.test.ts` asserting
the `orderBy`.

## Needs Reshi rework

- **Merge**: `NeedsReshi.tsx` now renders two columns — "Waiting on you" (the merged
  `waiting` queue, each `AskCard` carrying a small decision/reply chip via
  `needs-reshi-logic.ts`'s `buildWaitingColumn`) and "Review" (grouped). The old
  Decide/Answer/Review three-column layout, `buildAnswerColumn`, and
  `legacySessionToAskCardData` are gone — deleted, not deprecated-in-place, per the spec's
  "removed from the glass."
- **Legacy flag-only cards**: `oracle-logic.ts` gains `legacyNeedsAttentionArcIds` (arc ids
  with a linked legacy session — feeds the attention dot) and
  `unlinkedLegacyWaitingSessions` (the ones with no arc — feed the Fleet screen). Discovery:
  `WaitingStrip.tsx` already existed, fully built, and was completely unused — orphaned by
  the Phase 3c Seeing-Stone/Fleet split. It's the exact component this need already called
  for; wired it into `app/(app)/oracle/fleet/page.tsx` rather than building a new one.
- **Attention dot**: `TodayPickCard.tsx` renders a quiet warning-colored dot next to an
  arc-type pick's name when `legacyAttentionArcIds.has(pick.arc_id)` — threaded down from
  `app/(app)/oracle/page.tsx` (fleet data it already fetches) through `TodaySection.tsx` and
  `TodayBoard.tsx`'s board lens, and independently computed inside `Soothsayer.tsx` (which
  fetches fleet data itself, since it's a different page).
- **Review grouped**: `needs-reshi-logic.ts`'s `groupReviewByClient` — client name, falling
  back to arc name, falling back to "Other"; sorted oldest-wait-first across groups AND
  within a group (the group's `topItemTitle` is genuinely the longest-waiting item).
  `ReviewGroupCard.tsx` — collapsed by default, count + oldest-wait age (reusing
  `oracle-logic.ts`'s existing `commandAge` formatter) + the top item's title; expanding
  shows the individual items via the SAME `AskCard`/peek-drawer flow the old flat wall used.

## Meeting prep rule

`MEETING_PREP_MINUTES = 20` beside `MEETING_RECOVERY_MINUTES` in `time-shape-logic.ts`.
`computeMeetingPrepStart` truncates a meeting's leading prep window against whichever is
LATEST of (a) the previous meeting's own occupied end (its trailing buffer if it has one,
else its plain end) and (b) the day's start — mirroring the existing buffer's own
truncation-by-neighbor pattern exactly, so every ms is attributed to at most one block
(previous buffer, this prep, or open runway), never negative (clamped to the meeting's own
start). `layoutPrepBlocks` (visual, mirrors `layoutBufferBlocks`) and
`sumCommittedMinutesWithBuffer` (now folds prep into the aggregate, gained an optional
trailing `dayStartMs` param for the clamp) both updated; `TimeShape.tsx` renders prep blocks
and includes them in the focus-block occupied-space calc, so the change is visible on
Today's own time-shape, not just the Soothsayer's day-load line, per Mike's own framing
("the 20-minute meeting-prep rule enters the time-shape" — the existing artifact, not just
new UI). `/api/today/calendar`'s week aggregation and the new `/api/oracle/soothsayer`
route both pass their day's real start instant as `dayStartMs` for the clamp.

**Deviation (spec-directed, not a regression):** this intentionally changes
`sumCommittedMinutesWithBuffer`'s numeric output for every existing caller. Updated every
existing baseline assertion in `time-shape-logic.test.ts` (and one in
`today/calendar/__tests__/route.test.ts`) to the new, prep-inclusive expected numbers,
rather than leaving them broken — Mike's own ruling header names this exact behavior
change ("the 20-minute meeting-prep rule enters the time-shape").

## Arc board additions (coordinator, mid-build)

- **"+ Quest" quick-add** (`ArcBoard.tsx`'s new `QuickAddQuest`): a toggle button opening an
  inline title + optional-due-date form, `useCreateTask()` with `arc_id` set. New quest
  appears in the Not-started column with no reload — `useCreateTask`'s `onSuccess` now also
  invalidates `arcKeys.detail(data.arc_id)` when present.
- **Back-to-Seeing-Stone link**: a plain `<Link href="/oracle">` with a left arrow + "Seeing
  Stone" label, top of the arc board, theme tokens, visible at every breakpoint (no
  responsive hiding — it's a single small element, not a section that needs collapsing).

## Gates (all executed, exit codes recorded)

| Gate | Result |
|---|---|
| `npm run test:run` | **1784 tests / 150 files, exit 0** (baseline 1705/147 + 79 new/updated across `lib/__tests__/arc-snooze.test.ts` (11, new), `app/api/oracle/soothsayer/__tests__/route.test.ts` (13, new), plus updates to `time-shape-logic.test.ts`, `needs-reshi-logic.test.ts`, `AskCard.test.tsx`, `oracle-logic.test.ts`, `TodayPickCard.test.tsx`, `app/api/arcs/[id]/__tests__/route.test.ts`, `app/api/tasks/__tests__/route.test.ts`, `app/api/today/__tests__/route.test.ts`, `app/api/today/calendar/__tests__/route.test.ts`, `app/api/waiting-on-me/__tests__/route.test.ts`) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 — `/oracle/soothsayer` and every other route present in the route table |
| `npx playwright test` (full suite) | **29 passed / 0 failed, exit 0** — re-run 7 times total across this phase's build (3 failures found and fixed along the way, all real: a WIP-cap cross-file contention, a Select-label mismatch, and the density-cap deviation above); the final 3 consecutive full-suite runs after all fixes landed were all clean (29/29 every time) |

New e2e: `__tests__/e2e/oracle-phase5-soothsayer.spec.ts` (9 tests) — 7 day columns render;
unplanned section (arc + session rows); assign-to-day persists through reload (targets a
future day deliberately, not Today — see the WIP-cap deviation below); snooze hides an arc
from unplanned and shows it in the Snoozed row; merged "Waiting on you" renders a declared
ask with its type chip; Review groups by client and expanding reveals the item; the
attention dot renders on a linked arc's Today pick card; the arc board's back-link
navigates to `/oracle`; the arc board's "+ Quest" persists through reload.

Updated existing e2e (real regressions from this phase's OWN behavior change, fixed not
swept under the rug):
- `oracle-phase3.spec.ts` — the legacy-session assertion that used to target Needs Reshi's
  Answer column now asserts that column is GONE and the legacy card doesn't render there;
  the Respond-gating assertion for that same session (`demo-session-waiting-1`, unlinked —
  no `arc_id`) moved to the Fleet test, targeting the newly-wired `WaitingStrip`.
- `oracle-phase4b-peek.spec.ts` — its two Review-card tests now expand the (collapsed-by-
  default) "Other" group card before locating the fixture's `AskCard`, since Review no
  longer renders a flat wall.

## Deviations

1. **Migration checksum drift actually fixed, not just re-flagged** — see Migration
   section above.
2. **A real cross-file WIP-cap contention found and fixed, not swept under the rug.** This
   phase's seed fixtures (a permanent today-dated pick for the attention-linked arc) pushed
   the shared "today" bucket's uncompleted-pick count to the edge of the existing 5-pick
   WIP ceiling — a SEPARATE shared-resource class from Phase 4b's own documented auth-rate-
   limit contention, but the same root shape (one file's fixtures silently consuming a
   budget another file's test also needs). First full-suite run after adding my e2e file
   failed `oracle-phase4a-email.spec.ts`'s pre-existing due-soon "add to Today" test with a
   409. Root-caused and fixed by changing my own assign-to-day e2e test to target a future
   day instead of Today (a future day starts empty; it proves the identical
   assign-persists behavior without touching the constrained shared slot) — verified clean
   across 3 consecutive full-suite runs afterward.
3. **Unplanned-section density cap** — see its own section above; not a bug in the literal
   spec reading, but a real UX failure only visible against real (not fixture) data,
   found via the screenshot review step, fixed via the codebase's own existing binding
   density rule.
4. **Select-by-label flakiness fixed to select-by-value.** The assign-to-day e2e originally
   picked a day column by its VISIBLE label text (`selectOption({ label })`); Node's
   `toLocaleDateString` renders a comma ("Thu, 7/23") that didn't match on the first
   attempt in one run. Switched to `selectOption(dateString)` (matches the `<option>`'s
   `value`, which is the exact ISO date string the component already carries) — more
   robust and no less meaningful a test.
5. **`snoozed_until` added to `formatTodayPickResponse`'s arc summary unconditionally**
   (both `/api/today` and the new soothsayer route), not gated behind the same
   `withProgress` flag `progress_percent` uses — needed so an arc-type Today pick's own
   `SnoozeMenu` (now mounted on `TodayPickCard` itself, not just the Soothsayer) shows the
   correct current state. Confirmed zero blast radius via the registry + one updated exact-
   shape test assertion in `app/api/today/__tests__/route.test.ts`.

## Session-contract note for Bast (machine-side, post-deploy)

The spec asked specifically: now that decide-vs-answer no longer needs guessing (they're
merged into one "Waiting on you" queue with a `queue_type` chip preserving which one an item
came from), the machine-side session contract that tells a session which `ask_queue` to
declare should be re-examined. Concretely:

- The contract's guidance for CHOOSING `decide` vs `answer` when parking a `waiting_on` ask
  can likely be simplified or loosened — the UI no longer visually separates them into
  distinct columns a session author has to reason about placement within; it's now just a
  label on the SAME card. A session that's genuinely unsure between "this is a decision" and
  "this is a reply-shaped question" no longer needs to agonize over which queue changes its
  visibility or placement — only its chip text changes.
- `review` and `do` are UNCHANGED and still carry real placement weight (review = a
  genuinely different screen section now grouped by client; do = never surfaced in Needs
  Reshi at all, quests only) — the contract's guidance for those two should stay as strict
  as it is today.
- Recommend Bast update the contract text to something like: "decide vs answer is now
  cosmetic labeling only (a small chip), not a placement decision — pick whichever reads
  more naturally for the ask; when genuinely unsure, `decide` is the safe default since it
  sorts first in the merged queue." This removes a categorization burden from every session
  author without losing the chip's descriptive value.

## Commits

See `git log` on `feat/clarity-phase1-data-plane` — this spec + verification record
committed alongside the implementation, chunked per repo convention. No push.
