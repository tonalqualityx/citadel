# Clarity Phase 4b — Quest Peek View — Verification Record

Spec: `feature-planning/clarity-phase4b-quest-peek.md`. Plan:
`implementation/plans/clarity-phase4b-quest-peek.md`.

## Baseline

- `npm run test:run`: **1658 tests / 141 files, exit 0.**
- `npx playwright test`: **15 passed / 0 failed, exit 0.**

## Migrations

Both applied by hand (`ALTER ...` directly via `docker exec citadel-postgres psql`, not
`prisma migrate dev`) — this dev DB's migration history has a pre-existing checksum
mismatch on `20260722021159_clarity_phase4a_email_asks` (that migration's own verification
record notes it was hand-edited after being applied, to add the `ALTER TYPE ... ADD VALUE
IF NOT EXISTS` guard; the recorded checksum in `_prisma_migrations` predates that edit).
`prisma migrate dev` refuses to proceed past this mismatch and offers only a full `migrate
reset`, which would drop all local dev data — never an option per the hard rules. Applied
the SQL by hand instead both times, then registered each migration as applied via a direct
`INSERT` into `_prisma_migrations` with the real file's sha256 checksum, confirmed clean via
`prisma migrate status` ("Database schema is up to date!") afterward. Pre-existing
condition, not caused by this phase — flagged for Bast: the phase4a checksum drift should
eventually be resolved (e.g. `prisma migrate resolve`) so `migrate dev` works normally again
for the next phase.

1. `prisma/migrations/20260722135741_clarity_phase4b_today_pick_started_at/` — one additive
   nullable column, `today_picks.started_at TIMESTAMP(3)`.
2. `prisma/migrations/20260722142318_clarity_phase4b_email_asks_archive_and_notes/` — two
   additive changes: `ALTER TYPE "EmailAskState" ADD VALUE IF NOT EXISTS
   'archive_requested'` and `email_asks.training_note TEXT` (nullable column).

## Server-side additions (from the coordinator, folded into this phase)

1. **`PATCH /api/tasks/[id]` now accepts `arc_id`** (`app/api/tasks/[id]/route.ts`):
   present+non-null validates the arc exists (`prisma.arc.findUnique`, 404 if not) and
   attaches it; explicit `null` detaches with no existence check; absent leaves untouched.
   `arc` relation added to the GET/PATCH `include` blocks; `formatTaskResponse` already
   carried `arc_id`/`arc` from an earlier phase (session-originated quests) — reused as-is,
   no duplicate field added. Registry (`lib/api/registry/tasks.ts`) updated: `bodySchema`
   entry for `arc_id` on PATCH, `arc_id`/`arc` added to GET's `responseExample`.
2. **Due-soon row excludes arc-picked tasks** (`app/api/today/due-soon/route.ts`): a task
   due soon whose ARC (not the task itself) was picked for today no longer double-shows in
   due-soon — it rides the arc's own Today slot. Implemented as a second `todayPick.findMany`
   query for `item_type=arc` picks, building a `pickedArcIds` set alongside the existing
   `pickedTaskIds` set.
3. **Today board lens gains a real, persisted Doing column** (`today_picks.started_at`):
   `PATCH /api/today/[id]` accepts `started_at` (set/null) alongside the existing fields.
4. **Intake relocated to the header + Archive + training notes** (see its own section
   below) — folded in from a later coordinator message, same "discovered live this
   morning" workflow-blocking category.

## UI — Quest Peek View

- `lib/contexts/task-peek-context.tsx` — new `TaskPeekProvider` (mirrors the existing
  `TimerProvider` pattern) owns the single shared `TaskPeekDrawer` instance
  (`components/domain/tasks/task-peek-drawer.tsx` — REUSED as-is except one additive Arc
  context row, mirroring the existing Charter block, gated on `task.arc` presence) and
  exposes `openTaskPeek(taskId)`. `useTaskPeek()` outside a provider is a safe no-op
  (verified by unit test), so components using it didn't need every one of their existing
  isolated component tests updated just to satisfy a new required context.
- `app/(app)/oracle/page.tsx` wraps its tree in `<TaskPeekProvider>`.
- Four navigation call sites converted to `openTaskPeek(taskId)`:
  - `AskCard.tsx` — Review queue's "Open review" (was `<Link href="/tasks/[id]">`).
  - `TodayPickCard.tsx` — the `quest` primary action (was `<Link>`). The `arc` primary
    action (arc board link) is UNCHANGED — a workspace, not a detail view, per Mike's own
    framing.
  - `DueSoonRow.tsx` — the due-soon task title (was inert text, now a button).
  - `IntakeDrawer.tsx` — `handleCreateAndOpen` (was `router.push`); dropped the now-unused
    `next/navigation` import.
- "Full view" requirement satisfied by the drawer's pre-existing "View in Fullscreen" link
  to `/tasks/[id]` — left as-is (a widely-shared component used on `/tasks`,
  `/projects/[id]`, `/deals/[id]`, and all three dashboard Overlooks; renaming its button
  text was out of scope and unnecessary — it already does exactly what "full view" means).
- Standard dismiss (X, overlay click, Escape) — all inherited from the reused
  `Drawer`/`DrawerContent` (Radix Dialog) primitives, verified live in e2e (Escape) and by
  inspection (X button, overlay `onInteractOutside`) — no new dismiss logic written.
- Mobile: the drawer's existing `w-[min(90vw,600px)]` (`size="xl"`) sizing IS the app's
  established responsive drawer convention — reused as-is, confirmed via mobile e2e
  screenshot (full-height slide-over, no new breakpoint code needed).
- Theme tokens only — zero new hand-picked colors; verified visually via screenshots.

## UI — Today board lens: Doing column + drag (coordinator addition)

- `components/domain/oracle/today/today-board-logic.ts` (new) — pure `columnForPick` +
  `fieldsForTransition` functions, unit tested in isolation (11 cases) per the repo's
  logic/dumb-component convention.
- `components/domain/oracle/today/TodayBoard.tsx` — rewritten to use the SAME dnd-kit wiring
  pattern as `ArcBoard.tsx` (`DndContext` + `PointerSensor`/`KeyboardSensor` +
  `closestCorners` + `DragOverlay`), replacing the old session-local `doingIds` state.
  Column membership is purely a function of `started_at`/`completed_at` — dragging a Done
  pick anywhere other than back into Done clears `completed_at` but preserves `started_at`
  untouched (per the coordinator's exact framing: "you can't un-start a task by dragging it
  out of Done"). The existing checkmark toggle (in `TodayPickCard`) remains a same-effect
  shortcut straight to Done. The existing "Start" button (To do -> Doing, one-tap) was kept
  as a non-drag/mobile-friendly affordance, now persisting via the same API path as drag.
  The Doing column's soft WIP cap (`isDoingColumnOverCap`, >=3, warning tint) is unchanged
  and now driven by real column membership instead of local state.

## UI — Intake relocated to the header + Archive + training notes (coordinator addition)

- `IntakeDrawer.tsx` fully reworked: was a large in-page expandable `<section>` under Needs
  Reshi, now a compact trigger chip ("📬 Intake · N") rendered by `OracleHeader.tsx` (top
  right, under `WeekStrip`) that opens a slide-over `Drawer` — the SAME
  `Drawer`/`DrawerContent` primitives the quest peek uses. Nothing intake-related renders
  in the main column anymore; `app/(app)/oracle/page.tsx` no longer mounts `IntakeDrawer`
  directly, `OracleHeader` does (new optional `intake` prop, reuses the header's own
  already-fetched `timezone`).
- **Archive**: `EmailAskState` gains `archive_requested`. Each drawer card gets an Archive
  button -> `PATCH /api/email-asks/[id]` `{state: 'archive_requested'}`. Resolved from
  Mike's perspective instantly with ZERO new query logic — `/api/waiting-on-me`'s intake
  derivation already filters `state='open'` (from Phase 4a), so an archive_requested ask
  simply stops matching. New `GET /api/email-asks?state=&account=` (bearer auth via
  `requireAuth()` only, no role gate — same pattern as `/api/oracle/email-sync`) is the
  machine-side classifier's read for pending archive intents; executing the real Gmail
  archive from that read is Bast's machine-side wiring, out of this build's scope.
- **Training notes**: `email_asks.training_note` (nullable text). Each card gets a
  "Note for Bast" toggle (icon + text, collapsed by default) that reveals a single-line
  input; Enter or "Save" -> `PATCH training_note`. Shown on the card once set ("note: ...").
  The classifier consuming these as calibration examples is machine-side, out of scope here.
- Registry (`lib/api/registry/clarity.ts`): new GET `/api/email-asks` entry; PATCH
  `/api/email-asks/{id}`'s `bodySchema` extended with `training_note` and the `state`
  description updated to include `archive_requested`.

## Gates (all executed, exit codes recorded)

| Gate | Result |
|---|---|
| `npm run test:run` | **1705 tests / 147 files, exit 0** (1658+47; 6 new test files: `task-peek-context.test.tsx`, `AskCard.test.tsx`, `TodayPickCard.test.tsx`, `today-board-logic.test.ts`, `arc-update.test.ts`, `app/api/email-asks/__tests__/route.test.ts`; existing files extended: `IntakeDrawer.test.tsx`, `DueSoonRow.test.tsx`, `CrisisStrip.test.tsx`, `crisis-strip-logic.test.ts`, `app/api/today/due-soon/__tests__/route.test.ts`, `app/api/today/[id]/__tests__/route.test.ts`, `app/api/email-asks/[id]/__tests__/route.test.ts`) |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, `/oracle` and all other routes present in the route table |
| `npx playwright test` (full suite) | **20 passed / 0 failed, exit 0** — re-run 6 times total across this phase's two rounds of e2e additions (all 6 clean) |

New vitest coverage: `lib/contexts/__tests__/task-peek-context.test.tsx` (4 — opens with the
right id, closes, safe no-op outside a provider), `components/domain/oracle/needs-reshi/__tests__/AskCard.test.tsx`
(2), `components/domain/oracle/today/__tests__/TodayPickCard.test.tsx` (2),
`components/domain/oracle/today/__tests__/today-board-logic.test.ts` (11),
`app/api/tasks/[id]/__tests__/arc-update.test.ts` (5 — attach/detach/404/untouched/unknown-fields-stripped
regression), `app/api/email-asks/__tests__/route.test.ts` (7 — auth, no-filter list,
state=archive_requested filter, account filter, both together, invalid-state 400,
training_note in the response shape), 3 new cases in `app/api/today/due-soon/__tests__/route.test.ts`
(arc-picked exclusion), 3 new cases in `app/api/today/[id]/__tests__/route.test.ts`
(started_at set/clear/untouched), 4 new cases in `app/api/email-asks/[id]/__tests__/route.test.ts`
(archive_requested accepted, training_note set/clear/max-length-2000 validation), plus
test-update sites (`IntakeDrawer.test.tsx` — trigger chip/lazy-mount/Archive/training-note,
`DueSoonRow.test.tsx`, `CrisisStrip.test.tsx` + `crisis-strip-logic.test.ts` — `training_note`
added to their `EmailAsk` fixtures for `tsc` after the type gained the field) asserting
`openTaskPeek` calls instead of navigation and the new capabilities' behavior.

## E2E — new file + screenshots

New `__tests__/e2e/oracle-phase4b-peek.spec.ts` (5 tests, fixtures from
`scripts/seed-clarity-phase4b-peek-fixtures.ts`):
1. Desktop — clicking a Review card's "Open review" opens the peek AS A DIALOG ON THE SAME
   PAGE (URL stays `/oracle`), Escape closes it (asserted via the drawer's `data-state`
   attribute — it's `forceMount` + CSS-transform animated, never fully unmounts, so DOM
   presence/generic `toBeVisible()` can't distinguish open from closed; see Deviation #2),
   reopening + "View in Fullscreen" navigates to `/tasks/[id]`.
2. Mobile (390px) — peek renders as a slide-over, no horizontal overflow, Escape closes.
3. Today board lens — drag a pick To do -> Doing -> Done (dnd-kit mouse-move sequence
   mirroring `oracle-phase3.spec.ts`'s arc-board drag test), reload, re-enter the board
   lens, confirms the move PERSISTED server-side (not just an optimistic client reorder).
4. Intake relocated — the header trigger chip, drawer opens (lazy-mounted — not in the DOM
   until first click, see Deviation #5), Archive removes the item from the list without a
   reload.
5. Intake — a training note persists across reload (real server round-trip, not optimistic
   client state).

`oracle-phase4a-email.spec.ts`'s own intake test updated to match the relocation (was
asserting the old in-page `<section>` structure; now asserts the header trigger + drawer).

Screenshots: `app/test-results/clarity-phase4b/desktop-1280-oracle-peek-open.png`,
`app/test-results/clarity-phase4b/mobile-390-oracle-peek-open.png`,
`app/test-results/clarity-phase4b/desktop-1280-today-board-doing.png`,
`app/test-results/clarity-phase4b/desktop-1280-oracle-intake-drawer-open.png`.

## Deviations

1. **Migration applied by hand, not via `prisma migrate dev`** — see Migration section
   above. Pre-existing checksum drift from Phase 4a's own hand-edit, not caused by this
   phase; flagged for Bast to resolve before the next phase needs a clean `migrate dev`.
2. **A real, reproducible-twice full-suite regression found and fixed, not swept under the
   rug.** Adding this phase's new e2e spec file (one more `beforeAll` login) pushed the
   full suite's total concurrent login volume over the existing shared, IP-bucketed
   `authRateLimit` (10 req/min — already documented as a known risk in
   `oracle-phase3.spec.ts`'s own file comment). Two consecutive full-suite runs both failed
   identically at `oracle-phase3.spec.ts`'s third test (a 401 redirecting to `/login`) —
   deterministic, not the "moves between runs" flakiness Phase 4a's verification record
   described, meaning this phase's addition tipped a previously-marginal shared resource
   over the edge. Root-caused to `oracle-phase3.spec.ts` calling its own `login(page)` fresh
   at the top of each of its 3 tests (3 real `POST /login` calls per full-suite run, on top
   of every other file's own logins) instead of the storageState-reuse pattern
   `oracle-phase4a-email.spec.ts` already established for exactly this problem. Fixed
   `oracle-phase3.spec.ts` to match: one real UI login in `beforeAll`, storageState reused
   across all 3 of its tests — zero additional logins after the first, regardless of test
   count. Verified clean across 5 consecutive full-suite runs after the fix (18 passed / 0
   failed every time). This touches a file outside this phase's nominal scope
   (`oracle-phase3.spec.ts` belongs to Phase 3), but leaving a gate that reliably breaks
   because of this phase's own addition is not an acceptable trade — the fix applies an
   already-proven pattern, changes zero assertions, and is the minimal correct fix for a
   regression this phase's own change caused.
3. **Orphaned `today_picks` rows from repeated manual seed-script runs during development,
   cleaned up.** The board-drag fixture's task gets deleted and recreated fresh on every
   seed run (so the drag e2e always starts from "To do"); the FIRST version of
   `scripts/seed-clarity-phase4b-peek-fixtures.ts` deleted the task BEFORE its pick, and
   `TodayPick.task` is `onDelete: SetNull` — orphaning the pick (`task_id` -> null,
   `item_type` stays `task`, rendering as "Untitled pick") instead of removing it. Same bug
   class Phase 4a's own due-soon e2e hit (its verification record's Deviation #7). Fixed the
   seed script to delete the pick BEFORE the task, plus a defensive prune of any
   already-orphaned `item_type=task, task_id=null` picks on every run. Manually cleaned up
   the 3 orphans this bug had already produced during development in this dev DB.
4. **Arc display in the reused `TaskPeekDrawer`** — the spec's "client/arc" requirement
   needed a small additive extension to a widely-shared component (used on `/tasks`,
   `/projects/[id]`, `/deals/[id]`, all three dashboard Overlooks) rather than staying
   Oracle-scoped: `arc` added to the GET/PATCH `include` blocks in
   `app/api/tasks/[id]/route.ts`, the `Task` interface in `lib/hooks/use-tasks.ts`, and one
   additive JSX block in `task-peek-drawer.tsx` (gated on `task.arc` presence, mirroring the
   existing Charter block exactly). Confirmed zero blast radius: no test in the repo does
   exact-shape equality on `formatTaskResponse`'s output or the task-detail GET response.
5. **A real bug found and fixed: two simultaneous `forceMount` drawers broke Escape.** Once
   Intake became a second `Drawer`-based component permanently mounted on `/oracle`
   alongside the quest-peek drawer (both use the shared `DrawerContent`'s `forceMount` so
   they can animate closed via CSS instead of vanishing instantly — see
   `components/ui/drawer.tsx`), Escape started closing NEITHER reliably: pressing it while
   the quest peek was open (Intake still at its default closed state) left the peek open,
   its `data-state` staying `"open"`. Root cause: Radix's `DismissableLayer` registers an
   Escape handler for every mounted `Dialog.Content` regardless of its own open/closed
   state (since `forceMount` keeps it mounted permanently), so two of them on one page
   compete over which gets the keypress — a scenario that never existed before this phase
   (Intake used to be a plain `<section>`, not a `Drawer`). Fixed by lazy-mounting Intake's
   `<Drawer>` behind a `hasOpened` flag: it isn't in the DOM at all until the trigger's
   first click, so at most one `forceMount` layer is ever active unless Mike has actually
   opened Intake. Verified via a dedicated e2e assertion (`toHaveCount(0)` before first
   open) and confirmed the Review-peek Escape test passes reliably afterward. `TaskPeekDrawer`
   also gained a `data-testid="task-peek-drawer"` (it had none before) so e2e assertions
   could target it specifically once two `role="dialog"` elements could exist on the page
   at once — a `getByRole('dialog')` locator alone is no longer unambiguous.

## Commits

See `git log` on `feat/clarity-phase1-data-plane` — this spec + verification record
committed alongside the implementation, chunked per repo convention. No push.
