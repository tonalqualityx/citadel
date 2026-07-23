# Feature: Clarity Phase 6 — Email Lanes & Calendar Intents

Spec: `feature-planning/clarity-phase6-email-lanes.md`. Continues on
`feat/clarity-phase1-data-plane` in worktree `citadel-clarity-wt`; Phases 1–5 + 4c already
live. The intake drawer + `email_asks` came from Phases 4a/4b
(`feature-planning/clarity-phase4a-email-spots.md`, `IntakeDrawer.tsx`/`AskCard.tsx`).

## Overview

Adds a lane classification (general/meeting/sales) to `email_asks` plus an Add-to-Calendar
intent flow for meeting-lane asks with a high-confidence parsed date. The intake drawer's
header trigger becomes three quiet per-lane counts; the drawer body groups cards by lane
(Meeting, Sales, General order) instead of one flat list. Machine-side classifier and
calendar-executor cron work is explicitly out of scope (Bast's separate follow-up,
post-deploy) — this phase only builds the schema/API surface those crons will read/write
and the UI that reacts to it.

## Impact Analysis

**Codebase impact**: `EmailAsk` (`prisma/schema.prisma`) is read by
`app/api/oracle/email-sync/route.ts`, `app/api/email-asks/route.ts`,
`app/api/email-asks/[id]/route.ts`, `app/api/waiting-on-me/route.ts`,
`lib/api/formatters.ts`'s `formatEmailAskResponse`, `lib/hooks/use-waiting-on-me.ts`'s
`EmailAsk` type (consumed by `CrisisStrip.tsx`/`crisis-strip-logic.ts` and
`IntakeDrawer.tsx`/`intake-drawer-logic.ts`), `lib/hooks/use-email-asks.ts`'s
`UpdateEmailAskInput`. All additive — no existing field renamed/removed, so every current
caller keeps compiling and behaving unchanged as long as new fields are optional/defaulted.

**Test impact**: every fixture literal that types itself as `EmailAsk` (component tests in
`CrisisStrip.test.tsx`, `crisis-strip-logic.test.ts`, `IntakeDrawer.test.tsx`) needs the 6
new fields added to stay assignable. `waiting-on-me/__tests__/route.test.ts`'s one exact
`toEqual` on the empty-intake shape needs the new `lanes` key. The two other Oracle e2e
files that assert the trigger chip's exact text (`oracle-phase4a-email.spec.ts`,
`oracle-phase4b-peek.spec.ts`) need their regex loosened for the new three-lane format —
their own single fixture is general-lane, so the assertion becomes "the 📬 count is
present" rather than the literal old string.

## Files to Create

- [x] `prisma/migrations/20260723143908_clarity_phase6_email_intents/migration.sql` — guarded
      new enum + 6 additive columns
- [x] `scripts/seed-clarity-phase6-lane-fixtures.ts` — one email_ask per lane, meeting one
      carries a real high-confidence `proposed_event_at`
- [x] `__tests__/e2e/oracle-phase6-email-lanes.spec.ts` — chip/grouping/calendar-button e2e
- [x] `feature-planning/clarity-phase6-verification.md`

## Files to Modify

- [x] `prisma/schema.prisma` — `EmailAskIntent` enum + 6 new `EmailAsk` fields
- [x] `lib/api/formatters.ts` — `formatEmailAskResponse` passes through the 6 new fields
- [x] `app/api/oracle/email-sync/route.ts` — zod schema + conditional-spread upsert (absent
      = untouched, legacy-byte-compatible)
- [x] `app/api/email-asks/[id]/route.ts` — `calendar_requested` in the PATCH schema
- [x] `app/api/email-asks/route.ts` — `?calendar_requested=true` filter
- [x] `app/api/waiting-on-me/route.ts` — `intake.lanes` per-lane counts
- [x] `lib/hooks/use-waiting-on-me.ts` — `EmailAsk`/`WaitingOnMeResponse.intake` types
- [x] `lib/hooks/use-email-asks.ts` — `UpdateEmailAskInput.calendar_requested`
- [x] `lib/api/registry/oracle.ts`, `lib/api/registry/clarity.ts` — registry entries for
      every endpoint above
- [x] `components/domain/oracle/intake/intake-drawer-logic.ts` — lane derivation, chip
      formatting, drawer grouping, proposed-event formatting, calendar button state machine
- [x] `components/domain/oracle/intake/IntakeDrawer.tsx` — lane-grouped drawer, meeting
      event block + Add-to-calendar affordance, sales lead-flavored copy
- [x] Test fixture updates: `CrisisStrip.test.tsx`, `crisis-strip-logic.test.ts`,
      `IntakeDrawer.test.tsx`, `waiting-on-me/__tests__/route.test.ts`,
      `email-asks/__tests__/route.test.ts`, `email-asks/[id]/__tests__/route.test.ts`,
      `oracle/email-sync/__tests__/route.test.ts`
- [x] `__tests__/e2e/oracle-phase4a-email.spec.ts`, `__tests__/e2e/oracle-phase4b-peek.spec.ts`
      — loosened chip-text regex for the new three-lane format

## Implementation Steps

1. Additive migration: guarded `CREATE TYPE` (DO block, Postgres has no native
   `IF NOT EXISTS` for `CREATE TYPE`) + `IF NOT EXISTS` `ADD COLUMN`s.
2. `formatEmailAskResponse` + the 3 `email_asks`-touching routes + `/api/waiting-on-me`.
3. Client-side types (`use-waiting-on-me.ts`, `use-email-asks.ts`) + registry docs.
4. Pure lane/formatting/state-machine functions in `intake-drawer-logic.ts` (fully unit
   tested before touching the component).
5. `IntakeDrawer.tsx`: trigger chip, lane grouping, `MeetingEventBlock` sub-component, sales
   copy.
6. Update every broken existing test fixture/assertion (Impact Analysis list above).
7. New seed script + e2e spec + screenshots.

## Tests to Update (from Impact Analysis)

- [x] `components/domain/oracle/crisis/__tests__/CrisisStrip.test.tsx` — `ask()` fixture
      needs the 6 new `EmailAsk` fields (TS assignability, not a behavior change)
- [x] `components/domain/oracle/crisis/__tests__/crisis-strip-logic.test.ts` — same
- [x] `components/domain/oracle/intake/__tests__/IntakeDrawer.test.tsx` — `ask()` fixture +
      every `intake` prop literal needs `lanes`; trigger-chip assertion text changed
- [x] `app/api/waiting-on-me/__tests__/route.test.ts` — the one exact `intake` `toEqual`
      needs `lanes: {general:0,meeting:0,sales:0}`
- [x] `__tests__/e2e/oracle-phase4a-email.spec.ts` — chip regex loosened
- [x] `__tests__/e2e/oracle-phase4b-peek.spec.ts` — chip regex loosened

## Tests to Write

- [x] `intake-drawer-logic.test.ts`: `laneForAsk`, `intakeChipLine`, `groupAsksByLane`,
      `formatProposedEvent`, `calendarButtonState` (14 new tests)
- [x] `IntakeDrawer.test.tsx`: lane grouping, meeting event block + calendar button state
      transitions, sales-flavored copy (8 new tests)
- [x] `waiting-on-me/__tests__/route.test.ts`: per-lane count computation, null-intent =
      general (1 new test)
- [x] `email-asks/[id]/__tests__/route.test.ts`: `calendar_requested` set/reject/omit (3 new)
- [x] `email-asks/__tests__/route.test.ts`: `calendar_requested=true` filter + combos +
      invalid value + new-field response shape (4 new)
- [x] `oracle/email-sync/__tests__/route.test.ts`: accept new fields, reject invalid intent,
      legacy byte-compatibility, re-sync-omits-fields-untouched (4 new)
- [x] `__tests__/e2e/oracle-phase6-email-lanes.spec.ts`: 3 new e2e (desktop three-lane +
      screenshot, calendar-button-only-on-meeting + click-to-queued, mobile stacking +
      screenshot)

## Verification Checklist

- [x] Feature works as expected (verified live via Playwright screenshots)
- [x] TypeScript compiles without errors
- [x] Unit tests pass (1861/153, up from 1827/153)
- [x] No regressions in existing tests
- [x] Full Playwright suite green (36/0, up from 33/0)
- [x] Migration applied + guard proven idempotent (`prisma db execute` re-run clean)
