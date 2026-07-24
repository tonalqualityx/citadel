# Clarity Phase 6b — Admin Email Lane — Verification Record

Small, surgical addition to Phase 6 (email lanes & calendar intents). Mike's ruling
2026-07-24: business-critical non-client mail (accountant, bookkeeper, banking, tax) —
"if I don't take care of those emails I don't get paid" — gets its own intake lane,
`admin`, FIRST in both the trigger chip and the drawer grouping.

Plan: `app/implementation/plans/clarity-phase6b-admin-intent.md`. Continues on
`feat/clarity-phase1-data-plane` in worktree `citadel-clarity-wt`; Phases 1–6 (incl. the
calendar_event_id addendum) already live.

## Baseline

- `npm run test:run`: **1866 tests / 153 files, exit 0.**
- `npx playwright test`: **36 passed / 0 failed, exit 0.**

Both matched the spec's stated floor exactly — no drift since Phase 6's own final gate.

## Migration

`prisma/migrations/20260724131823_clarity_phase6b_admin_intent/` — a single additive
statement: `ALTER TYPE "EmailAskIntent" ADD VALUE IF NOT EXISTS 'admin';`. Unlike Phase
6's own `CREATE TYPE` (which needed a `DO $$ ... EXCEPTION WHEN duplicate_object` guard
because Postgres has no native `CREATE TYPE ... IF NOT EXISTS`), `ALTER TYPE ... ADD
VALUE IF NOT EXISTS` has been natively supported since Postgres 12, so no DO-block
wrapper was needed — the guarded pattern here is just the native `IF NOT EXISTS` clause.

The migration file deliberately contains ONLY the enum addition (no DML, no other DDL)
per the standing rule that Postgres cannot use a newly-added enum value inside the same
transaction that added it.

Applied via `prisma migrate dev --create-only --name clarity_phase6b_admin_intent`
(create-only, hand-edited for the `IF NOT EXISTS` guard + explanatory comments, then
applied via `prisma migrate dev`) — `prisma migrate status` was clean before and after.
**Idempotency proven**: re-ran the migration SQL directly via `npx prisma db execute
--file .../migration.sql` against the already-migrated database — "Script executed
successfully." Enum contents verified directly in Postgres:
`enum_range(NULL::"EmailAskIntent")` → `{general,meeting,sales,admin}`.

## Server-side additions

1. **`prisma/schema.prisma`** — `EmailAskIntent` enum gains `admin`; doc comments on the
   enum and on `EmailAsk.intent` updated to explain the new lane and its priority.
2. **`POST /api/oracle/email-sync`** — no code change needed: its Zod schema already
   validates `intent` via `z.nativeEnum(EmailAskIntent)`, which picked up `admin`
   automatically once the Prisma client was regenerated. Verified with a new test
   (`intent: 'admin'` accepted; an unrelated bogus value still rejected).
3. **`PATCH /api/email-asks/[id]`** — **no `intent` field exists on this endpoint's
   schema, and none was added.** `intent` has only ever been classifier-set via
   email-sync; this route never validated it. The spec's "PATCH schema accepts intent
   'admin'" is satisfied in the only sense that applies to this endpoint's actual design:
   added a regression test confirming PATCH (`state`, `calendar_requested`) continues to
   work correctly on a row whose `intent` is the new `'admin'` value — i.e. adding the
   enum value didn't regress this endpoint's unrelated behavior. Flagged explicitly under
   Deviations below.
4. **`GET /api/waiting-on-me`** — `intake.lanes` gains `admin` — its OWN count, computed
   from the same `intakeAsks` query, **never folded into `general`** (unlike null/absent
   intent, which is the only thing that counts as general).
5. Registry updated in `lib/api/registry/oracle.ts` (email-sync's intent enum list +
   responseNotes) and `lib/api/registry/clarity.ts` (waiting-on-me's responseNotes/
   responseExample, `/api/email-asks` GET's responseExample) — all `general|meeting|
   sales` value lists and `lanes` shape examples now include `admin`.

## UI (Seeing Stone)

- **Trigger chip** (`intake-drawer-logic.ts`) — `CHIP_ORDER` becomes
  `['admin', 'general', 'meeting', 'sales']` (admin FIRST, same "don't get paid" priority
  framing driving the drawer order — the original three kept their relative order from
  Phase 6's own literal spec text); `CHIP_EMOJI.admin = '🧾'`. Same exception-display rule:
  a zero-count admin lane renders nothing.
- **Drawer grouping** — `DRAWER_LANE_ORDER` becomes `['admin', 'meeting', 'sales',
  'general']`; `DRAWER_LANE_LABEL.admin = 'Admin'`.
- **Admin cards use the standard actions** — no code change needed in `IntakeDrawer.tsx`:
  its existing conditionals (`group.lane === 'sales' ? ... : 'Create'` for the
  Create/Create+open copy, `group.lane === 'meeting' && <MeetingEventBlock .../>` for the
  calendar affordance) already fall through to the plain "Create"/"Create + open" copy
  and render no meeting block for any lane that isn't literally `'sales'`/`'meeting'` —
  which now correctly covers `'admin'` too, verified by new unit + e2e assertions.
- `lib/hooks/use-waiting-on-me.ts` — `EmailAsk.intent` union and
  `WaitingOnMeResponse.intake.lanes` type both widened to include `admin`.

## Gates (all executed, exit codes recorded)

| Gate | Result |
|---|---|
| `npm run test:run` | **1876 tests / 153 files, exit 0** (baseline 1866 + 10 new) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `npx playwright test` (full suite) | **36 passed / 0 failed, exit 0** (same count as baseline — the three existing Phase 6 e2e tests were EXTENDED in place to four lanes, per the task's own instruction, not given new sibling tests) |

New/updated unit tests (10 total): `intake-drawer-logic.test.ts` (+2: `laneForAsk`
passes through `admin`; `intakeChipLine` renders admin first), `IntakeDrawer.test.tsx`
(+3: chip includes admin count first, drawer groups Admin first, admin card uses
standard actions with no lead-flavored copy and no meeting block — plus every
pre-existing inline `lanes: {...}` literal in this file updated with `admin: 0`/`admin: N`
now that `LaneCounts` requires it), `waiting-on-me` route test (+1: admin lane counted
correctly, never folded into general), `email-sync` route test (+2: accepts
`intent: 'admin'`; still rejects an unrelated bogus value), `email-asks/[id]` route test
(+2: PATCH regression — state change and `calendar_requested` both still work correctly
on an admin-intent row).

e2e: `__tests__/e2e/oracle-phase6-email-lanes.spec.ts` extended in place (fixtures from
`scripts/seed-clarity-phase6-lane-fixtures.ts`, which gained a 4th admin-lane fixture,
message_id `e2e-clarity-phase6-fixture-admin`): trigger chip now asserts `🧾 1` alongside
the original three counts; drawer heading order asserted as `['Admin', 'Meeting', 'Sales',
'General']`; admin card asserted to use plain Create/Create+open (not lead-flavored) and
to render no `meeting-event-block`; the Add-to-calendar test additionally asserts the
admin card shows no calendar affordance; the mobile stacking test additionally asserts
the admin lane sits above the meeting lane (first in DOM order) with no horizontal
overflow.

Screenshots (renamed from `-three-lanes` to `-four-lanes` since the fixture set — and
therefore every future capture — now always includes the admin lane; the stale
`-three-lanes.png` files were deleted rather than left alongside contradictory new ones):
`app/test-results/clarity-phase6/desktop-1280-oracle-intake-four-lanes.png`,
`app/test-results/clarity-phase6/mobile-390-oracle-intake-four-lanes.png` — both visually
confirmed: Admin/Meeting/Sales/General headers in that order, admin card using plain
"Create"/"Create + open" (no lead-flavored copy, no meeting block), meeting card's
prominent parsed time + Add to calendar button unaffected, sales card's lead-flavored
copy unaffected, no horizontal overflow on mobile.

## Deviations

1. **No PATCH schema change** — see "Server-side additions" #3 above. The task's phrasing
   ("PATCH /api/email-asks/[id] schemas accept intent 'admin'") doesn't map onto this
   endpoint's actual design (intent has never been PATCH-settable, only classifier-set via
   email-sync); interpreted as "PATCH must keep working correctly on admin-intent rows"
   and covered with a regression test rather than inventing a new PATCH field nothing else
   in the spec calls for.
2. **Chip order for `admin` (FIRST) is a judgment call, not literal spec text** — the task
   explicitly specifies admin-first only for the drawer ("drawer lane order becomes
   Admin, Meeting, Sales, General — admin FIRST"); the chip's fourth-count position wasn't
   dictated. Applied the same "don't get paid" priority reasoning to the chip for
   consistency (admin is the lane Mike least wants buried), flagged here per the
   "no surprises" rule — easily reordered if Mike prefers a different chip position.
3. **Screenshot filenames renamed `-three-lanes` → `-four-lanes`, stale files deleted** —
   not explicitly requested (the task said "regenerate the drawer screenshots"), but
   keeping a file literally named "three-lanes" that now always depicts four lanes would
   be misleading; old files removed rather than left as stale, contradictory artifacts.

## Commits

See `git log` on `feat/clarity-phase1-data-plane` — this spec's plan + verification
record committed alongside the implementation, chunked per repo convention (db → api →
oracle-ui → test/e2e → docs). No push.
