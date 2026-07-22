# Clarity Phase 4b — Quest Peek View on the Seeing Stone

Mike's ruling (2026-07-22, talk-first): "I'd like the open/quest buttons on the looking
glass to open the quest in drawer/peek view initially. This will help me stay on the seeing
stone screen instead of bouncing all around." Branch `feat/clarity-phase1-data-plane`
(continue on it), worktree `~/.openclaw/workspace/citadel-clarity-wt`. Prior context: Phase
1 (data plane), Phase 3 (Oracle Face: Today/Needs Reshi), 3b/3c/3d (calendar, Fleet split,
timezone), 4a (email on the glass — crisis strip, intake drawer, due-soon row). Hard rules
identical to all prior phases: worktree only, additive only, baseline first (floor 1658
tests/141 files vitest + 15/0 Playwright — this phase's own final gate from 4a), every gate
executed with exit-code discipline, registry untouched unless an API shape changes, repo
CLAUDE.md workflow, no push.

## Scope

Every quest/task-opening action on `/oracle` opens a slide-over peek drawer rendered on the
same page instead of navigating away:

1. The Review queue's "Open review" cards (`AskCard.tsx`, `primaryAction.kind ===
   'open_review'`).
2. The due-soon row's titles (`DueSoonRow.tsx`).
3. Today pick cards whose primary ref is a task (`TodayPickCard.tsx`, `kind === 'quest'`).
4. The intake drawer's "Create + open" (`IntakeDrawer.tsx`'s `handleCreateAndOpen`) — after
   creating the task, peek it instead of navigating.

Arc links on Today picks (`kind === 'arc'`) keep navigating to `/oracle/arcs/[id]` — a
workspace, not a detail view, per Mike's own framing ("only task/quest opens become peeks").

## Reuse, don't invent

`components/domain/tasks/task-peek-drawer.tsx` (`TaskPeekDrawer`) already exists and is
already the app's task detail peek — used on `/tasks`, `/projects/[id]`, `/deals/[id]`, and
all three dashboard Overlooks. It already renders title (inline-editable), status, priority,
client/project/site/charter context, due date, description, requirements, comments,
activity feed, and a "View in Fullscreen" link to `/tasks/[id]` (satisfies the "full view"
requirement) — built on the shared `Drawer`/`DrawerContent` primitives
(`components/ui/drawer.tsx`, Radix Dialog under the hood: X close, overlay click, Escape all
already wired). This phase mounts that exact component on the Oracle page rather than
building a second one.

Gap: `TaskPeekDrawer` shows client/project/site/charter but not **arc** — the concept this
phase's Today/Review surfaces actually key off. Closing that gap requires a small, additive
extension to the shared task API/type/drawer (see below) rather than a parallel component.

## New: shared peek-open plumbing

`lib/contexts/task-peek-context.tsx` — a `TaskPeekProvider` (mirrors the existing
`TimerProvider` pattern in the same directory) that owns `peekTaskId`/`isOpen` state, renders
`<TaskPeekDrawer>` once, and exposes `openTaskPeek(taskId)` via context to every descendant.
`useTaskPeek()` has a safe no-op default (not a thrown error) so components using it keep
rendering standalone in existing isolated component tests that mount them without a
provider. `OraclePage` wraps its return tree in `<TaskPeekProvider>`; `AskCard`,
`TodayPickCard`, `DueSoonRow`, and `IntakeDrawer` swap their `Link`/`router.push` calls for
`openTaskPeek(taskId)`.

## Server-side additions (folded in from the coordinator, discovered live this morning)

1. **`PATCH /api/tasks/[id]` silently strips `arc_id`.** The zod schema predates arcs. Add
   `arc_id: z.string().uuid().nullable().optional()`: present+non-null validates the arc
   exists (404 if not) and sets it; explicit `null` detaches; absent leaves untouched.
2. **Due-soon row over-shows arc-linked tasks.** A task due today whose *arc* was picked for
   today (not the task itself) still shows in due-soon, double-displaying it alongside the
   arc's own Today slot. Exclude tasks whose `arc_id` matches an arc picked in today's
   `today_picks`, not just tasks picked directly.
3. Both prerequisites for the arc data now showing in the peek drawer and for today's live
   workflow — folded into this phase's gates/commits per the coordinator's instruction.

## UI details

- Theme tokens only (`bg-surface`, `text-text-main`, etc.) — no new hand-picked colors
  introduced; `TaskPeekDrawer` already token-only.
- Mobile: `DrawerContent`'s existing `w-[min(90vw,...)]` sizing is the app's established
  responsive drawer convention — reused as-is, no new breakpoint logic needed.
- Terminology: `useTaskPeek`/callers say "quest" in user-facing copy per the terminology
  hook (`t('task')`), matching the rest of the Oracle domain.

## Tests + gates (executed, all green before done)

Baseline first (floor 1658/141 vitest, 15/0 Playwright). New: `task-peek-context` unit
tests; updated `AskCard`/`TodayPickCard`/`DueSoonRow`/`IntakeDrawer` tests asserting
`openTaskPeek` is called instead of navigation; PATCH `/api/tasks/[id]` arc_id tests
(attach/detach/invalid-404/absent-untouched/unknown-fields-still-stripped regression);
due-soon arc-exclusion tests. Full `test:run` + `tsc --noEmit` + `next build`. Playwright:
new e2e proving a Review card opens the peek on-page (URL unchanged), Escape closes it,
"View in Fullscreen" navigates to `/tasks/[id]` — screenshots including one with the peek
open, desktop + mobile.

## Addendum 1 (mid-task, from Mike's live use): Today board Doing column + drag

The Today board lens (list↔board toggle on Today) could only check-toggle a pick straight
to Done — no in-progress state, no drag. Added: `today_picks.started_at` (additive,
nullable), column mapping (To do = neither set; Doing = started_at set, completed_at null;
Done = completed_at set regardless of started_at), drag-and-drop between all three columns
using the SAME dnd-kit wiring pattern as `ArcBoard.tsx` (`components/domain/oracle/today/
today-board-logic.ts` + rewritten `TodayBoard.tsx`). Dragging a Done pick anywhere else
clears `completed_at` but preserves `started_at` untouched — you can't un-start a task by
dragging it out of Done. The existing checkmark toggle and "Start" button remain as
non-drag shortcuts, now persisting via the same API path. `PATCH /api/today/[id]` accepts
`started_at` alongside the existing fields.

## Addendum 2 (mid-task, from Mike's live use): Intake relocated + Archive + training notes

Intake was a large in-page expandable section under Needs Reshi — Mike wants it OUT of the
main column entirely: a compact clickable chip in the header (top right, under the week
capacity strip — "📬 Intake · N") that opens a slide-over drawer, reusing the exact same
`Drawer`/`DrawerContent` primitives the quest peek already uses. Two new capabilities on
top of the relocation:

1. **Per-item archive intent.** `EmailAskState` gains `archive_requested` (additive `ALTER
   TYPE ... ADD VALUE IF NOT EXISTS`). Each drawer card gets an Archive button (PATCH
   state=archive_requested) — resolved from Mike's perspective instantly (drops out of the
   intake query, which filters `state=open`, with zero extra code). New `GET
   /api/email-asks?state=&account=` (bearer auth, no role gate, same pattern as
   `/api/oracle/email-sync`) lets the (machine-side, not built here) classifier fetch
   pending archive intents and execute the real Gmail archive later.
2. **Training notes.** Additive `email_asks.training_note TEXT?`. Each card gets a small
   "note for Bast" toggle (collapsed behind an icon, not a form) → PATCH `training_note`.
   Visible on the card once set. The classifier consumes recent notes as calibration
   examples (machine-side, not built here).

Found and fixed along the way: two permanently-mounted (`forceMount`) Drawer instances on
the same page (the quest peek + Intake) caused Escape to sometimes route to the wrong one.
Fixed by lazy-mounting Intake's `Drawer` behind a `hasOpened` flag — it isn't in the DOM at
all until the trigger's first click, so there's only ever one `forceMount` layer active
unless Mike has actually opened Intake.

## Report back

Baseline vs final counts, every gate's executed result, e2e screenshot paths, commits,
deviations.
