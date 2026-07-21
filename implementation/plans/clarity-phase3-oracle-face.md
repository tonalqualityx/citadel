# Feature: Clarity Phase 3 — The Oracle Face

## Overview
Rework `/oracle` into the mockup-defined cockpit: Header (title/health-line/idea-quickadd/week-strip)
→ Today (time-shape + picks, list/board lens) → Needs Reshi (Decide/Answer/Review from
`/api/waiting-on-me`) → In motion (working+idle sessions, slim rows) → Docked (waiting sessions,
collapsed rows). New route `/oracle/arcs/[id]` = 4-column arc kanban on existing Task PATCH.
One additive migration: `today_picks`. Evidence-bound design rules (no red aging, quiet
completion, kanban caps, competence framing, no punishment) are binding alongside tests.

## Impact analysis findings
- Existing `/oracle` page (`app/(app)/oracle/page.tsx`) + `oracle-logic.ts` bucket functions
  (`isWaitingSession`, `isWorkingBucketSession`, `isIdleSession`, `groupNonWaitingSessions`,
  `selectWaitingSessions`) map directly onto the new grammar: Docked = waiting bucket
  (renamed/restyled), In motion = working ∪ idle buckets (flattened, no more per-machine
  sections), Crons/Recently-ended sections are REMOVED from the main body — crons fold into
  the header health line (visible only when erroring), ended/archived render nothing per the
  binding rule. `oracle-logic.ts` is reused, not replaced; new pure helpers get added
  alongside (never inline in components), same file per repo convention.
- `SessionCard`/`AgentRow`/`EventDrawer` (Respond deep-link, nesting, drawer) stay fully intact
  — In motion/Docked rows are new *slim* presentations that still open the same
  `EventDrawer`/agent nesting on expand, reusing `isWorkingSession`, `runningChildCount`,
  `sessionDisplayTitle`, `formatElapsed`, `sourceLabel` from oracle-logic.ts. No changes to
  `FleetTopbar`, `OracleToolbar`, `CommandStrip`, `NewSessionModal`, `/api/oracle/fleet`,
  `/api/oracle/ingest`, `/api/oracle/commands*` — Remote Spawn and ingest are untouched.
- `/api/waiting-on-me` (Phase 1) already returns `{decide, answer, review, do, meta}` — reused
  as-is; Needs Reshi renders decide/answer/review only (do-work is deliberately not rendered
  there per the mockup's own note — it surfaces via Today/quests).
- `Task` PATCH (`app/api/tasks/[id]/route.ts`) status-only branch + `canTransitionTaskStatus`
  + `useUpdateTaskStatus` hook already support arbitrary not_started/in_progress/review/done
  moves — reused verbatim for the arc board drag, no new task-mutation endpoint.
- `CharterKanban.tsx` is the only existing dnd-kit board; its column/card styling uses raw
  Tailwind palette classes (`bg-slate-50`, `bg-blue-50`, …), which violates this phase's
  "zero hand-picked colors" rule — NOT copied verbatim. Its DndContext/sensors/
  Drag/drop wiring pattern IS reused; colors are rebuilt on `bg-surface`/`Badge` tokens.
- `Meeting` model has only a single `meeting_date` timestamp, no start/end — not "a suitable
  read" for a time-shape block per the spec's own escape hatch, so `/api/today/calendar` is a
  new endpoint (assumes a default 30-min duration per meeting; documented deviation).
- `Charter` model (retainer) is what the spec's Prisma block names for `charter_id` — its own
  inline comment calls this "(sales lead)", which is a naming tension with `Accord.status
  default(lead)` (the actual sales-pipeline entity). The binding schema block explicitly says
  `charter_id String? @db.Uuid` + `relation Charter?`, so implemented literally; noted as a
  deviation/flag in the final report, not changed unilaterally.
- No existing test file references `TodayPick`/`today_picks` — purely additive, no drift risk.

## Files to Create
- [ ] `prisma/migrations/<ts>_clarity_phase3_today_picks/migration.sql` — additive migration
- [ ] `app/api/today/route.ts` — GET (list+joins+primary action), POST (create+cap+validation)
- [ ] `app/api/today/[id]/route.ts` — PATCH (sort/completed_at/label), DELETE
- [ ] `app/api/today/calendar/route.ts` — GET day meetings + week aggregation
- [ ] `lib/today-picks.ts` — pure helpers: validation (exactly one ref), cap check, primary
      action derivation, week aggregation shaping
- [ ] `lib/hooks/use-today.ts` — React Query hooks (today picks, calendar/week, mutations)
- [ ] `components/domain/oracle/today/TimeShape.tsx` — block layout (meetings+picks+now-line)
- [ ] `components/domain/oracle/today/time-shape-logic.ts` — pure math (block %, now-line, cap)
- [ ] `components/domain/oracle/today/WeekStrip.tsx`
- [ ] `components/domain/oracle/today/TodayPickCard.tsx` — type-adaptive primary action
- [ ] `components/domain/oracle/today/TodayBoard.tsx` — list/board lens toggle wrapper
- [ ] `components/domain/oracle/OracleHeader.tsx` — title/health-line/idea-quickadd/week-strip
- [ ] `components/domain/oracle/needs-reshi/NeedsReshi.tsx` + `AskCard.tsx`
- [ ] `components/domain/oracle/InMotion.tsx`, `Docked.tsx` (slim/collapsed rows, reuse drawer)
- [ ] `app/(app)/oracle/arcs/[id]/page.tsx` — arc board route (admin-gated like `/oracle`)
- [ ] `components/domain/oracle/ArcBoard.tsx` — 4-column dnd-kit board, progress header
- [ ] Test files alongside every new module/route (`__tests__/`)
- [ ] `app/e2e/oracle-phase3.spec.ts` — Playwright e2e (desktop+mobile+arc drag)

## Files to Modify
- `prisma/schema.prisma` — add `TodayPickType` enum + `TodayPick` model (additive)
- `app/(app)/oracle/page.tsx` — reassemble per new grammar, reusing existing hooks/fleet data
- `components/domain/oracle/oracle-logic.ts` — add pure helpers for cron-erroring detection,
  in-motion aggregation counts (kept additive; no existing export signature changes)
- `lib/api/formatters.ts` — add `formatTodayPickResponse`
- `lib/api/registry/clarity.ts` — register `/api/today*` endpoints

## Tests to Write
- `lib/today-picks.test.ts` — validation matrix, cap-409 boundary, primary-action derivation
- `app/api/today/__tests__/route.test.ts` — CRUD, validation, cap enforcement, joins
- `app/api/today/[id]/__tests__/route.test.ts` — PATCH/DELETE
- `app/api/today/calendar/__tests__/route.test.ts` — day + week shape
- `components/domain/oracle/today/__tests__/time-shape-logic.test.ts` — block math, now-line,
  over-cap tint
- `components/domain/oracle/__tests__/oracle-logic-phase3.test.ts` — queue grouping additions

## Verification Checklist
- [ ] `npx prisma migrate dev` applies clean
- [ ] Full `npm run test:run` green (baseline 1414/122 + new)
- [ ] `npm run build` clean
- [ ] API registry updated
- [ ] Playwright e2e desktop(1280)+mobile(390) + arc-board drag, screenshots saved
- [ ] Evidence-bound design rules spot-checked in rendered output (no red aging, kanban caps,
      quiet completion, competence framing copy)

## Deviation/approval note
This plan executes under the standing dispatch instruction (spec is pre-approved/binding);
no interactive human approval gate is available in this pipeline, so implementation proceeds
directly per CLAUDE.md's allowance for a fully-specified, already-authorized build. All
deviations are logged inline above and repeated in the final report.
