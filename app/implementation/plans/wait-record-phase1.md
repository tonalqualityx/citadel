# Feature: Wait record, phase 1 (wait model, sweeper, ritual blocks)

Source: `~/Documents/indelible-ops/specs/citadel-shape-SPEC.md` sections 2, 4.2, 4.3 and 5 (phase 1). Branch `citadel/wait-record`, cut from `portal/a2-login` so its migration sorts after the portal A1/A3/A2 migrations. Built overnight 2026-10-21 (W13).

## Overview
One model, `Wait`, holds every handoff and every clock. A sweeper fires due waits every 15 minutes; Work mode gets three blocks (Blocking today, Due this week, Admin); the ritual reads the same blocks from `GET /api/waits/mine`. **Phase 1 sends nothing to a client.** Every template that sends is registered but disabled, and the sweeper refuses to fire a disabled template. The only machine-side effect is one in-app/Slack notification to Mike, three business days after a client-blocking wait on him is late (`WAIT_SLACK_NAG`, on by default, `off` to silence).

## Files to Create
- [x] `prisma/schema.prisma`: `Wait`, `WaitEvent`, four enums, back-relations. `prisma/migrations/20261021040000_wait_record/migration.sql`: additive only (creates two tables, indexes, foreign keys; alters nothing).
- [x] `lib/waits/business-days.ts`: Mon to Fri in America/New_York, due 17:00, DST-safe, send window.
- [x] `lib/waits/owner.ts`: stand-in, escalation target, person, role holder (project, charter, client team), accord owner, Mike.
- [x] `lib/waits/templates.ts`: the 29 clocks from spec 2.9 as data, plus `handoff.generic`. Six live, 24 registered disabled.
- [x] `lib/waits/sweeper.ts`, `prisma-store.ts`: the pass, against a `SweepStore` so it is unit-tested in memory.
- [x] `lib/waits/actions.ts`, `events.ts`: pause, resume, extend (two extensions or 15 business days), redate, reassign, stand-in, and the W6 placement events (`place`, `stop`, `extend`, `needs_human`).
- [x] `lib/waits/ritual-blocks.ts`, `load-blocks.ts`: selection, sort, caps, counts; the loader.
- [x] `lib/oracle/admin-soon.ts`: the admin-soon filter moved out of its route so `waits/mine` reads the same list.
- [x] `app/api/waits/{route,[id]/route,sweep/route,mine/route,events/route}.ts`
- [x] `lib/api/registry/waits.ts` (+ `index.ts`), `lib/hooks/use-waits.ts`, `lib/config/feature-flags.ts` (`ORACLE_WAIT_BLOCKS`, `ORACLE_WORK_DOORS`)
- [x] `components/domain/oracle/modes/work/{BlockingToday,DueThisWeek,AdminBlock}.tsx`; `modes/WorkView.tsx`
- [x] `__tests__/e2e/oracle-wait-blocks.spec.ts`, `scripts/seed-wait-blocks-fixtures.ts`; `oracle-phase8-composition.spec.ts` updated for the hidden doors.

## Defaults picked where the spec left a MIKE item
- Silence counts as acceptance **on** for pre-launch reviews and marketing plans (`review_clock_on`), **off** for live-site changes (`silent_acceptance_live`). The per-client columns land in phase 3; until then `GUARD_DEFAULTS` in `templates.ts` apply to every client, and every template that reads them is disabled anyway.
- Hosting is a charter kind `hosting` (phase 3). Stand-in map: WordPress to Sabeen, content to Nils, admin to Angela (phase 3 `StandIn` rows; phase 1 only carries `stand_in_user_id` on the wait).
- Escalate ladder interval: one business day per rung (role holder digest, PM, Mike).

## Tests
Unit: `lib/waits/*.test.ts`, `app/api/waits/**/__tests__`, `lib/api/registry/__tests__`, `components/domain/oracle/modes/**/__tests__`. E2E (needs the seeded dev DB): `oracle-wait-blocks.spec.ts`, `oracle-phase8-composition.spec.ts`.

## Verification checklist
- [x] `npx tsc --noEmit`, `npx prisma validate`, migration applies from zero and `migrate diff` reports no drift
- [x] `npx vitest run lib/waits app/api/waits lib/api/__tests__ components/domain/oracle`
- [x] `npx next build`
- [ ] Playwright e2e (needs a live seeded database)
- [ ] Opus adversarial review of the claim and the ladders
