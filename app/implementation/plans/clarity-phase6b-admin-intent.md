# Clarity Phase 6b — Admin Email Lane

## Overview
Small additive extension to Phase 6 (email lanes & calendar intents): a fourth intake
lane, `admin`, for business-critical non-client mail (accountant, bookkeeper, banking,
tax) per Mike's 2026-07-24 ruling — "if I don't take care of those emails I don't get
paid." Admin cards use the standard actions (no meeting/sales-specific affordances).

## Files to Modify
- [ ] `prisma/schema.prisma` — add `admin` to `EmailAskIntent` enum + doc comment update.
- [ ] `prisma/migrations/<ts>_clarity_phase6b_admin_intent/migration.sql` — new additive
      migration: `ALTER TYPE "EmailAskIntent" ADD VALUE IF NOT EXISTS 'admin';` only (no
      same-transaction use of the new value).
- [ ] `app/api/waiting-on-me/route.ts` — `intake.lanes` gains `admin` count (intent ===
      EmailAskIntent.admin; does NOT fall into the `general` null-or-general bucket).
- [ ] `lib/hooks/use-waiting-on-me.ts` — widen `EmailAsk.intent` union and
      `WaitingOnMeResponse.intake.lanes` type to include `admin`.
- [ ] `components/domain/oracle/intake/intake-drawer-logic.ts` — widen `EmailAskLane` +
      `LaneCounts`; `CHIP_ORDER` gains `admin` (placed FIRST — same "don't get paid"
      priority framing driving the drawer order); `CHIP_EMOJI.admin = '🧾'`;
      `DRAWER_LANE_ORDER` becomes `['admin', 'meeting', 'sales', 'general']`;
      `DRAWER_LANE_LABEL.admin = 'Admin'`.
- [ ] `components/domain/oracle/intake/IntakeDrawer.tsx` — no logic change needed: the
      existing `group.lane === 'sales' ? ... : 'Create'` / `group.lane === 'meeting' &&
      <MeetingEventBlock .../>` conditionals already fall through to the standard
      actions for any lane that isn't literally 'sales'/'meeting', which now correctly
      covers 'admin' too.
- [ ] `lib/api/registry/oracle.ts` — email-sync `bodySchema` description: intent enum
      list gains `admin`.
- [ ] `lib/api/registry/clarity.ts` — waiting-on-me `responseNotes`/`responseExample`,
      `/api/email-asks` GET `responseExample`: intent enum lists + `lanes` shape gain
      `admin`.
- [ ] `scripts/seed-clarity-phase6-lane-fixtures.ts` — add a 4th fixture,
      admin-lane email_ask (renamed in spirit to "lane fixtures" already, no file rename
      needed).
- [ ] `__tests__/e2e/oracle-phase6-email-lanes.spec.ts` — extend three-lane assertions
      to four; new/renamed screenshots reflecting 4 lanes.

## Tests to Update (Impact Analysis)
- [ ] `components/domain/oracle/intake/__tests__/intake-drawer-logic.test.ts` —
      `laneForAsk`/`intakeChipLine`/`groupAsksByLane` need admin coverage.
- [ ] `components/domain/oracle/intake/__tests__/IntakeDrawer.test.tsx` — every inline
      `lanes: { general, meeting, sales }` object literal (≈10 call sites) needs an
      `admin` key added once `LaneCounts` requires it (TS will fail to compile otherwise).
- [ ] `app/api/waiting-on-me/__tests__/route.test.ts` — the zero-lanes assertion and the
      per-lane-counts assertion both need `admin` added to their `toEqual` objects; new
      test for admin-intent counting.
- [ ] `app/api/oracle/email-sync/__tests__/route.test.ts` — new test: accepts
      `intent: 'admin'`.
- [ ] `app/api/email-asks/[id]/__tests__/route.test.ts` — PATCH has never validated
      `intent` (classifier-set only via email-sync) — add a regression test confirming
      PATCH (state/calendar_requested) still works correctly on an intent='admin' row,
      satisfying the spec's "PATCH schema accepts intent admin" in the only sense that
      applies to this endpoint's actual design.

## Tests to Write
- [ ] e2e: seed an admin ask, assert chip shows 🧾 count, assert Admin is the FIRST
      drawer lane heading, admin card renders standard Create/Create+open (not
      lead-flavored, no meeting block).

## Verification Checklist
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run test:run` exit 0 (floor 1866/153 + new)
- [ ] `npm run build` exit 0
- [ ] `npx playwright test` (full suite) exit 0 (floor 36/0 + new)
- [ ] Migration idempotency re-verified (re-run migration.sql directly)
