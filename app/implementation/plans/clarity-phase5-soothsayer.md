# Feature: Clarity Phase 5 — The Soothsayer + Needs Reshi rework

Spec: `feature-planning/clarity-phase5-soothsayer.md`. Continues on
`feat/clarity-phase1-data-plane` in worktree `citadel-clarity-wt`, phases 1-4b already live.

## Overview

1. Schema: `Arc.snoozed_until` (additive migration `clarity_phase5_arc_snooze`), PATCH
   `/api/arcs/[id]` accepts it.
2. Verify `POST /api/today` already accepts future dates (it does — `parseDateParam` takes
   whatever date string is given, WIP cap is scoped `where: { date: targetDate }` already
   per-day). No fix needed; add a regression test proving it.
3. New page `/oracle/soothsayer` — day columns (today+6), "No day assigned" section,
   "Snoozed" collapsed row. New consolidated GET `/api/oracle/soothsayer` endpoint (dumb
   data, admin-gated) backing it, reusing the existing today-picks shaping logic (extracted
   to a shared lib so `/api/today` and the new route never drift) and the existing
   `/api/today/calendar` route extended with an optional `days` param (default 5, unchanged
   for the existing Today header; Soothsayer requests `days=7`).
4. Needs Reshi rework: merge decide+answer into one `waiting` array (with back-compat
   decide/answer kept one release) in `/api/waiting-on-me`; remove legacy flag-only cards
   from Needs Reshi entirely; linked-to-arc legacy sessions become an attention dot on the
   arc's card (Today + Soothsayer); unlinked ones move to the Fleet screen via the existing,
   currently-unused `WaitingStrip` component (built in an earlier phase, orphaned by the
   Phase 3c fleet/seeing-stone split — exactly fits this need). Review column becomes
   grouped-by-client cards.
5. `MEETING_PREP_MINUTES = 20` added to `time-shape-logic.ts` beside
   `MEETING_RECOVERY_MINUTES`; every timed meeting's committed-load and visual layout gets a
   prep block before it, mutually truncated against the previous meeting's buffer/end (never
   double-counted, never negative, clamped to day start). This is a deliberate,
   spec-directed behavior change to `sumCommittedMinutesWithBuffer`'s numeric output —
   existing baseline unit tests in `time-shape-logic.test.ts` get their expected numbers
   updated to include prep (documented in "Tests to Update" below), not left broken.

## Files to Create

- [ ] `prisma/migrations/<ts>_clarity_phase5_arc_snooze/migration.sql` — `Arc.snoozed_until`
- [ ] `lib/arc-snooze.ts` — pure `computeSnoozeUntil`/`isArcSnoozed` helpers
- [ ] `lib/services/today-picks-shape.ts` — extracted `fetchTodayPicksForDate`/`shapeTodayPicks`
      shared by `/api/today` and the new soothsayer route
- [ ] `app/api/oracle/soothsayer/route.ts` — GET, admin-gated
- [ ] `app/(app)/oracle/soothsayer/page.tsx` — the new page
- [ ] `components/domain/oracle/soothsayer/Soothsayer.tsx` + `DayColumn.tsx` +
      `UnplannedSection.tsx` + `SnoozedRow.tsx` + `soothsayer-logic.ts` (pure helpers)
- [ ] `components/domain/oracle/needs-reshi/ReviewGroupCard.tsx` + logic additions in
      `needs-reshi-logic.ts` (grouping by client/arc/Other, oldest-wait sort)
- [ ] `lib/hooks/use-soothsayer.ts`
- [ ] `scripts/seed-clarity-phase5-fixtures.ts`
- [ ] `__tests__/e2e/oracle-phase5-soothsayer.spec.ts`

## Files to Modify

- `prisma/schema.prisma` — `Arc.snoozed_until DateTime?`
- `app/api/arcs/[id]/route.ts` — PATCH accepts `snoozed_until` (set/null)
- `app/api/arcs/route.ts` — list response carries `snoozed_until`; default surfaces exclude
  snoozed arcs unless explicitly requested
- `lib/api/formatters.ts` — `formatArcResponse` carries `snoozed_until`;
  `formatTodayPickResponse`'s `arcSummary` extra gains optional `progress_percent`
- `lib/hooks/use-arcs.ts` — `snoozed_until` field + `useSnoozeArc` mutation
- `app/api/today/route.ts` — use extracted shared shaping lib (behavior-identical refactor)
- `app/api/today/calendar/route.ts` — optional `days` query param (default 5)
- `components/domain/oracle/today/time-shape-logic.ts` — `MEETING_PREP_MINUTES`,
  `computeMeetingPrepStart`, `layoutPrepBlocks`; `sumCommittedMinutesWithBuffer` gains prep
- `components/domain/oracle/today/TimeShape.tsx` — renders prep blocks, includes them in the
  focus-block occupied-space calc
- `components/domain/oracle/today/TodayPickCard.tsx` — attention dot on arc-type picks when
  a linked legacy session is waiting
- `app/api/waiting-on-me/route.ts` — merged `waiting: []`, keep `decide`/`answer` back-compat
- `lib/hooks/use-waiting-on-me.ts` — `waiting` field on the response type
- `components/domain/oracle/needs-reshi/NeedsReshi.tsx` — one "Waiting on you" queue + type
  chip; grouped Review; drop legacy-session rendering entirely
- `components/domain/oracle/needs-reshi/needs-reshi-logic.ts` — waiting-queue adapter (type
  chip decision/reply), review-grouping adapter
- `components/domain/oracle/needs-reshi/AskCard.tsx` — type chip rendering
- `components/domain/oracle/oracle-logic.ts` — `legacyNeedsAttentionArcIds`,
  `unlinkedLegacyWaitingSessions`
- `app/(app)/oracle/page.tsx` — pass fleet machines down for the arc attention-dot lookup;
  stop passing `legacyWaitingSessions` into `NeedsReshi`
- `app/(app)/oracle/fleet/page.tsx` — render `WaitingStrip` (existing, currently-unused
  component) for unlinked legacy-waiting sessions
- `lib/api/registry/clarity.ts` — arcs PATCH `snoozed_until`, new soothsayer endpoint entry,
  `/api/today/calendar`'s `days` param, `/api/waiting-on-me`'s `waiting` field
- `components/layout/Sidebar.tsx` / `MobileNav.tsx` — Soothsayer nav item (🌙) under Oracle

## Tests to Update (from Impact Analysis)

- `components/domain/oracle/today/__tests__/time-shape-logic.test.ts` — every
  `sumCommittedMinutesWithBuffer` assertion's expected number changes (prep now included);
  new describe blocks for `computeMeetingPrepStart`/`layoutPrepBlocks`
- `components/domain/oracle/needs-reshi/__tests__/needs-reshi-logic.test.ts` —
  `buildAnswerColumn`/legacy-session adapters removed or repurposed; new waiting-queue and
  review-grouping cases
- `components/domain/oracle/needs-reshi/__tests__/AskCard.test.tsx` — type chip assertions
- `app/api/arcs/[id]/__tests__/route.test.ts` — `snoozed_until` set/null/untouched
- `app/api/today/__tests__/route.test.ts` — future-date acceptance regression case
- `app/api/today/calendar/__tests__/route.test.ts` — `days` param cases
- `app/api/waiting-on-me/__tests__/route.test.ts` (new file if none exists — confirm) —
  merged `waiting` shape, back-compat `decide`/`answer`
- `app/(app)/oracle/__tests__` or equivalent — any snapshot-ish assertions on NeedsReshi
  props shape

## Tests to Write

- `lib/__tests__/arc-snooze.test.ts`
- `lib/services/__tests__/today-picks-shape.test.ts` (if pure-testable) or covered via route tests
- `components/domain/oracle/today/__tests__/time-shape-logic.test.ts` new cases: normal,
  back-to-back, meeting-at-day-start (clamped), overlapping meetings
- `app/api/oracle/soothsayer/__tests__/route.test.ts`
- `components/domain/oracle/soothsayer/__tests__/soothsayer-logic.test.ts`
- `components/domain/oracle/needs-reshi/__tests__/needs-reshi-logic.test.ts` additions
- `components/domain/oracle/oracle-logic.test.ts` additions (`legacyNeedsAttentionArcIds`,
  `unlinkedLegacyWaitingSessions`)
- New e2e: `__tests__/e2e/oracle-phase5-soothsayer.spec.ts` — 7 columns render, unplanned
  section, assign-to-day persists, snooze hides an arc from unplanned, merged waiting-on-you
  renders, review groups expand, attention dot on a linked waiting session

## Verification Checklist

- [ ] Migration applied, `prisma migrate status` clean
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run test:run` exit 0, counts recorded vs baseline
- [ ] `npm run build` exit 0
- [ ] `npx playwright test` (full suite) exit 0, counts recorded vs baseline
- [ ] Screenshots captured (soothsayer desktop/mobile, seeing-stone post-rework desktop)
- [ ] Registry updated
- [ ] Commits chunked, no push

## Note on delegation

Given the interconnected nature of this change (one shared time-shape-logic file, one
shared today-picks shaping helper, one fleet-data prop threaded through three screens), this
plan is implemented directly by the main agent rather than fanned out to blind sub-agents —
re-establishing this much cross-file context in each sub-agent would cost more than it saves.
Narrow, well-isolated chunks (e.g., the seed script, the e2e spec) are still reasonable
fan-out candidates once the core logic lands, and are used where it helps.
