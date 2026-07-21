# Clarity Phase 3 — The Oracle Face

Spec author: Bast. Builder: implementation agent. Branch: `feat/clarity-phase1-data-plane` (continue on it), worktree `~/.openclaw/workspace/citadel-clarity-wt`. Phases 1-2 are LIVE IN PROD — the data plane and producers already feed real data. Approved visual mockup (BINDING for layout and grammar): `/tmp/claude-1001/-home-mike/c777ed38-c16a-4997-b4f5-6e75c7963a2b/scratchpad/oracle-phase3-mockup.html` — read it first, it is the design contract. System context: Bast memory `clarity-cockpit-system`.

## Hard rules (same as Phase 1 plus)

1. Worktree only; additive-only migration; baseline `npm run test:run` first (current floor: 1414 tests / 122 files) — existing suite stays green untouched; `next build` clean; api-registry updated for new endpoints; commit in chunks; NO push.
2. The Oracle is ADMIN-ONLY — preserve every existing gate (page, nav, fleet route). Preserve intact: Respond deep-links, subagent nesting, remote-spawn button, ended/stale semantics, ingest compatibility.
3. UI: components from `/components/ui/`, CSS-variable classes only (`bg-surface`, `text-text-main`, …) — zero hand-picked colors; all three themes must work via tokens. Use `useTerminology()` for user-facing task/project words. Follow repo CLAUDE.md workflow (impact analysis, plan file, sub-agents as needed).
4. Mobile: single column, Today pinned first, queues collapse to counts, week strip under header.

## Evidence-bound design rules (from the 2026-07-21 ADHD motivation research — BINDING)

- NEVER red for overdue/aging anywhere in the Oracle. Aging = neutral gray "3d" style indicators.
- Arc progress: percent-done bar on every arc card/board header; visually quiet below ~50%, gains presence as completion nears. Never a 0%-guilt display.
- Completion feedback: sub-second, quiet (check morph + count tick). No modals, no confetti, no sounds.
- Competence framing: evening/weekly copy = "advanced/closed" counts ("3 arcs advanced, 5 quests closed this week"), never points, never streaks, never a broken-chain/missed-day display of any kind.
- Kanban caps: max 4 columns, 5-7 visible cards per column, overflow behind a "+N more" collapse.
- No punishment mechanics. Quest/Campaign narrative skin via terminology only.

## Schema (one additive migration: `clarity_phase3_today_picks`)

```prisma
enum TodayPickType { arc task session lead note }

model TodayPick {  // @@map("today_picks")
  id         String        @id @default(uuid()) @db.Uuid
  date       DateTime      @db.Date            // the day this pick belongs to
  item_type  TodayPickType
  arc_id     String?       @db.Uuid            // relation Arc?
  task_id    String?       @db.Uuid            // relation Task?
  session_external_id String? @db.VarChar(255) // fleet session ref
  charter_id String?       @db.Uuid            // relation Charter? (sales lead)
  label      String?       @db.VarChar(300)    // free-form commitment text (type=note, or override)
  sort       Int           @default(0)
  completed_at DateTime?
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  @@index([date])
}
```
Exactly one ref (or label for `note`) per pick — validate in the API, not the DB. Cap: reject a 6th uncompleted pick for a date with 409 + clear message (WIP ceiling 5; UI shows warning tint past 3).

## API

- `/api/today` GET `?date=` (default today; picks joined with their arc/task/session/charter summaries + derived per-type primary action), POST (create pick; enforce type/ref validation + cap), and `/api/today/[id]` PATCH (sort, completed_at, label) / DELETE (remove pick — allowed; removal is not deletion of the underlying item). Auth: admin-only like fleet.
- Meetings for the time-shape: reuse existing Meeting model/routes if a suitable read exists; else add GET `/api/today/calendar?date=` returning that day's meetings (title, start, end) admin-only. Week capacity strip: same source aggregated per-day for the current week + open-quest due-date counts. Keep the endpoint dumb (data), the encoding lives client-side.

## Page: rework `/oracle`

Top to bottom per the mockup: Header (title, machine health one-liner — crons visible ONLY when erroring; idea quick-add posting to `/api/ideas` source=oracle; week capacity strip) → Today (time-shape track: meetings gray + focus picks blue + now-line, direct labels, over-cap gold tint; pick cards with type-adaptive primary action: session→Respond/resume deep-link, arc→arc board, task→quest, lead→charter, note→done-toggle) → Needs Reshi (Decide/Answer/Review columns from `/api/waiting-on-me` + session asks; severity chips icon+label on subtle fields; each card one primary action; Review overflow "+N more") → In motion (slim rows: name, session_type chip, goal, freshness, agent count; nesting behind expand) → Docked (collapsed rows: goal, waiting-on-what, aging neutral, resume handle, arc link; never auto-hidden while arc open) → archived/ended render nothing (existing filter).

New route `/oracle/arcs/[id]`: the arc board. 4 columns (not_started / in_progress / review / done mapped from TaskStatus; `blocked` renders as a chip on the card, not a column). Drag or button-move updates task status via existing task PATCH. Progress bar in header. Density caps per the binding rules.

Today board lens: a list↔board toggle on the Today section (same picks as columns To do / Doing / Done by completed_at + an in_progress marker on the pick). Cheap lens, same data.

## Tests + gates (executed, all green before done)

Baseline first. New: today_picks API (validation, cap-409, per-type joins), calendar/week endpoints, component tests per repo pattern for TimeShape (block layout math from meeting/pick times, now-line position, over-cap tint) and queue grouping. Full `test:run` + `next build` + registry. Playwright e2e: `/oracle` renders the new layout desktop (1280) + mobile (390) with seeded data, zero horizontal overflow, arc board drag-move persists a status change (the local dev DB on :5433 has seed/test data patterns — use them). Screenshot artifacts saved to `app/test-results/clarity-phase3/` for Bast's render review.

## Report back

Baseline vs final counts, migration + applied evidence, every gate's executed result, e2e screenshot paths, commits, deviations with reasoning, and anything Phase 4 (email cards) should know about the queue card component's extension points.
