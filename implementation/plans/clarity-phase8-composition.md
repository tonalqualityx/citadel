# Feature: Clarity Phase 8 (composition) — Seeing Stone three-mode rebuild

## Overview
Rebuild the oracle front page (`app/(app)/oracle/page.tsx`) onto a three-mode composition
(Work/Plan/Process) per `~/.claude/tools/oracle/clarity/SEEING-STONE-RECKONING.md`
("THE ANSWERED SPEC", DAY-REALITY ADDENDUM, MODE-ESCORT LAW) and the approved wireframe at
`/tmp/claude-1001/.../scratchpad/wireframe/seeing-stone-wireframe.html`, with the mode tabs
demoted to whisper-weight per the escort law. Plus: ritual-gate Quick-start door, a
`promised_to` discriminator on Task, and clickable calendar-event context popovers.

Full build plan (file-by-file, migrations, API contracts, component tree, reason-chip rules,
test plan, commit plan, and flagged deviations) produced by an Opus planning pass and reviewed
by the orchestrator: `/tmp/claude-1001/-home-mike/0e75e9c4-ed63-47a1-83e4-97de6800c73e/scratchpad/phase8-plan.md`.
This file is the pointer + the running checklist; that file is the source of truth for exact
shapes.

## Impact analysis (done during planning)
- `NowStrip.tsx` / `now-strip-logic.ts`: only consumer is `TodaySection.tsx` — safe delete,
  logic absorbed into `modes/work/hero-logic.ts` + `lib/reason-chips.ts`.
- `TodayPickCard.tsx`: consumed by `TodayBoard`, `TodaySection`, `NowStrip` (deleted),
  `soothsayer/DayColumn` — prop changes (`todayDateStr`, `showReasonChip`, `variant`) ripple
  to all three remaining call sites, updated in place.
- `ArcBoard.tsx`, `CrisisStrip.tsx`, `CronHealthLine.tsx` are imported by other pages
  (arc workspace, focus mode, fleet page respectively) — export shapes preserved, only mount
  points move.
- `use-waiting-on-me.ts` type is missing `intake`/`crisis` in `meta.counts` though the route
  has returned them since Phase 7 — pre-existing drift, fixed here since Work's doors read it.
- Test files needing updates enumerated in the full plan §G (rewritten/new/untouched lists).

## Files to Create / Modify
See full plan §A (dependency-ordered file list), §B (2-3 migrations), §C (API contracts),
§D (mode-shell architecture), §E (reason-chip rules), §F (calendar popover + calendar-sync.py).

## Implementation Steps (= commit plan, full plan §H)
1. `promised_to` — the promised/target discriminator, end to end (API)
2. Task creation requires promised-or-target (the two real forms only)
3. One honest reason chip, one source of truth (+ delete NowStrip)
4. Calendar event context — migration + sync contract
5. Clickable meetings — the calendar context popover
6. The three-mode shell (ModeShell/ModeTabs/PlanView + page.tsx rewrite)
7. Work mode — signals rail, clock strip, picks hero, four doors
8. Process mode — one card at a time (+ GET /api/oracle/admin-soon)
9. The gate's third door — Quick-start (+ RitualRun.quickstart_at)
10. E2E coverage + seed fixtures for the visual gate
(calendar-sync.py machine-side edit: after commit 4, not a repo commit)

## Tests to Update / Write
Full plan §G — deleted/rewritten/new/untouched lists per file.

## Deviations ruled by the orchestrator (adopting the plan's recommendations, full plan §I)
1. Add migration B3 (`RitualRun.quickstart_at`) — 3 migrations total, not 2.
2. Ship 3 mode tabs (Work/Plan/Process); Gate is not a 4th tab — it's `RitualGate`'s own cover.
3. `promised_to` required client-side in the two task forms only; API stays permissive
   (protects the completion-nudge draft path, intake create+open, session-task creation).
4. Process door "next sweep" copy is NOT fabricated — no sweep-schedule model exists; door
   shows truthful counts (`N auto-archived today` / `oldest Nd`) instead.
5. Plan-mode ledger stays NeedsReshi's existing 2 columns (Waiting / Review) + PipelineLane —
   the wireframe's 3rd "Tracked threads" column needs a new `next_touch`-ordered arcs endpoint,
   out of scope this phase.
6. Calendar descriptions render as plain text + regex-linkified URLs only — never
   `dangerouslySetInnerHTML` (attacker-controlled HTML from external organizers).
7. Wireframe's intake "Lead" button calls the existing `create-task` endpoint (produces
   sales-lane copy already); no new Accord-creation endpoint this phase.

## Verification Checklist
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run build` exit 0
- [ ] `npm run test:run` exit 0
- [ ] `npx playwright test` exit 0
- [ ] `npm run lint` — zero net-new warnings vs 705 baseline
- [ ] Screenshots captured per commit-9/10 seed data: work.png, work-event-popover.png,
      plan.png, process-card.png, gate.png
