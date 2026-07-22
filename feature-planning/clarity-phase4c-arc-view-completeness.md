# Clarity Phase 4c — Arc View Completeness

Mike's ruling (talk-first, coordinator-relayed): the arc board (`/oracle/arcs/[id]`) is
missing information he wants at a glance, and task cards there currently navigate
full-screen instead of peeking — "they currently navigate full-screen" is a live
complaint. Branch `feat/clarity-phase1-data-plane` (continue on it), worktree
`~/.openclaw/workspace/citadel-clarity-wt`. Prior context: Phases 1–5 all merged/complete
(data plane, Today/Needs Reshi, calendar, Fleet split, email on the glass, Quest Peek View,
The Soothsayer). Hard rules identical to all prior phases: worktree only, additive-only
migrations (`IF NOT EXISTS` guard on multi-path DDL), baseline first, every gate executed
with exit-code discipline, registry updated when an API shape changes, repo CLAUDE.md
workflow, no push.

## Scope

1. **Arc board header enrichment** (`/oracle/arcs/[id]`):
   a. **Session panel** — the arc's linked session(s), from two sources: `Arc.
      origin_session_external_id` (provenance) AND any `OracleSession` rows with `arc_id`
      = this arc. Render: session title, live status (running/idle/waiting chip),
      Respond deep-link when `remote_url` exists, and a quiet "waiting since <time>" line
      when `needs_attention`. No session linked → render nothing (exception display).
   b. **Time estimate** — sum of the arc's open tasks' `estimated_minutes` rendered as
      "~Xh Ym estimated", plus an arc-level override: additive migration adding
      `arcs.estimate_override_minutes Int?`, `PATCH /api/arcs/[id]` accepts it, display
      prefers the override when set ("~2h (set by hand)"). Registry updated.
   c. **Assignee chips** — every task card on the board shows its assignee (avatar or
      initials chip + name on hover), Mike's and Bast's alike.
2. **Task cards on the arc board open the peek drawer.** Mike's live complaint: they
   currently navigate full-screen. Reuse `TaskPeekProvider`/`TaskPeekDrawer` from Phase 4b
   exactly as the Seeing Stone does. Drag behavior must be unaffected (click = peek, drag
   = move — test both).
3. **Session-type picks on the Seeing Stone Today strip** (e.g. a bare session pick) also
   render the waiting-since line when their session has `needs_attention` (small parity
   fix with the arc board's own attention dot).

## Reuse, don't invent

- `lib/contexts/task-peek-context.tsx` (`TaskPeekProvider`/`useTaskPeek`) and
  `components/domain/tasks/task-peek-drawer.tsx` (`TaskPeekDrawer`) — built in Phase 4b,
  already the Seeing Stone's exact peek mechanism. This phase mounts the same provider on
  `/oracle/arcs/[id]` rather than building a second peek mechanism.
- `components/domain/oracle/StatusDot.tsx` / `OracleStatusBadge.tsx` — the session panel's
  live-status chip reuses these verbatim (same running/waiting/idle/needs_attention
  palette every other Oracle screen already uses).
- `commandAge` (`oracle-logic.ts`) — the "waiting since" line's relative-time formatting,
  same helper `ReviewGroupCard` already uses for "waiting Xh ago".
- `components/ui/avatar.tsx` (`Avatar`) — the assignee chip, same component used across
  `/tasks`, `/projects/[id]`, comments, activity feed, etc.
- `capColumnCards`/`isWithinColumnLimit` (`lib/kanban-caps.ts`) — the board's existing
  density discipline is untouched by this phase's additions.

## Server-side additions

1. **`Arc.estimate_override_minutes Int?`** (additive nullable column) — `PATCH
   /api/arcs/[id]` accepts it (set/clear/absent-untouched, same pattern as `closed_at`/
   `snoozed_until`). `GET`/`PATCH /api/arcs/[id]` both compute and return
   `estimated_minutes_total` (sum of the arc's non-terminal tasks' `estimated_minutes`,
   nulls treated as 0 — `lib/arc-status.ts`'s new `sumOpenEstimatedMinutes`, same terminal-
   status definition `getArcStatus`/`getArcProgressPercent` already use).
2. **Arc session panel** — `GET`/`PATCH /api/arcs/[id]` additionally include the arc_id-
   linked `OracleSession` rows and, when `origin_session_external_id` is set and not
   already among them, look up and merge that session in too (`lib/arc-sessions.ts`'s pure
   `mergeArcSessions`, dedup by id).
3. **Today pick session summary parity fix** — `lib/services/today-picks-shape.ts` and
   `app/api/today/[id]/route.ts`'s session lookups gain `needs_attention`/`last_event_at`
   in their select + response shape, feeding the Today pick card's own waiting-since line.

## UI details

- Theme tokens only, no new hand-picked colors.
- The session panel and the estimate badge render nothing when there's no session/no
  tasks respectively — exception-based display, matching the rest of the Oracle's
  evidence-bound design rules.
- The estimate override needs a real in-app way for Mike to set it (the spec's "set by
  hand" framing implies a human action, not an API-only field) — a minimal inline editor
  (pencil affordance → one number input → Save/Clear), mirroring the arc board's own
  `QuickAddQuest` toggle-then-inline-form pattern rather than a new modal.
- Terminology: assignee chip's hover title is the person's plain name; no terminology-hook
  involvement needed (assignee is a `User`, not a domain term).

## Tests + gates (executed, all green before done)

Baseline first (floor 1784/150 vitest, 29/0 Playwright — Phase 5's own final gate). New:
`sumOpenEstimatedMinutes`/`mergeArcSessions` unit tests; `arc-board-logic.ts` (estimate
display formatting) unit tests; `ArcSessionPanel` component tests; `PATCH /api/arcs/[id]`
tests (estimate override set/clear/untouched/bounds, sessions merge/dedupe/no-origin-
lookup-when-redundant); `TodayPickCard` waiting-since parity tests. Full `test:run` +
`tsc --noEmit` + `next build`. Playwright: new e2e proving the session panel renders with
a seeded linked waiting session, the estimate badge computes/overrides/persists, task
cards open the peek drawer without breaking drag (click = peek, drag = move, both tested),
screenshots including the arc board desktop view with all three enrichments visible.

## Report back

Baseline vs final counts, migration evidence, every gate's executed result, e2e screenshot
paths, commits, deviations.
