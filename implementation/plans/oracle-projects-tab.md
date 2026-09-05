# Feature: Oracle Projects Tab

Spec (blessed by Mike 2026-09-04): https://claude.ai/code/artifact/42674648-e4b5-459d-96da-ee65f6fe4b23
Branch: `feat/oracle-projects-tab` (worktree `citadel-projects-tab-wt`). Lands as a PR to `main`; `main` deploys to production, so the PR merges only on Mike's word.

## Overview
A fourth Oracle mode, **Projects**, showing in-progress contracted projects with the ones stalled on Mike first. Every blocker carries the materials to act on it. Two lenses (cards by project; grouped rows by kind of work). Picks land in arcs and Today's picks. A hybrid next-step line (task-graph candidate + Bast-inferred line, 3 AM nightly, on demand, overridable). Project notes log with parked-until. Emails linked to projects with a running summary. Client-approval loop with a queued Gmail send through a machine-side sender. Task/SOP `needs_review` and `is_billable` defaults flip to false. Plan and Process tabs hidden behind a flag.

## Adaptations from the codebase map (scope unchanged)
- **Picks:** `TodayPick` is a 5-item capped list pointing at tasks/arcs (no "today's arc"). "Pick" = optionally attach the task to an arc (`PATCH /api/tasks/:id {arc_id}`) and add a pick (`POST /api/today {item_type:'task'|'arc'}`); a 409 at the cap is surfaced as-is. Multi-select = `POST /api/arcs {name, project_id?}` → attach each task → add the arc as one pick.
- **Tab badge:** `ModeTabs` law forbids visual pull on tabs. Mike explicitly asked for a red-dot count on Projects. Amend the law comment in `ModeTabs.tsx`: the one permitted pull is a count of projects stalled on Mike, shown only when > 0.
- **Mode persistence:** none (existing law). Work stays the landing mode. Projects opens on the project lens.
- **Approve:** `PATCH /api/tasks/:id {approved:true}`. Request-changes = comment + `approved:false`. Tags = full-replace PATCH. Comments = existing POST (with `is_internal`).
- **Email send:** gog runs only on Mike's machine. `ApprovalRequest.status` goes `draft → queued → sent`; a machine-side sender (`~/.claude/tools/citadel-approvals/approval-sender.py`, cron */5) sends queued rows via `gog gmail send --reply-to-message-id` and writes `message_id`/`thread_id`/`sent_at`. The classifier matches replies by `thread_id`.
- **Meetings:** no transcript automation writes `Meeting` here. Phase 5 exposes `POST /api/approval-requests/:id/seen-in-meeting` for the meeting-sync skill; the skill change is a one-line addition, out of this repo.
- **Health:** reuse `lib/calculations/project-health.ts` alerts; do not rebuild.
- **Flags:** `lib/config/feature-flags.ts` consts: `ORACLE_PROJECTS_TAB = true`, `ORACLE_HIDE_PLAN_PROCESS = true`.
- **Migrations:** hand-guarded idempotent SQL (`ADD COLUMN IF NOT EXISTS`, `DO $$ ... duplicate_object` for enums), named `<ts>_oracle_projects_phase<N>_<desc>`.
- **Nightly refresh:** system crontab (file-based edit) `0 3 * * *` → `~/.claude/tools/citadel-projects/next-step-refresh.sh` → `claude -p --model sonnet --effort medium` per batch, bearer `~/.citadel-token`, ledger `log-pass --source projects-next-step`.

## Files to Create
### Phase 1: data + defaults
- [x] `prisma/migrations/<ts>_oracle_projects_phase1_models/migration.sql` — ProjectNote, ApprovalRequest, BlockerDismissal; Project next-step + email-summary + stale_muted_until columns; EmailAsk client_id/project_id/match_source; Task/Sop default flips (`ALTER COLUMN ... SET DEFAULT false`)
- [x] `prisma/schema.prisma` — models + fields above (`ProjectNote`, `ApprovalRequest`, `BlockerDismissal`, enums `ProjectNoteKind {note, parked_until}`, `ApprovalRequestStatus {draft, queued, sent, replied, approved, changes_requested, cancelled}`, `NextStepSource {graph, bast, mike}`, `BlockerDismissalKind {mention, email, session_ask, task, meeting_risk, stale}`)
- [x] `app/api/projects/[id]/notes/route.ts` — GET list / POST create (kind, body, until_date)
- [x] `app/api/projects/[id]/notes/[noteId]/route.ts` — DELETE (soft)
- [x] `scripts/pending-review-cleanup.ts` — prints the current done+needs_review+!approved list as a table for Mike; `--apply --ids <csv>` flips `needs_review=false` on the approved ids only (reversible, logged via `logUpdate`)
- [ ] `~/.openclaw/workspace/skills/citadel-worker/SKILL.md` — comment brief already embedded 2026-09-04 (done; out of this repo, not touched here)

### Phase 2: signals API
- [x] `lib/oracle/projects/blockers.ts` — pure classification: `classifyProjectBlockers(input, now) -> Blocker[]` for kinds decision / clarification / review / session_ask / mention / client_email / client_approval / someone_else / stale / meeting_risk; `ownerIsMike(blockers)` for the stalled-on-Mike verdict; shares tag/bot constants with the spawn gate (`lib/oracle/projects/gate-constants.ts`, mirrored from `~/.config/citadel-worker/gate.json` with a drift test)
- [x] `lib/oracle/projects/movement.ts` — pure: `lastMovement(input)`, `isStale(input, now)`, `daysSince(at, now)` (see Phase 2 notes: `isWaitingOnClient` from this plan's shorthand became `ownerIsMike` on `blockers.ts`, per the handed-off task spec)
- [x] `lib/oracle/projects/next-step-candidate.ts` — pure: `findNextStepCandidate(tasks)` (first ready task in phase/sort/created_at order with blockers done) + `mergeNextStep(project, candidate)` (mike > bast > fresh graph candidate > "no ready task")
- [x] `lib/oracle/projects/gate-constants.ts` + `__tests__/gate-constants.drift.test.ts` — `BLOCKING_TAGS`/`BOT_USER_IDS`/`BAST_USER_ID`/`MIKE_USER_ID`, drift-checked against the live gate.json at test time (skips with a clear reason when the file is absent, e.g. CI)
- [x] `lib/oracle/projects/__tests__/*.test.ts` — unit tests for all four pure modules (71 tests: gate-constants 3, next-step-candidate 16, movement 15, blockers 37)
- [x] `app/api/oracle/projects/route.ts` — GET: in-progress `type=project` projects with blockers, owner, movement, stale, next step, dismissals applied; `?lens=kind` returns the same blockers grouped
- [x] `app/api/oracle/projects/__tests__/route.test.ts` — filter, stalled sort (both stalled-vs-not and days_quiet-within-stalled), kind grouping, dismissal suppression, auth
- [x] `lib/hooks/use-oracle-projects.ts` — React Query, 60s refetch; wired into `ModeShell.tsx` (`projectsBadgeCount={data?.stalled_count ?? 0}`, replacing Phase 1's hardcoded 0)
- [x] `app/api/oracle/email-sync/route.ts` — client/project auto-match wired (sender -> ClientContact -> Client -> exactly-one-eligible-project), never overwrites `match_source='mike'`, never downgrades an existing `auto` match on a re-sync unless the resolved client itself changed
- [x] `app/api/email-asks/[id]/attach/route.ts` — the `project_id` branch now also stamps `client_id` from the project

### Phase 3: next-step engine
- [x] `app/api/oracle/projects/[id]/next-step/route.ts` — PATCH (Mike override: source=mike, mutually-exclusive `owner_id`/`owner_label`) / DELETE (clears the override). Diverges from this plan line's original one-file PATCH+POST-refresh-one sketch: refresh-one landed as its OWN route (`[id]/refresh/route.ts`, see below) returning 202 `{requested_at}` with no job id — the actual task spec handed to this pass superseded the plan's shorthand, same precedent as Phase 2's `isWaitingOnClient` note.
- [x] `app/api/oracle/projects/[id]/refresh/route.ts` — POST refresh-one: stamps `next_step_refresh_requested_at`, 202 `{requested_at}`
- [x] `app/api/oracle/projects/refresh/route.ts` — POST refresh-all (every in-progress `type=project` project)
- [x] `app/api/oracle/projects/refresh-requests/route.ts` — GET (bearer, any authenticated user): queued refresh ids, oldest first
- [x] `app/api/oracle/projects/[id]/next-step/write/route.ts` — PUT used by the machine-side job (bearer, any authenticated user) to write `next_step_text/owner/source=bast/at` and `email_summary`; Mike's override always wins (checked at write time, not enqueue time); 422s with `violations` on a writing-standard lint failure
- [x] `lib/oracle/projects/next-step-lint.ts` (+ tests) — ports comment-gate.sh's 4 grep-based checks (pipeline/gate codes, worker-internal vocabulary, process narration, dash law) for server-side validation of `next_step_text`/`email_summary`
- [x] `~/.claude/tools/citadel-projects/next-step-refresh.sh` + `next-step-refresh.py` — gathers open tasks + last comment, the last 20 project comments (90 days), linked emails, notes, and the current next-step per project; builds one prompt embedding the writing-standard's writing-rules/comment-rules blocks (read from the skill file at run time); runs `claude -p --model sonnet --effort medium --output-format json`; gates the reply with `comment-gate.sh`, one rewrite on failure, writes nothing on a second failure; PUTs via the write route; logs one ledger row per project. `--all` / `--requested` / `--project <id>`; `DRY_RUN=1` reads real data and prints the plan + prompt sizes, writes nothing
- [x] `~/.claude/tools/citadel-projects/tests/test_next_step_refresh.py` — 8 tests against a fake HTTP server + fake `claude` binary: happy path, mike-override skip, gate rewrite, second-failure no-write, requested-mode (queued + empty-queue), dry run, `--all` covering every project
- [x] `lib/hooks/use-next-step.ts` — override/clear/refresh-one/refresh-all mutations, no UI yet (Phase 4)
- [x] Crontab (file-based edit, backed up first): `0 3 * * *` `--all`; `*/2 6-23 * * *` `--requested`

### Phase 4: the tab
- [x] `components/domain/oracle/modes/projects/ProjectsView.tsx` — lens toggle (By project / By kind, localStorage-persisted), Refresh all, stalled summary line, loading/error/empty states, drawer host
- [x] `components/domain/oracle/modes/projects/projects-logic.ts` — pure: `sortProjectCards`, `stalledCount`, `groupByKind` (stable heading order), `shouldCollapseToRows`, `lastMovementSentence`, `buildSinglePickPlan`/`buildMultiPickPlan` (pick payload builders, incl. non-task blocker → task-create), `defaultArcNameForHeading`
- [x] `components/domain/oracle/modes/projects/ProjectCard.tsx`, `ProjectDrawer.tsx`, `BlockerRow.tsx`, `KindLens.tsx`, `PickToArcDialog.tsx`, `NotesLog.tsx`, `EmailSummary.tsx`
- [x] `components/domain/oracle/modes/projects/__tests__/projects-logic.test.ts`, `ProjectsView.test.tsx`, `ProjectCard.test.tsx`, `ProjectDrawer.test.tsx`, `BlockerRow.test.tsx`, `KindLens.test.tsx` (63 tests total)
- [x] `lib/hooks/use-project-notes.ts` — shipped in Phase 1 alongside the notes routes it wraps (see Phase 1 notes). **Deviation:** no separate `use-pick-to-arc.ts` was added — see Phase 4 Notes below for why.
- [x] `__tests__/e2e/oracle-projects-tab.spec.ts` + `scripts/seed-oracle-projects-fixtures.ts` — seeds one in-progress project with a needs-mike decision task (last comment Bast's), one review task, one parked note; opens the tab, asserts the badge/card/red-edge, opens the drawer, replies to the decision blocker, verifies the tag cleared via the real API, screenshots

### Phase 5: actions + approval loop
- [x] `app/api/approval-requests/route.ts` (POST create draft, GET list) — **Deviation:** the task spec handed to this pass superseded this plan line's older `queued/route.ts`/`[id]/sent/route.ts` split with `GET /api/approval-requests?status=queued` (a query param on the collection route, not a nested `queued/` route) and `PUT /api/approval-requests/[id]/sent` (already nested under `[id]`, matching this line) — same precedent as Phase 2's `isWaitingOnClient`→`ownerIsMike` and Phase 3's next-step refresh-one note: the actual handed-off spec wins over this file's own shorthand. Also added, per that spec, and not named in this plan line at all: `[id]/send-error/route.ts` (PUT) and `[id]/reply/route.ts` (POST, the classifier's own endpoint) — both implied by "queued → sent → replied" but not spelled out as separate files here.
- [x] `app/api/oracle/projects/[id]/dismiss/route.ts` — POST create BlockerDismissal; DELETE undo by `?dismissal_id=`. **Deviation:** nested under the project `[id]`, not a flat `dismiss/route.ts` — the handed-off task spec's exact route (`POST /api/oracle/projects/[id]/dismiss`) is what BlockerDismissal.project_id actually needs, and matches the sibling `[id]/next-step`, `[id]/refresh` routes' own nesting convention.
- [x] `app/api/oracle/projects/nudge-draft/route.ts` — POST returns a drafted nudge keyed off the person's record (user → comment text; contact → email draft; label-only → email draft with an empty `to` and a fill-in note); never sends
- [x] `~/.claude/tools/citadel-approvals/approval-sender.py` + `.sh` + `deploy.sh` + `tests/` — cron `*/5 6-22 * * *`, sends queued approvals via `gog gmail send` (argv list, `mike@becomeindelible.com` only), writes back `message_id`/`thread_id`/`sent_at` via PUT `.../sent`, or `PUT .../send-error` on failure (server flips the row to `draft` after the 3rd). Ledger row per attempt (`--source approval-sender`, `--model`/`--effort`/`--tier` all placeholder `"n/a"`/`"n/a-n/a"` — this job makes no model call). 26 tests, fake HTTP server + fake `gog` binary on PATH.
- [x] `lib/hooks/use-approval-requests.ts`, `use-blocker-dismissals.ts`, `lib/hooks/use-nudge-draft.ts` (an additional small hook, not named in this plan line, for the nudge-draft POST)
- [x] `components/domain/oracle/modes/projects/ApprovalPanel.tsx`, `NudgePanel.tsx` — see Phase 5 Notes below for where each renders
- [x] Tests for every new route (mocked prisma, 88 tests across 8 route files), the sender (26 tests, fake gog), the two panels (18 component tests), and the Playwright extension (dismiss+undo, ApprovalPanel queue)

## Files to Modify
- [x] `prisma/schema.prisma` — `Task.needs_review @default(false)`, `Task.is_billable @default(false)`, `Sop.needs_review @default(false)`; `Project`, `EmailAsk`, `Client`/`ClientContact` relations (also mirrored into `prisma/schema.postgresql.prisma` where the target models exist — see Phase 1 notes)
- [x] `app/api/tasks/route.ts` (`?? true` → `?? false` at the SOP-default site; `needs_review: z.boolean().optional()` added to the create schema, explicit beats SOP beats default) and `app/api/portal/tasks/[token]/new-task/route.ts` (hardcoded `needs_review: true` → `false`). `charters/commission-tasks`, `review-tasks`, `arcs/[id]` untouched (filters only).
- [x] `app/api/oracle/email-sync/route.ts` — client/project auto-match wired (Phase 2): sender -> ClientContact (case-insensitive) -> distinct client ids; exactly one client + exactly one eligible project (`type=project`, status in ready/in_progress/review) -> `match_source='auto'`; one client + 0 or 2+ eligible projects -> `client_id` set, `project_id` null, `match_source='unmatched'`; no contact -> untouched; a row already `match_source='mike'` is never even queried; an existing `auto` match is never downgraded on re-sync unless the resolved CLIENT itself changed (a shrinking eligible-project count alone does not undo it)
- [x] `app/api/email-asks/[id]/attach/route.ts` — accepts `project_id` as a third mutually-exclusive option (sets `match_source='mike'`); arc_id/task_id branches unchanged. Phase 2 follow-up: the `project_id` branch now also stamps `client_id` from the project (previously left null)
- [x] `components/domain/oracle/modes/mode-shell-logic.ts` — `OracleMode` gains `'projects'`; `getModeTabs(flags)` added, `MODE_TABS` kept as `getModeTabs(currentFlags)` for compatibility
- [x] `components/domain/oracle/modes/ModeTabs.tsx` — `projectsBadgeCount` prop, red-dot badge, law comment amended. Phase 2 follow-up (verification): the badge's announced text moved from a bare `aria-label` on the dot span to a separate visually-hidden (`sr-only`) text node ("N projects waiting on you") — an aria-label on a plain `<span>` with no ARIA role is announced inconsistently across screen readers; a real text node is reliable. The dot itself stays the only visible affordance (`aria-hidden`).
- [x] `components/domain/oracle/modes/ModeShell.tsx` — `projects` render branch → real `ProjectsView` wiring pending Phase 4 (still the Phase 1 placeholder view); `projectsBadgeCount` now reads `useOracleProjects().data?.stalled_count ?? 0` (Phase 2), replacing Phase 1's hardcoded 0
- [x] `lib/config/feature-flags.ts` — `ORACLE_PROJECTS_TAB` (const true) and `ORACLE_HIDE_PLAN_PROCESS` (env override `NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS`, default true); `playwright.config.ts` webServer env sets it false. Phase 2 follow-up (verification): added a comment on the webServer env override explaining it only works because `next dev` reads `NEXT_PUBLIC_*` at runtime — a `next build`/`next start` flow would bake the flag in at build time instead, silently breaking the override.
- [x] `lib/api/registry/projects.ts`, `lib/api/registry/sops.ts` — new notes routes + `needs_review` param documented; `lib/api/registry/oracle.ts` — `GET /api/oracle/projects` documented (Phase 2)
- [x] `~/.config/citadel-worker/gate.json` — no change (read-only source of truth); `lib/oracle/projects/gate-constants.ts` mirrors it with a drift test (Phase 2)

## Implementation Steps
1. Phase 1 (Sonnet): schema + guarded migration, notes routes, cleanup script, creation-path defaults. Gates: `npx prisma migrate deploy` on local DB re-run clean (idempotence), `npx tsc --noEmit`, `npm run test:run`, `npm run build`. Opus verify.
2. Phase 2 (Sonnet): pure modules + tests, projects route + hook. Gates as above plus a read-only comparison of `blockers.ts` output against `spawn-gate.py` on the live queue (same eligible/wake sets). Opus verify.
3. Phase 3 (Sonnet): next-step routes, machine-side refresh job, crontab line (file-based edit), ledger logging. Gates: unit tests, a `--dry-run` of the job against live projects (no writes), `comment-gate.sh` on generated lines. Opus verify.
4. Phase 4 (Sonnet): the tab. Gates: component tests, tsc, build, a Playwright smoke that opens the tab and the drawer against the local DB. Opus verify with a screenshot review against the spec's card anatomy.
5. Phase 5 (Sonnet): actions + approval loop + sender + dismiss + nudge drafts. Gates: route tests, sender test with a fake gog, a rehearsed approval round-trip against a test contact on Mike's own address (never a client). Opus verify.
6. Phase 6 (Opus): adversarial pass over the whole branch; PR to `main` with the plan and the spec linked; Mike reviews locally (`npm run dev` in the worktree) and merges. Production migration runs via `prisma migrate deploy` in the deploy workflow.

## Tests to Update (from Impact Analysis, 2026-09-04)
Baseline before any change: `npx vitest run` → 213 files / 2,516 tests, all green. That is the floor.

Definite breaks:
- [x] `components/domain/oracle/modes/__tests__/mode-shell-logic.test.ts` — `'ships exactly 3 tabs'` replaced with two `getModeTabs(flags)` cases: shipped defaults → `['work','projects']`; flags off → `['work','plan','process','projects']`.
- [x] `components/domain/oracle/modes/__tests__/ModeShell.test.tsx` — mocked `@/lib/config/feature-flags` with `ORACLE_HIDE_PLAN_PROCESS=false` (tabs-visible variant), added a Projects-tab click test. New `ModeShell.flag.test.tsx` mirrors `CoverBand.flag.test.tsx` — unmocked flags, proves the shipped defaults hide Plan/Process and show Projects. No stalled-count hook exists yet in Phase 1 (badge is hardcoded 0), so nothing to mock there.
- [x] `app/api/oracle/email-sync/__tests__/route.test.ts` — Phase 2: extended the prisma mock with `clientContact.findMany`/`project.findMany`/`emailAsk.update`, added a new describe block (6 tests: exactly-one-client-exactly-one-project -> auto, one-client-zero-projects -> unmatched, one-client-2+-projects -> unmatched, no-contact -> untouched, never-overwrites-mike, never-downgrades-an-existing-auto-match). Every pre-existing test in the file is unaffected — the default mock returns zero contacts, so the auto-matcher is a no-op for all of them.
- [x] 14 Playwright specs click `mode-tab-plan` or assert `mode-tab-process`. `playwright.config.ts` webServer now sets `NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS: 'false'`. No spec edits.

At risk, keep the shape:
- [x] `app/api/email-asks/[id]/attach/__tests__/route.test.ts` — added `prisma.project.findUnique` mock; generalized the "neither"/"both" tests to a three-field version (`arc_id`+`task_id`+`project_id` all rejected together); added `project_id` attach + 404 tests. Arc/task branch payload assertions untouched.

Confirmed safe (no assertion changes): `app/api/tasks/__tests__/route.test.ts` (added a `charter.findUnique` mock plus new describe block for the review-workflow defaults — existing fixtures/assertions untouched), charters commission-tasks, review-tasks, arcs/[id] (filters/selects only, not modified), portal list, task-form, session-tasks (already false), kickoff (already false), seed fixtures (explicit values), doors-logic/SignalsRail (door targets preserved).

## Tests to Write
- [x] Migration idempotence: applied via `prisma migrate deploy`, then re-run clean via `prisma db execute` (exit 0 both)
- [x] Creation paths: task without SOP → `needs_review=false`, `is_billable=false`; with SOP `needs_review=true` → `true`; with SOP `needs_review=false` → `false`; explicit `true`/`false` honored over both no-SOP and SOP-present cases; charter tasks never billable even with explicit override
- [x] `classifyProjectBlockers`: Phase 2 — 37 tests across all 10 kinds, dismissal suppression/resurfacing, `ownerIsMike`
- [x] `lastMovement` / `isStale` / `daysSince`: Phase 2 — 15 tests, incl. the Bast-comment coincidence window (in/out of 10 min, same/different task) and the escalation-pattern exclusion
- [x] `findNextStepCandidate` / `mergeNextStep`: Phase 2 — 16 tests (ordering, blocked_by-all-done, mike/bast/graph/none precedence)
- [x] Projects route: Phase 2 — 7 tests (auth, filter where-clause, stalled-vs-not sort, days_quiet sort within stalled, `?lens=kind` grouping, dismissal suppression, empty-result shape)
- [x] Pick logic: Phase 4 — `projects-logic.test.ts` (26 tests): single-blocker plan (task attaches directly, non-task blocker creates a task first), multi-blocker plan (project_id set only when every selection shares one project, split existing-vs-create-task lists), default arc name
- [x] Email auto-match: Phase 2 — 6 tests on `app/api/oracle/email-sync/route.ts` (see Tests to Update)
- [x] ApprovalRequest state machine: Phase 5 — `[id]/__tests__/route.test.ts` (21 tests): every legal transition (draft→queued incl. the to_email/subject/body-required and to_email-must-be-a-live-contact 422s and the dash-law lint 422; queued→cancelled; sent|replied→approved stamping approved_at ONLY, never touching the task; sent|replied→changes_requested creating the follow-up task from reply_note/reply_excerpt/generic-fallback in that order), field-edit-only-while-draft (409 once queued), and 6 illegal-transition cases (409). Plus 14 tests on `POST`/`GET /api/approval-requests` (server template + dash-law lint, contact validation, status/task_id/thread_id filters) and 17 across `[id]/sent`, `[id]/send-error` (the 3rd-error-flips-to-draft), `[id]/seen-in-meeting`, `[id]/reply`.
- [x] Dismissal: Phase 2 (classification-time suppression, covered above); the dismiss/undo ROUTE itself (`POST`/`DELETE /api/oracle/projects/[id]/dismiss` — see the Deviation note above) is Phase 5, 9 tests
- [x] Tab: `ModeTabs.test.tsx` — badge shows count only when > 0, never on a non-Projects tab; `ModeShell.flag.test.tsx` — Plan/Process hidden with shipped defaults, Projects shown
- [x] SOPs accept `needs_review` on POST/PATCH (new `needs-review.test.ts` + new `[id]/__tests__/route.test.ts`)
- [x] Notes routes (mocked prisma): list/create/soft-delete, `parked_until` sets `stale_muted_until`, deleting the ACTIVE `parked_until` note clears it, deleting a superseded one does not
- [x] Feature-flag env override: `ORACLE_HIDE_PLAN_PROCESS` reads `NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS`, only the literal `'false'` disables it

## Verification Checklist
- [x] `npx tsc --noEmit` clean
- [x] `npm run lint` clean *for this change* — the pre-existing repo baseline is 725 problems (494 errors/231 warnings, mostly `@typescript-eslint/no-explicit-any` across the whole codebase, unrelated to this feature); confirmed via `git stash -u` that this Phase 1 diff adds exactly zero new errors/warnings (497→494 and 728→725 after fixing 3 `any` uses this pass introduced). Fixing the pre-existing 725 is out of Phase 1 scope.
- [x] `npm run test:run` all green, zero known-broken — 221 files / 2,571 tests (baseline was 213/2,516; +8 files/+55 tests, all new)
- [x] `npm run build` clean — new routes (`/api/projects/[id]/notes`, `/api/projects/[id]/notes/[noteId]`) present in the route manifest
- [x] Migration applied and re-applied clean on the local DB
- [x] Route registry updated for every new route (`lib/api/registry/projects.ts`, `lib/api/registry/sops.ts`); `registry.test.ts` still green (33 tests), no new group needed (`projects` already existed)
- [x] Component library and CSS variables used per `instructions/component-library.md` — `ProjectsView.tsx` uses `EmptyState`; the Projects-tab badge uses `var(--error)`, not a raw color
- [x] Activity logging on notes create/delete (`logCreate`/`logDelete`, entity type `project_note` added to `lib/services/activity.ts`'s `EntityType` union); approve/dismiss/next-step-override logging is Phase 2/3/5 work
- [ ] Opus verifier PASS on every phase — not run by this pass (see report to Mike)
- [ ] Mike's local review and merge approval — pending

## Phase 2 Verification (2026-09-04, implementation pass, plus 3 Phase 1 follow-ups)
- [x] `npx tsc --noEmit` clean
- [x] `npm run lint` — 725 problems (494 errors/231 warnings), byte-identical to the Phase 1 baseline; this diff adds zero
- [x] `npx vitest run` — 226 files / 2,660 tests, zero failures (baseline 221/2,571; +5 files/+89 tests, all new)
- [x] `npm run build` clean — `/api/oracle/projects` present in the route manifest
- [x] Route registry updated (`lib/api/registry/oracle.ts`); `registry.test.ts` still green (33 tests)
- [x] Live read-only check against local dev + local Postgres — see the session report for the actual response summary
- [ ] Opus verifier PASS — not run by this pass
- [ ] Mike's local review and merge approval — pending

## Phase 2 Fixes — Opus verifier findings (2026-09-04, second verification pass)

An Opus verifier ran `classifyProjectBlockers`/`lastMovement` over production data (7
in-progress projects, 231 tasks) via a throwaway cross-check script and found the board
would lie in several ways. All findings below are fixed, gate-verified, and re-checked
against the same production data.

**HIGH-1 — blockers fired on done/abandoned tasks (58% of production blockers).**
`classifyDecisionAndClarification` and `classifyMentions` (`lib/oracle/projects/blockers.ts`)
now only fire for tasks whose status is one of `not_started`/`ready`/`in_progress`/
`blocked`/`review` (`OPEN_TASK_STATUSES`) — never `done`/`abandoned`. `review` already
only ever fired on `done`, so it needed no change. A mention whose task can't be found at
all is treated as not-open (fail-safe), same as done/abandoned. Production re-check:
EMDR's one done task still tagged `needs-mike` no longer produces a `decision` blocker
(confirmed against the raw production task list — it's the only such row on any of the 7
projects).

**HIGH-2 — the 30-day ActivityLog lookback corrupted `days_quiet`.**
`app/api/oracle/projects/route.ts`'s activity-log query had a
`created_at >= now - 30d` filter while the time_entries and comments queries stayed
unbounded — the moment a project's true last movement was an activity-log row between 30
and ~100+ days old, the query never fetched it and `lastMovement()` fell back to a much
older candidate (Saiph: reported 101 days quiet, true 37). Fixed by removing the lookback
entirely; all three movement sources are now unbounded and consistent with each other.
Production re-check: Saiph now reports `days_quiet: 37`, matching the verifier's
hand-computed true value.

**MEDIUM-3 — `ESCALATION_RE` substring-matched the whole comment body.**
`lib/oracle/projects/movement.ts`'s escalation check now only looks at the comment's
first sentence/line (first 160 chars up to the first `.` or newline), and a first
sentence/line that OPENS with "done"/"shipped"/"completed"/"published" (optionally after
an `@name` prefix) counts as movement regardless of anything later in the body — this
fixes the "@Mike done. ... cannot ..." shape. Separately, Bast's own activity-log
`status_changed` entries to `done`/`in_progress` now count as movement in their own
right, independent of whatever comment (if any) accompanies them — this is what actually
fixes the "...gates green, nothing blocked." shape (its first sentence still contains
"blocked" and doesn't clear the comment-path bar, but the coincident Bast status change
to done now registers on its own). Every other bot, and any Bast activity that isn't a
status change to done/in_progress, still never counts.

**MEDIUM-4 — decision/mention double-counted the same comment.**
`classifyDecisionAndClarification` now returns the set of comment ids it consumed;
`classifyMentions` skips any mention whose id is in that set. Production re-check: VCDP
(which has both `decision` and `awaiting-clarification` tags in play) now reports zero
`mention` blockers alongside its 7 `decision` + 1 `clarification` — previously the same
underlying comments would have double-counted as mentions too.

**MEDIUM-5 — session asks linked via `arc.project_id` only, orphaning both live asks.**
`app/api/oracle/projects/route.ts` now resolves a session ask's project in order: (1)
`arc.project_id`; (2) the ask's task's `project_id` — OracleSession has no `task_id`
column in this schema (only `arc_id`), so this path is structurally unavailable and
documented as such; (3) the session's client scope (`arc.client_id`) when that client has
EXACTLY ONE in-progress `type=project` project (`soleProjectByClient`, shared with the
calendar-event fix below). The arc query now also fetches arcs matching the target
CLIENT ids (not just target project ids) so path (3) has data to work with.

**Judgment call OVERTURNED — calendar-event → client linking.** The Phase 2 judgment call
of "a matched event attaches to every in-progress project of the client" is overturned:
it now attaches ONLY when the client has exactly one in-progress `type=project` project
(the same rule as the email auto-matcher), via the same `soleProjectByClient` map. A
client with zero or 2+ eligible projects gets no `meeting_risk` blocker from that event on
any of its projects.

**MEDIUM-6 — unbounded comment load + O(n²) mention scan.**
The single unbounded `comment.findMany` is now two bounded queries: (1) the last comment
per task via Postgres `DISTINCT ON` (`distinct: ['task_id']` + `orderBy` desc by
`created_at`) — feeds decision/clarification/review AND doubles as the full candidate set
for `movement.ts`'s comment source (a lossless reduction: the project's overall latest
comment is always its own task's latest comment too); (2) comments from the last 90 days
that mention Mike or are authored by Mike — feeds the mention scan. The O(n²)
`comments.some(...)` "later Mike reply" check is replaced with an O(n)
`Map<task_id, Date>` of each task's latest Mike-authored comment time. Query count stays
fixed (two comment queries instead of one, not per-task/per-project).

**MEDIUM-7 — a draft/queued `client_approval` never aged.**
`BlockerApprovalRequest` gained a `created_at` field; `since` is now
`ar.sent_at ?? ar.replied_at ?? ar.created_at` (created_at is never null, so the `now`
fallback is gone entirely).

**LOW-8 — API-only `source.url` for emails and sessions.**
Email blockers now use the EmailAsk's own `deep_link` (the Gmail message) instead of
`/email-asks/{id}`. Session-ask blockers now point at `/oracle?session={id}` (the Needs
Reshi surface, with the session id riding along as a query param for the UI to pick up
later) instead of `/oracle/sessions/{id}`.

**LOW-9 — `days_quiet: null` sorted last; `stale` ignored `stale_muted_until`.**
The sort comparator now maps a null `days_quiet` (no recorded movement, ever) to
`+Infinity` rather than `-1`, so it sorts to the TOP of the stalled bucket (quietest
first) instead of the bottom. The response's `stale` field is now computed the same way
the stale blocker itself is: `rawStale && !isStaleMuted`, where `isStaleMuted` checks
`stale_muted_until` against `now` — previously this field ignored the mute entirely.

**LOW-10 — stale docs described the old timestamp-equality behavior.**
`lib/api/registry/projects.ts`'s notes-route docs now describe the real, current
behavior: `stale_muted_until` is always `MAX(until_date)` over the project's live
`parked_until` notes, recomputed on every write — not a direct stamp/equality-match
against a single note.

**LOW-11 — email auto-match issued an identical update on every sync for unmatched rows.**
`autoMatchEmailAsk` (`app/api/oracle/email-sync/route.ts`) now takes the row's existing
`project_id` too, and short-circuits before writing whenever the computed
client/project/match_source triple already equals what's stored.

**LOW-12 — test gaps.** Added: a zero-task in-progress project (route-level, no crash, a
valid empty-blockers card); a stale-dismissal re-surface once `last_movement_at` changes
past the dismissal's marker; a mention re-surface on a NEW comment id after an earlier
mention on the same task was dismissed; a behavioral case-insensitivity test for the email
auto-matcher (an uppercase `MIKE@X.com` sender resolves through `mode: 'insensitive'` to
the correct client/project, asserted against both the mocked `clientContact.findMany`
call args and the final resolved match).

**Drift test extended — `MIKE_USER_ID`.** `gate-constants.drift.test.ts` now also greps
`MIKE_ID` out of `~/.claude/tools/citadel-worker/spawn-gate.py` (the constant has no home
in `gate.json`, but IS hardcoded there) and asserts it matches `MIKE_USER_ID`, skipping
with a clear reason when that file isn't present on the machine.

**Gates (this pass):** `npx tsc --noEmit` clean; `npm run lint` — 725 problems (494
errors/231 warnings), byte-identical to baseline; `npx vitest run` — 226 files / 2,694
tests, zero failures (+34 tests over this pass's own starting point of 2,660); `npm run
build` clean, `/api/oracle/projects` still in the route manifest. Production cross-check
(re-run of the verifier's own script against the same 7-project production snapshot,
against the FIXED code): EMDR's done task tagged `needs-mike` no longer produces a
`decision` blocker (counts: `{"review":1}` only); Saiph reports `days_quiet: 37`
(verifier's hand-computed true value, exact match); VCDP reports zero `mention` blockers
alongside its `decision`/`clarification` ones (no more double-count). `stalled_count`
across the 7-project snapshot: 6 (Forever Homes is the only non-stalled project).

## Phase 1 Notes (2026-09-04, implementation pass)

Judgment calls made while landing Phase 1:

1. **Portal default flip.** `app/api/portal/tasks/[token]/new-task/route.ts`'s hardcoded `needs_review: true` was flipped to `false`, per Mike's blanket ruling that the review-required default no longer holds anywhere. Left a one-line comment marking this as the line to revert if portal-originated (client-filed) requests should stay review-gated while everything else defaults open — that's a real, separable policy question Mike may want to revisit independently of the general default flip.
2. **Seed data now seeds `needs_review=false` implicitly.** `prisma/seed.ts` sets explicit values on its fixtures already (confirmed safe in Impact Analysis) — the default flip doesn't touch it, but any *future* seed fixture that omits `needs_review`/`is_billable` will now come in `false` instead of `true`. Not a problem today; flagging it so nobody is surprised later.
3. **`schema.postgresql.prisma` mirror is partial, by necessity.** This duplicate schema was already badly stale before this pass — it predates `EmailAsk`, `ClientContact`, `Arc`, `dependencies_ordering_only`, and is referenced by zero tooling in this repo (`package.json`'s `prisma` config and every `npx prisma` command point at `schema.prisma`). Mirrored: the `Task`/`Sop` default flips, and `Project`'s 7 new scalar fields + the `next_step_owner` relation + `NextStepSource` enum (their target models, `Task`/`Sop`/`Project`/`User`, all exist there). NOT mirrored: `ProjectNote`, `ApprovalRequest`, `BlockerDismissal`, and the `EmailAsk` columns — their related models (`ClientContact`, `EmailAsk` itself) don't exist in this duplicate, and fabricating them there would be new scope, not mirroring. Documented inline in the file itself.
4. **`app/api/oracle/email-sync/route.ts` auto-match was NOT built.** The plan's "Files to Modify" lists it, but the scope handed to this Phase 1 pass covered schema + creation-path defaults + notes routes + cleanup script + flags/shell — not the email auto-matcher. The schema is ready (`EmailAsk.client_id`/`project_id`/`match_source`, `EmailMatchSource` enum) and the manual path (`POST /api/email-asks/:id/attach {project_id}` → `match_source='mike'`) is live; the auto-matcher itself (sender → ClientContact → Client → exactly-one in-progress project) is left for whichever phase actually needs it — likely folded into Phase 2 alongside the rest of the signals API, since it's the same "read email/comment context for a project" muscle.
5. **`ModeShell`'s Projects badge is hardcoded 0 in Phase 1.** There's no signals API yet to count "projects stalled on Mike" against (`blockers.ts` is Phase 2). `projectsBadgeCount={0}` is passed explicitly so `ModeTabs` never shows a fake/stale count; Phase 2/4 wires a real hook once the count has something real to read.
6. **`ProjectsView.tsx` and `lib/hooks/use-project-notes.ts` shipped a phase early.** The plan's "Files to Create" lists both under Phase 4, but the task handed to this pass explicitly asked for the Phase 1 placeholder view now (an `EmptyState` reading "Projects" / "Phase 2 wires the data.") so the tab, the flag plumbing, and the escort-law badge exception could land and be reviewed independently of the real card/kind-lens UI — and the notes hook is the natural client-side pair to the notes routes this pass already built, so it shipped alongside them rather than sitting unused until Phase 4. Phase 4 replaces `ProjectsView.tsx`'s contents and wires the hook into the real UI; both files already exist.
7. **Lint gate.** `npm run lint` does not exit 0 on this branch — but it doesn't exit 0 on `main` either. Verified via `git stash -u` (temporarily removing every change from this pass) that the baseline is 725 problems (494 errors, 231 warnings), overwhelmingly `@typescript-eslint/no-explicit-any` spread across dozens of pre-existing files (`lib/api/formatters.ts`, `lib/hooks/use-projects.ts`, `lib/hooks/use-tasks.ts`, `types/entities.ts`, etc.) — none of it introduced by this feature. This pass's diff adds zero net-new lint problems (confirmed by diffing full lint output before/after); the 3 `any` usages this pass initially introduced in new files were fixed to use real types rather than added to the pile. Fixing the pre-existing 725 is a separate, much larger cleanup outside Oracle Projects Tab's scope.

## Phase 1 Follow-Ups Landed With Phase 2 (2026-09-04, verification pass)

**F1 — the stale-mute bug.** The Phase 1 notes routes keyed "is this the active parked_until note" on TIMESTAMP EQUALITY between the note's `until_date` and `Project.stale_muted_until`. That silently breaks the instant two `parked_until` notes share a date (deleting either one nulled the mute, even though the other still wanted it live) and had no fallback path to an older still-live park after the newest was deleted. Fixed by making `Project.stale_muted_until` a pure derived value: always `MAX(until_date)` over the project's live `parked_until` notes, recomputed from scratch inside the same `prisma.$transaction` as the note write, on every notes `POST` and `DELETE` (`lib/services/project-notes.ts`'s `recomputeStaleMutedUntil`, called from both route files). This is a real behavior change (`GET`/`POST`/`DELETE` on `/api/projects/[id]/notes[/...]`) so both existing test files were rewritten around it, adding the four scenarios named in the task: two same-dated parks, delete one -> mute unchanged; delete the last live park -> null; an older live park falls back correctly after the newest is deleted; a new, earlier-dated park never moves the mute backward (MAX still wins).

**F2 — the badge's screen-reader text.** `ModeTabs.tsx`'s stalled-count badge put its announced text in an `aria-label` on a bare `<span>` with no ARIA role — several screen readers don't reliably announce that. Replaced with a second, `sr-only` text-node span ("N projects waiting on you") next to the now-`aria-hidden` visual dot. `ModeTabs.test.tsx` updated to assert the visible dot's `aria-hidden` and the hidden text node's content/class instead of the old `aria-label`.

**F3 — the playwright.config.ts baked-flag comment.** Added a comment on the `NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS: 'false'` webServer override explaining it only works because the webServer command is `next dev` (which reads `NEXT_PUBLIC_*` per-request) — a `next build && next start` flow would bake the flag into the client bundle at build time instead, and setting it in a runtime env for `next start` would silently do nothing.

## Phase 2 Notes (2026-09-04, implementation pass)

Judgment calls made while landing Phase 2 (pure modules + the signals route + the email auto-matcher):

1. **Plan-shorthand `isWaitingOnClient(blockers)` on `movement.ts` became `ownerIsMike(blockers)` on `blockers.ts`.** The plan file's one-line Phase 2 sketch named a function `isWaitingOnClient` living on `movement.ts`; the actual task spec handed to this pass instead specified `ownerIsMike(blockers): project stalled on Mike iff any non-dropped blocker has owner.is_mike`, living alongside `classifyProjectBlockers` in `blockers.ts` (it needs the already-classified `Blocker[]`, which `movement.ts` never sees). Implemented per the detailed spec, since it supersedes the plan's shorthand; the plan's checklist item is annotated accordingly rather than silently diverging.

2. **`MIKE_USER_ID` isn't in `gate.json`.** The spawn gate's config file carries `blocking_tags`, `bot_user_ids`, and `assignee_id` (Bast's id) — but the gate itself never needs to know Mike's user id (it only ever asks "is this a bot"), so it's hardcoded in `spawn-gate.py` as `MIKE_ID`, not in the JSON. `gate-constants.ts` mirrors that hardcoded value directly; the drift test can only verify the three fields gate.json actually contains (`BLOCKING_TAGS`, `BOT_USER_IDS`, `BAST_USER_ID`) — `MIKE_USER_ID` has no live file to check itself against and would need a manual update alongside any future change to `spawn-gate.py`'s `MIKE_ID`. Documented inline in `gate-constants.ts`.

3. **Movement is passed into `blockers.ts` as a precomputed timestamp, not recomputed there.** `classifyProjectBlockers` takes `last_movement_at: string | null` rather than importing `movement.ts` and re-deriving it — the route calls `lastMovement()` once per project and threads the result into both the `stale`/`response.last_movement` field and the blockers classifier input, keeping `blockers.ts` pure/simple and guaranteeing the "last movement" the response shows and the one driving the `stale`/`meeting_risk` blockers can never disagree.

4. **Calendar-event -> client linking is by attendee-email match against `ClientContact`, not a first-class relation.** `CalendarEvent` has no client/project column (Google Calendar sync doesn't carry one). The route fetches every `ClientContact` for the in-progress projects' clients, fetches every `CalendarEvent` in the next-3-days window, and matches by lower-cased attendee email against contact email. A matched event is attached to **every** in-progress project of that client — there is no data path from "this meeting is about" to a specific project when a client has more than one live project. This is a real gap or edge case Mike should be aware of on multi-project clients; documented in the route's own doc comment.

5. **Session asks are linked to a project via `Arc.project_id` only.** `OracleSession` has no `task_id` column (only `arc_id`), so "asks link to projects via arc.project_id or task.project_id" resolves in practice to just the arc path for session asks specifically — a session ask with no arc, or an arc with no project, never surfaces as a Projects-tab blocker (it still shows up in the general `/api/waiting-on-me` feed). The waiting-on-me sweep was NOT refactored into a shared loader; this route re-queries `OracleSession` scoped by `arc_id IN (...)` directly — a different filter shape than the existing global endpoint, and duplicating one small query was judged lower-risk than touching a live, heavily-tested route for a two-field reuse. **Stated plainly (Phase 3 carry-over C1):** an ask reaches the Projects tab only when its session declared an arc. `OracleSession` has no client/project column of its own to fall back to, so an arc-less ask is not a bug to fix here — it stays in Needs Reshi, permanently, by design. `route.ts` keeps the `if (!s.arc_id) continue` check as a documented, tested fail-safe even though the query already filters to `arc_id IN (arcIds)`.

6. **`EmailAsk.replied` is `state !== 'open'` only — not "a later Mike reply in the thread."** This schema has no table recording Mike's own outbound replies against an `EmailAsk` (the model only stores inbound asks the classifier flagged); there is no data source to check "did Mike reply in this thread" from. `state` is the only available proxy, and it's a reasonable one (Mike marking an ask handled/dismissed/archive-requested is itself evidence he's dealt with it) but it is not literally what the spec text describes. Flagging this explicitly rather than letting it look like a data-complete implementation.

7. **The email auto-matcher's "never downgrade `auto`" rule reads "contact mapping changed" as "the resolved CLIENT changed."** The spec says never downgrade an existing `auto` match "unless the contact mapping changed" without defining that phrase precisely, and `EmailAsk` doesn't store which `ClientContact` row resolved the match, only the resulting `client_id`. Implemented as: if the sender's contact still resolves to the SAME `client_id` already stored, the match is left exactly alone — even if the client's set of eligible in-progress projects has since shrunk to zero or grown to two+ (a project finishing or a new one starting is not a "contact mapping" change). Only a genuine change in which client the sender's contact belongs to triggers recomputation (and possible downgrade to `unmatched`).

8. **A sender whose email resolves to 2+ different clients' contacts is treated as `unmatched` with `client_id: null`.** The spec's three named outcomes (auto / one-client-but-wrong-project-count -> unmatched / no-contact -> untouched) don't explicitly cover a `ClientContact` email shared across multiple clients (e.g. an agency contact). Since there's no principled way to pick one, this case sets `match_source: 'unmatched'` and leaves `client_id` null rather than guessing — distinguishable in the data from the "one client, ambiguous project" unmatched case only by `client_id` being null vs. set. Not one of the four required tests, but the code path exists and is documented here.

9. **Business-day arithmetic for the approval-chase overdue check is Mon-Fri only, no holiday calendar.** `chase_after_days` counts calendar weekdays between an `ApprovalRequest.sent_at` and now; US holidays aren't excluded. A fixed simplification, not something this pass tried to solve generally.

10. **`next-step-candidate.ts`'s status filter keeps the literal `'ready'` value from the spec text even though no `Task` in this schema can carry it.** `TaskStatus` has no `ready` value (`not_started`/`in_progress`/`review`/`done`/`blocked`/`abandoned`); a task whose blockers are all done is already auto-unblocked back to `not_started` by the existing `lib/services/dependencies.ts` healing logic, so in practice this only ever matches `not_started`. Kept `'ready'` in the allowed-status set anyway since it's free and future-proof (matches the spec text exactly, would just start working if that status value is ever added).

11. **The live read-only check against `GET /api/oracle/projects`** (dev server, local Postgres, bearer token from `~/.citadel-token`) is reported in the session's final summary rather than duplicated here — see the response summary (project names, `stalled_count`, `counts_by_kind` per project) captured at verification time.

## Phase 2 Verification Carry-Overs, Landed With Phase 3 (2026-09-04)

Five findings from the Phase 2 verifier's second pass, fixed before Phase 3's own scope:

**C1 — session-ask arc-less documentation.** `route.ts`'s `if (!s.arc_id) continue` (the
session-ask loop) is normally unreachable — the query above it already filters to
`arc_id IN (arcIds)` — but is kept as a documented, tested fail-safe rather than deleted.
Stated plainly in the route's module doc comment, the `oracle` registry note, and Phase 2
Note 5 above: an ask reaches the Projects tab ONLY when its session declared an arc.
`OracleSession` has no client/project column of its own to fall back to, so an arc-less
ask is not a bug — it stays in Needs Reshi (`/api/waiting-on-me`), permanently, by
design. New test: a session with `arc_id: null` never produces a `session_ask` blocker.

**C2 — the "Postgres DISTINCT ON" comment was false.** The last-comment-per-task query
used Prisma's `distinct: ['task_id']`, which is applied CLIENT-SIDE (Prisma fetches every
matching row, then reduces in the query engine) — confirmed by inspecting the actual SQL
Prisma issues. Replaced with a REAL `SELECT DISTINCT ON (task_id)` via `prisma.$queryRaw`,
parameterized with `Prisma.sql`/`Prisma.join`. Tested with the mocked prisma shape
(`$queryRaw` mocked directly).

**C3 — movement missed human comments buried under a later Bast comment (verifier
LOW-C).** Movement's comment source used to be the SAME last-comment-per-task set the
blockers classifier uses — so a human's comment was invisible to `lastMovement()` the
instant a later Bast comment landed on the same task. Movement now has its OWN query:
every comment by a non-bot user on the project's tasks in the last 90 days (not
newest-per-task). New test: a human comment older than a later Bast comment on the same
task still counts as movement (the Bast comment, correctly, doesn't — it's filtered out
of this feed entirely; Bast's own progress still counts via the activity-log path).

**C4 — Bast `status_changed` credit narrowed to `done` only.** `movement.ts`'s
`PROGRESS_STATUSES` was `{done, in_progress}`; a Bast status change to `in_progress`
isn't itself completed movement (a task can be flipped back with nothing shipped) and no
longer independently credits Bast, whether via the activity-log path or the
comment-coincidence path. One existing test's fixture (`in_progress` paired with a
"done"-opening comment) was updated to `done` to preserve its actual intent; two new
tests assert `in_progress` alone, and `in_progress` paired with a comment, both now
produce no movement.

**C5 — the 90-day mention/movement window is now documented and boundary-tested.** The
`oracle` registry note states plainly that the mention scan and the movement comment feed
share the SAME 90-day lookback. New tests: a comment mentioning Mike 91 days ago produces
no mention blocker; the same comment at 89 days does.

Gates after these five fixes (before Phase 3's own routes existed): `tsc` clean; lint
byte-identical to baseline; `vitest run` 226 files / 2700 tests (+6 over the 2694
baseline), zero failures.

## Phase 3 Notes (2026-09-04, implementation pass)

Judgment calls made while landing Phase 3:

1. **Route split diverged from this plan's original one-line Phase 3 sketch.** The
   sketch put PATCH and a refresh-one POST on the same `next-step` route file, returning
   a job id. The actual task spec (superseding the sketch, same precedent as Phase 2's
   `isWaitingOnClient`/`ownerIsMike` note) put refresh-one on its own route
   (`[id]/refresh/route.ts`), returning 202 `{requested_at}` with no job id concept — the
   "job" is just "a project with `next_step_refresh_requested_at` set," polled by the
   `--requested` cron, not a tracked async job record.

2. **PATCH/DELETE next-step are PM/Admin; the write route and refresh-requests are any
   authenticated user (bearer).** The two Mike-facing actions (override, clear) and the
   two Mike-triggered refresh requests (single, all) are role-gated the same way every
   other Mike-action route in this feature is. The two machine-only endpoints (the write
   route the job PUTs to, and the poll's GET) are not role-gated at all — matching the
   existing convention on `/api/oracle/email-sync` and `/api/session-tasks` (same
   `requireAuth()` util, cookie session OR API key, no bot-only restriction).

3. **Mike's override is checked at WRITE time, not at enqueue time.** A `POST .../refresh`
   queues a refresh regardless of whether Mike currently owns the line — the machine-side
   job always runs and always calls the write route; the write route itself is what
   refuses to overwrite `next_step_text`/`owner`/`source`/`at` when
   `next_step_source === 'mike'` (still writing `email_summary` either way). This means a
   refresh triggered on a Mike-overridden project still costs a `claude -p` call whose
   next-step half is discarded — accepted, since the alternative (checking source before
   even queuing) would require the UI to know the current source at click time, which it
   already does display-side but shouldn't need to re-derive to decide whether a button
   click "counts."

4. **owner_id and owner_label are mutually exclusive by Zod refinement, not a DB
   constraint.** The schema allows both columns to be non-null simultaneously; every
   write path (PATCH, DELETE, the write route) enforces exclusivity in application code.
   A future direct-SQL write bypassing these routes could violate this — flagged, not
   solved, since Postgres has no clean way to express "at most one of two nullable
   columns" as a `CHECK` without a function-based constraint the team doesn't use
   elsewhere in this schema.

5. **The write-route lint rules are the same four `comment-gate.sh` grep patterns, ported
   verbatim, not re-derived.** `lib/oracle/projects/next-step-lint.ts` intentionally does
   NOT port the shell script's word-count cap (`words > 150`) — `next_step_text` already
   has its own shape (1-500 chars, prompt-instructed to under 30 words) enforced
   elsewhere, and re-adding an unrelated 150-word cap on top would just be confusing dead
   weight for a field that's never anywhere near that long. `email_summary` (2000 chars)
   is linted with the same four checks but no separate length rule beyond its own column
   cap. The four checks are case-sensitive, matching the shell script's plain `grep -noP`
   (no `-i`) exactly — verified empirically against the real `comment-gate.sh` (a
   lowercase-only pattern like `\bran W\b` doesn't match `"Ran W3"`, in the port or the
   original).

6. **The poll's cost model: near-zero when idle, one `claude -p --model sonnet --effort
   medium` call per queued project when not.** `--requested` runs every 2 minutes,
   6am-11pm (510 ticks/day) — each tick is ONE `GET /api/oracle/projects/refresh-requests`
   (a single indexed `WHERE next_step_refresh_requested_at IS NOT NULL` query) and, on an
   empty result (the overwhelming majority of ticks — refreshes are triggered by a
   button, not continuously), the script exits immediately with no further network or
   `claude` calls at all. The nightly `--all` run is the real cost driver: one `claude -p`
   call per in-progress project (7 in-progress projects in production at verification
   time), once per night, plus up to one retry per project when the writing-standard gate
   fires. Observed cost per project is reported in the Gates section below (this pass's
   local + production dry-run numbers) — no aggregate daily-cost estimate is claimed here
   beyond that arithmetic, since it scales directly with however many projects are
   in-progress on a given night.

7. **The machine-side job fetches ALL email-asks per run, filtering client-side by
   `project_id`, rather than adding a `project_id` query param to `GET /api/email-asks`.**
   That route isn't in this phase's route list, and adding a filter to it was judged
   real scope creep for a job that runs at most every 2 minutes (and usually far less
   often, given the empty-queue fast path above) — not a hot path. Fetched ONCE per run
   and reused across every target project (not re-fetched per project) to bound the
   actual request count regardless of how many projects `--all` covers. Flagged as the
   first place to add real filtering if `email_asks` ever grows large enough for this to
   matter.

8. **`next_step_refresh_requested_at` is left SET on a second gate failure.** The task
   spec says "on a second failure write nothing for that project and log it" — it doesn't
   say to clear the request flag. This is deliberate: leaving it set means the NEXT
   `--requested` poll (or the next `--all` night) retries automatically rather than
   silently dropping the request forever. The tradeoff is a project that keeps failing
   the gate stays in the queue indefinitely, spending one `claude -p` call (well, two,
   with the retry) every poll cycle until either the underlying prompt/data issue is
   fixed or Mike notices in the ledger. Not solved further in this pass — a real backoff
   or max-attempts rule is a reasonable Phase 4+ follow-up if it proves noisy in
   practice.

## Phase 3 Gates (2026-09-04, implementation pass)

- [x] `npx prisma migrate deploy` on local Postgres, clean; `prisma db execute` re-run of the Phase 3 migration file exits 0 (idempotent)
- [x] `npx tsc --noEmit` clean
- [x] `npm run lint` — 725 problems (494 errors/231 warnings), byte-identical to the Phase 1/2 baseline; this pass adds zero
- [x] `npx vitest run` — 232 files / 2751 tests, zero failures (baseline going in: 226/2694; +6 files/+57 tests — the 5 carry-over test additions plus every new Phase 3 test file)
- [x] `npm run build` clean — all 6 new routes present in the manifest (`/api/oracle/projects/[id]/next-step`, `.../write`, `/api/oracle/projects/[id]/refresh`, `/api/oracle/projects/refresh`, `/api/oracle/projects/refresh-requests`)
- [x] `python3 -m unittest discover -s ~/.claude/tools/citadel-projects/tests -v` — 9 tests, all green (fake HTTP server + fake `claude` binary)
- [x] `DRY_RUN=1 next-step-refresh.sh --all` against PRODUCTION — the Citadel bearer token and base URL are confirmed live (`GET /api/docs` and `GET /api/tasks` both 200), but `GET /api/oracle/projects` 404s: this whole feature (Phase 2's own signals route included) is on an unmerged branch, never deployed to `main`/production. The script's failure mode here is exactly right — one clean read-only GET, a `FATAL` log line, exit 1, zero `claude` calls, zero PUTs. This gate cannot exercise the full per-project plan against real production data until the branch merges; documented rather than faked.
- [x] `DRY_RUN=1 next-step-refresh.sh --all` against the LOCAL dev server (2 in-progress projects) — printed both projects' id, prompt char count (1616/1646 chars), and open task/comment/email/note counts; zero PUT requests reached the server (grepped the dev server log).
- [x] ONE real run, LOCAL dev server, `--project <local id>` (`next dev`, a temporary admin API key minted the same way `seed.ts` mints the Oracle service key, revoked immediately after): wrote `next_step_text: "Assign an owner and implement the contact form for Website Redesign."`, `owner: null`, `source: "bast"`; `refresh_requested_at` confirmed cleared on re-fetch. Cost **$0.0086** (Sonnet, medium effort). Ledger row confirmed at `~/.model-ledger/runs.jsonl` (`source: projects-next-step`, `outcome: pass`).

**Two real bugs, both caught only by this live run (not by the mocked vitest/unittest suites) and fixed before this pass closed:**

1. **C2's raw SQL 500'd on every real call.** `c.task_id IN (${Prisma.join(taskIds)})` compares a `uuid` column against text-typed bound parameters — Postgres has no `uuid = text` operator, so this failed with `42883` the instant it hit a real database (the mocked route test never runs real SQL, so it stayed green through this bug). Fixed by casting the column: `c.task_id::text IN (...)`.
2. **The write route rejected every real PUT from the job.** `generated_at: now.isoformat()` in Python emits `+00:00` for a UTC timestamp; the write route's Zod `.datetime()` only accepts the literal `Z` suffix (RFC 3339), so the first real run 400'd. Fixed with an `iso_z()` helper (`...isoformat().replace("+00:00", "Z")`); a regression test (`test_generated_at_matches_the_write_route_zod_datetime_shape`) locks this in at the unit level, since the fake HTTP server's original PUT handler didn't validate the field's format the way the real Zod schema does.

Both fixes are included in the numbers above (final `tsc`/lint/vitest/unittest runs all happened after both fixes landed).

## Phase 3 Verification Fixes (2026-09-04, Opus verifier cross-check)

A second Opus verification pass, run against the real skill file, the real local dev
server, and real production reads, found and this pass fixed:

- **HIGH-1 — the writing-standard rule blocks the job sent to the model were the wrong
  text.** `_extract_block`'s non-greedy, attribute-less regex landed on SKILL.md's own
  doc-mention sentence ("extract each `<writing-rules>...</writing-rules>` span")
  instead of the real `<writing-rules src="writing-standard">` block a few lines below
  it — the prompt sent to Sonnet carried literally `"..."` for both rule blocks, on
  every run, since Phase 3 landed. Fixed: match only a tag carrying `src="..."`, take
  the LAST such match, and assert each captured block has ≥5 numbered lines;
  missing/short/malformed now aborts the whole run (exit 2) before any network call or
  model spend, rather than degrading silently. Also tightened the prompt: removed the
  "if no single person clearly owns it, both owner fields are null" escape hatch (owner
  is now required — a User id, a `"Name (role)"` label, or `"Unassigned"` with a stated
  reason), added explicit "don't restate the project or client name" and "one job per
  sentence, never two actions joined by and/then" instructions, and added a heuristic
  post-check (`check_next_step_quality`, name-restatement + curated-verb "and"/"then"
  detection) that runs alongside the writing-standard lexical gate and triggers the same
  rewrite-once path. Proven against the verifier's own bad output ("Assign an owner and
  implement the contact form for Website Redesign.") — that exact line now fails the new
  check and gets rewritten.
- **HIGH-2 — a failed sub-fetch (tasks/comments/notes/email-asks) still ran the model
  and wrote a partial-data result, logged as a pass.** Every fetch helper now returns
  `(data, error)`; any failure anywhere in `build_project_context` marks the project
  context-incomplete, skips the model call and the write entirely, and logs outcome
  `skipped_incomplete_context` (exit code unaffected — this is not a job failure). A
  failed `/api/email-asks` fetch (shared across all target projects in a run) marks
  EVERY target project incomplete for that run. On the write route,
  `PUT .../next-step/write` now checks the RAW request body for whether the
  `email_summary` key is present at all: absent leaves the stored value untouched,
  present-with-`null` clears it, present-with-a-string replaces it — previously
  `data.email_summary ?? null` treated "key omitted" identically to "key sent as null."
- **MEDIUM-1 — `--requested` was fetching the full signals route on every 2-minute
  tick.** Restructured `main()`: `--requested` calls ONLY `GET .../refresh-requests`
  first; on an empty queue (the overwhelming majority of ticks) that is the single
  network call the run makes. When something IS queued, project details are fetched
  with a new `ids=` filter on `GET /api/oracle/projects?ids=...` (added to the route;
  every downstream signal query in that route is already keyed off the project set it
  loads, so filtering the top query scopes everything under it) rather than the full
  in-progress listing. `--all` still uses the signals route once, unfiltered. Crontab
  comment corrected to describe the fixed cost model.
- **MEDIUM-2 — the C2 fix's `c.task_id::text IN (...)` cast defeats the btree index on
  `comments.task_id`.** Casting a column forces Postgres to evaluate the cast per row
  (sequential scan); fixed by casting the PARAMETER instead —
  `c.task_id = ANY(${taskIds}::uuid[])` — so the comparison stays uuid-to-uuid and the
  index is usable. Proven with `EXPLAIN` under `SET enable_seqscan=off` against the
  local DB: the plan shows `Bitmap Index Scan on comments_task_id_idx` /
  `Index Cond: (task_id = ANY ($0))`, not a sequential scan. A new integration test
  (`app/api/oracle/projects/__tests__/last-comment-distinct-on.integration.test.ts`,
  skips with no `DATABASE_URL`) seeds 3 tasks × 3 comments against the real local
  Postgres, asserts `DISTINCT ON` returns the newest comment per task, asserts the
  index is used under `enable_seqscan=off`, and cleans up every row it created.
- **MEDIUM-3 — added the drift test.**
  `lib/oracle/projects/__tests__/next-step-lint.drift.test.ts` runs 12 sample lines
  (2 clean, one per grep rule category, plus the four dash-law variants) through both
  `next-step-lint.ts` and the real `comment-gate.sh` (subprocess; skips with no shell
  script present) and asserts identical pass/fail verdicts on every one.
- **MEDIUM-4 — a broken `CITADEL_NEXT_STEP_CONFIG` silently fell back to production.**
  `load_config()` now returns `(cfg, error)`; a set-but-unreadable/invalid override
  aborts the run (exit 2) with the reason, rather than quietly using production
  defaults when a local/test override was clearly intended.
- **LOW-a/b — a 404 (feature not deployed) or other quiet failure (401/5xx) at the top
  of `main()` used to log a FATAL line and exit 1 on every single poll tick.** New
  `_fatal_or_quiet` classifies 401/404/5xx as cron-quiet-by-contract: logged once per
  hour (state file `~/.local/state/next-step-refresh-notdeployed`), exit 0. A real
  connection failure or malformed response (no HTTP status at all) stays a loud,
  every-time exit-1 FATAL. Verified against production: the live `--requested` run
  (this feature's routes are all still on this unmerged branch) made exactly one GET,
  logged one `NOTDEPLOYED:` line, and exited 0.
- **LOW-c — `recent_project_comments` could make up to 200 HTTP requests per project.**
  Scoped to open tasks (always) plus tasks updated within the last 90 days, capped at
  `MAX_COMMENT_SCAN_TASKS` (50) total, most-recently-updated first.
- **LOW-d — next-step PATCH/DELETE activity-log entries hardcoded `from: null` (PATCH)
  or `from: 'mike'` (DELETE).** Both routes now select and log the project's actual
  prior `next_step_text`/`next_step_source`.
- **Unrelated bug caught only by the live local-run gate:** `OPEN_TASK_STATUSES`
  included `'ready'`, which is not a value of the `TaskStatus` enum — every real call to
  `GET /api/tasks?statuses=...` 500'd, meaning every real run of this job, since Phase 3
  landed, would have hit HIGH-2's new context-incomplete path and never written a single
  next-step line. Removed `'ready'` from the constant (same limitation
  `next-step-candidate.ts` already documents).

**Gates re-run after these fixes:**

- `npx tsc --noEmit` — clean.
- `npm run lint` — 725 problems (494 errors/231 warnings), byte-identical to the Phase
  1/2/3 baseline.
- `npx vitest run` — 234 files / 2773 tests, zero failures (+2 files/+22 tests over the
  232/2751 Phase 3 baseline: the drift test file, the MEDIUM-2 integration test file,
  and new/updated assertions across `route.test.ts`, the next-step write-route test, and
  the next-step PATCH/DELETE test).
- `npm run build` — clean; all 6 routes present in the manifest.
- `python3 -m unittest discover -s ~/.claude/tools/citadel-projects/tests -v` — 38
  tests, all green (was 9; +29 covering HIGH-1/HIGH-2/MEDIUM-1/MEDIUM-4/LOW-a/b/c).
- `EXPLAIN` under `SET enable_seqscan=off` (local DB) on the fixed query: plan includes
  `Bitmap Index Scan on comments_task_id_idx` / `Index Cond: (task_id = ANY ($0))`.
- `DRY_RUN=1 next-step-refresh.sh --all --print-prompt` against the LOCAL dev server (2
  in-progress projects): printed both projects' full prompt on the first; both the
  `<writing-rules src="writing-standard">` (8 numbered lines) and
  `<comment-rules src="writing-standard">` (7 numbered lines) blocks are present and
  complete, no `"..."` placeholder. Zero PUTs.
- ONE real run, LOCAL dev server, `--project 1ed657c7-6e43-473b-8910-ad20fde9d4e4`
  (Website Redesign; temporary admin API key minted the same way `seed.ts` mints the
  Oracle service key, revoked and deleted immediately after): wrote
  `next_step_text: "Assign an owner to build the contact form, since it's not started
  and unassigned."`, `owner_label: "Unassigned"`, `source: "bast"`. No project name
  restated, one job, passes `comment-gate.sh` (exit 0) and this pass's own reading.
  Cost **$0.0883** (Sonnet, medium effort) — the plan's earlier $0.0086 note was a
  single sample; observed cost across this pass's local runs ranges roughly
  $0.009-$0.09 per project depending on context size, confirming there is no fixed
  per-project cost.
- Live `--requested` run against PRODUCTION (default config, `~/.citadel-token`,
  GET-only): `GET /api/oracle/projects/refresh-requests` → 404 (this feature is still
  unmerged), exactly one network call, one `NOTDEPLOYED:` line, exit 0.
- `crontab -l` diff: comment-only change on the `--requested` poll line, documenting the
  fixed cost model. Backup of the prior crontab saved to
  `~/.local/state/crontab-backups/crontab-backup-20260904-164321` before installing.

## Phase 3 Carry-Overs (K1-K5), landed with Phase 4 (2026-09-04)

A separate handed-off task spec (not this plan file) named five small carry-overs from
the Phase 3 verifier, done first because they're small and touch the machine-side job
that's already live on cron. All five are implementation, gate-verified, no separate
Opus verification pass run on them yet.

**K1 — job prompt nudge (next-step-refresh.py).** Three changes, all in the prompt/
quality-gate layer, none in the write route:
1. Added "Do not restate status, assignee, dates, or anything else the card already
   shows — say only what the reader must do next" to `build_prompt`'s next_step_text
   instructions, next to the existing project/client-name-restatement line.
2. "Unassigned" is now framed as a LAST RESORT in the prompt: the model is told to
   prefer naming who should assign the work instead (e.g. "Mike, assign the contact
   form to someone this week") and, if it still returns `owner.label: "Unassigned"`,
   its `reason` must be at least 12 words or the reply is treated as a quality
   violation and gets the same one-rewrite-then-fail path as every other check
   (`_unassigned_without_reason`, wired into `evaluate_reply`).
3. **Heuristic fix, `_has_two_imperative_clauses`:** added a lookahead requiring a real
   whitespace/punctuation/end-of-string boundary immediately after the captured
   verb — `[A-Za-z]+` alone stops at a hyphen regardless, so "and sign-off" used to
   capture "sign" (in the curated verb list) and flag a hyphenated NOUN as if it were a
   second imperative clause; same for a hyphenated "test-environments" capturing
   "test". The fix makes the regex simply not match those hyphenated compounds at all.
   12 new tests cover both the false-positive fix and that genuine two-clause
   sentences ("Reply... and confirm...", "Ship... then deploy...") still flag.

**K2 — quiet log.** `next-step-refresh.sh` used to write a `start:`/`exit N` pair to
the log on every invocation, including the overwhelming majority of the `--requested`
poll's ~510 ticks/day that find nothing queued. Rewritten to capture the python
script's combined stdout/stderr first, then write nothing at all when the run exited 0
with empty output OR with exactly the "no refresh requests queued — exiting" line —
any other outcome (a real OK/FAIL/RETRY line, a NOTDEPLOYED throttle line, a non-zero
exit) still gets the full start/output/exit treatment.

**K3 — deployment safety.** Added `~/.claude/tools/citadel-projects/deploy.sh`: takes
`flock ~/.local/state/next-step-refresh.lock`, backs up whatever live
`next-step-refresh.py`/`.sh` it's about to replace to
`~/.local/state/next-step-refresh-backups/<file>.<timestamp>`, copies the `.next`
staging files into place, and `py_compile`/`bash -n`s the result. Both live files' own
doc comments now say edits go to the `.next` copy, never in place. This pass's own K1/
K2 edits were made in `next-step-refresh.py.next`/`.sh.next`, verified (the full 50-test
suite green against a temp copy) BEFORE running `deploy.sh` for real, matching the tool's
own intended workflow.

**K4 — crontab backup ritual redone.** The crontab backup file
`~/.local/state/crontab-backups/crontab-backup-20260904-164321` (written at the end of
Phase 3) no longer matched the live crontab — a `diff` found the `--requested` poll
line's comment had been hand-edited since (documenting the MEDIUM-1 cost-model fix)
without a fresh backup being taken. Wrote a new dated backup
(`crontab-backup-20260904-170042`) from the CURRENT live crontab, installed it from that
file (a verified no-op — `diff` after install shows zero difference from the backup),
and kept it.

**K5 — app-side status validation.**
- `lib/oracle/projects/blockers.ts:197`'s `OPEN_TASK_STATUSES` Set had `'ready'` in it,
  which is not a value of the Prisma `TaskStatus` enum (this is exactly the bug K1's
  own job hit before its Phase 3 fix — a bare `ready` sent as a task status 500'd every
  real call). Removed it (no test in this repo asserted its presence) and left a
  warning comment on the constant explaining why a non-enum value must never be sent as
  a query value.
- `GET /api/tasks?statuses=...` now validates every comma-separated value against the
  real `TaskStatus` enum and 400s with the offending value(s) named, instead of silently
  passing an invalid status straight into `status: { in: statusList }` (which Prisma
  would just quietly match zero rows against). Two new tests.
- `GET /api/oracle/projects?ids=...` now validates every id as a uuid (`z.string().uuid()`)
  and 400s on the first invalid one, instead of the same silent-empty-match failure
  mode. Two existing tests that used non-uuid placeholder ids (`proj-a`, `proj-b`) were
  updated to real uuid-shaped values; two new tests cover the 400 path.
- Plan cost paragraph (referenced by the handed-off task spec): the Phase 3 Gates
  section's two real local runs cost $0.0086 and $0.0883 respectively — the task spec's
  shorthand for this range is "$0.01 to $0.09 per project observed." At 7 in-progress
  projects (the production count at Phase 2/3 verification time), one nightly `--all`
  pass costs roughly 7 × $0.09 ≈ $0.62 worst-case, materially less on a typical night
  since $0.09 was the higher of two observed samples, not a fixed cost — see Phase 3's
  own note 6 (no fixed per-project cost, scales with in-progress project count and
  context size).

**Gates (K1-K5):**
- `python3 -m unittest discover -s ~/.claude/tools/citadel-projects/tests -v` — 50
  tests, all green (was 38; +12 covering the K1 prompt/heuristic/Unassigned changes).
  Run once against the `.next` staging files (temp-copied, before deploy) and once
  again against the live files after `deploy.sh` — identical result both times.
- `npx tsc --noEmit` — clean.
- `npm run lint` — 725 problems (494 errors/231 warnings), byte-identical to the Phase
  1/2/3 baseline.
- `npx vitest run` — included in the Phase 4 Gates totals below (K5's app-side changes
  and Phase 4's UI landed in the same pass).
- `crontab -l` diff against the new backup — zero difference (verified no-op install).
- `~/.claude/tools/citadel-projects/deploy.sh` — ran for real: backed up both live
  files, deployed both `.next` staging files, `py_compile`/`bash -n` both clean.

## Phase 4 Notes (2026-09-04, implementation pass)

**Card anatomy — six elements shipped, not five.** The spec's card-anatomy bullet
lists client name, project name, next-step sentence (with source hint), owner chip,
last-movement sentence, AND blocker-count chips — six pieces of information. The Gates
section's "five elements" phrasing (for the screenshot judgment) is read as the five
distinguishing TEXT elements (client, project, next step, owner, movement); the chip
row is real and tested but treated as a bonus/secondary element in that specific count,
not a contradiction of the six-item card anatomy the component actually renders.

**Next-step source hint.** `nextStepStamp()` (in `ProjectCard.tsx`, not exported to
`projects-logic.ts` since it's presentational, not pure business logic) maps
`next_step.source` to the three variants the spec names: `mike` → "Mike's own", `bast`
→ "Bast, {local time}" (from `next_step.at`), `graph` → "graph". `source: 'none'` (no
ready task, no override, no machine write yet) shows no stamp — there's nothing to
attribute the fallback message to.

**BlockerRow's "reply" action is enabled ONLY for task-sourced blockers.** The Blocker
data model gives `reply` as an available action on decision, clarification, mention,
session_ask, AND client_email kinds — but session_ask's `source.type` is `'session'`
and client_email's is `'email'`, neither of which is a task id `POST /tasks/:id/
comments` can target. Rather than build a second, different "reply" mechanism for
those two source types in this pass (a session reply and a real client-email SEND are
both meaningfully Phase-5-shaped — the email one explicitly needs the approval-request/
Gmail-sender infrastructure that phase builds), BlockerRow only wires `reply` when
`blocker.source.type === 'task'` (decision, clarification, mention). A session_ask or
client_email blocker's `reply` action currently renders nothing (not even a disabled
button) rather than a Phase-5 placeholder — flagged here as a real gap, not silently
dropped: Phase 5 needs to either build the session/email reply flows or explicitly add
them to the disabled-with-tooltip set.

**Row-level actions beyond the K bullet's explicit list (`mark_approved`, `resolve_ask`,
`refresh_next_step`, `suspend`) are rendered disabled-with-tooltip, same as dismiss/
nudge/send_approval.** The task spec named "dismiss/nudge/send-approval" as the
Phase-5-deferred set; these four aren't named either way. Judgment call: treated as
deferred too, since none has a real route/mutation to call yet in this repo (the
next-step drawer's own "Refresh" button already covers the on-demand next-step
refresh use case at the project level — a second, row-level refresh control for
meeting_risk/stale blockers was judged redundant UI, not a missing feature).

**No separate `use-pick-to-arc.ts` hook.** The plan's Phase 1 line flagged this hook as
"still Phase 4." It wasn't added as its own file: the pick flow is a short SEQUENCE of
existing, already-tested mutations (optionally `useCreateTask`, optionally
`useCreateArc`, optionally `useUpdateTask` for the arc attach, then one
`useCreateTodayPick`) with error handling that's naturally per-step (the plan/gate
builder in `projects-logic.ts` — `buildSinglePickPlan`/`buildMultiPickPlan` — already
carries the "what to do, in what order" logic, independently pure-tested). Wrapping
that sequence in one new orchestration hook would mostly just relocate the same
`PickToArcDialog.tsx`/`KindLens.tsx` code into a hook file for no behavioral gain in
this pass; flagged as a candidate to extract if Phase 5's approval loop or a future
caller needs the same sequence a third time.

**PickToArcDialog vs. KindLens's own inline "New arc…".** These are deliberately two
different UIs for two different situations, not a shared component: `PickToArcDialog`
(opened from a single `BlockerRow`'s "Pick" action) lets the user choose no-arc /
an existing open arc / a brand-new one, and shows the WIP-cap warning + verbatim 409
up front, per the spec's own description of that dialog specifically. `KindLens`'s
multi-select action bar's "New arc…" is a plain inline name input (default = heading +
date) that always creates a new arc — the spec's KindLens bullet describes exactly this
inline control, with no "choose an existing arc" option in the bulk case. Reusing
`PickToArcDialog` there would have added an existing-arc choice the spec never asked
the bulk flow to have.

**Dismissed items section is an honest placeholder.** `BlockerDismissal` (the model)
and its dismiss/undo routes are Phase 5 work per the plan's own file list. The
drawer's collapsed "Dismissed items" section renders and expands correctly but shows a
"coming in the next pass" message rather than a fabricated or always-empty list —
there is no dismissed-items data in this phase's API response to show.

**BlockerRow's tag-clear fetches the task's current tags fresh at submit time, not from
a separately-rendered `useTask()` hook.** The first real e2e run against a live local DB
caught this: `useTask(taskId, {enabled: canClearTag})` sometimes hadn't resolved yet by
the time the user finished typing and clicked submit (a real race, invisible to the
component-mocked vitest suite, which mocks the hook's return value directly and so can
never observe an unresolved-promise window) — the code's `if (parkingTag && task)` guard
silently skipped the tag PATCH whenever `task` was still `undefined`, so the reply sent
but the tag never cleared. Fixed by fetching the task directly via `apiClient.get`
inside `submitReply`, right before building the PATCH body — removes the render-timing
dependency entirely. `BlockerRow.test.tsx` was updated to mock `@/lib/api/client`
instead of `useTask`.

**Checkbox and Tooltip got small, backward-compatible extensions.** `components/ui/
checkbox.tsx` now spreads `...rest` button props (so `aria-label` reaches the DOM —
without it, KindLens's per-row/per-heading checkboxes had no accessible name at all,
since the component only forwarded a fixed prop list before). `components/ui/
tooltip.tsx` was NOT changed — its hover/focus-only visibility meant the disabled
Phase-5 action buttons in `BlockerRow.tsx` additionally carry a native `title`
attribute (redundant with the `Tooltip` wrapper) so both the browser's own tooltip and
jsdom-based tests can read the "coming in the next pass" text without simulating a
real hover.

## Phase 4 Gates (2026-09-04, implementation pass)

- [x] `npx tsc --noEmit` — clean.
- [x] `npm run lint` — 725 problems (494 errors/231 warnings), byte-identical to the
  Phase 1/2/3 baseline; this pass (K5 + Phase 4 combined) adds zero. Two real new-lint
  issues surfaced and were fixed during this pass, not left as noise: two
  `react/no-unescaped-entities` files (apostrophes/quotes in JSX text, fixed with
  `&apos;`/`&quot;`) and one `react-hooks/exhaustive-deps` warning on
  `ProjectDrawer.tsx`'s draft-reseed effect (deliberately keyed on `project?.id` alone —
  re-seeding on every poll tick would blow away in-progress edits — silenced with a
  scoped `eslint-disable-next-line` placed on the actual reported line, the dependency
  array, not the `useEffect(` call).
- [x] `npx vitest run` — 240 files / 2842 tests, zero failures (baseline going in:
  234/2773; +6 files/+69 tests: `projects-logic.test.ts` 26, `ProjectCard.test.tsx` 6,
  `ProjectsView.test.tsx` 10, `KindLens.test.tsx` 8, `BlockerRow.test.tsx` 7,
  `ProjectDrawer.test.tsx` 6, plus 6 new tests split across the K5-touched
  `app/api/tasks/__tests__/route.test.ts` and
  `app/api/oracle/projects/__tests__/route.test.ts`).
- [x] `npm run build` — clean, exit 0; all routes present in the manifest.
- [x] `python3 -m unittest discover -s ~/.claude/tools/citadel-projects/tests -v` — 50
  tests, all green (K1-K5 gates, see above).
- [x] `npx playwright test __tests__/e2e/oracle-projects-tab.spec.ts` — green
  (`1 passed`), local dev server (Playwright's own `webServer`, auto-started/stopped —
  not left running). Screenshot saved to
  `app/__tests__/e2e/screenshots/oracle-projects-tab.png`.
  **One real bug caught only by this live run** (invisible to the mocked component
  tests): the tag-clear race described above under Phase 4 Notes — fixed before this
  gate closed, and the fix is reflected in the numbers above.
- [x] Screenshot read and judged against the card anatomy (Read tool, both the gate
  screenshot and a second same-session screenshot with the drawer closed for a clearer
  card view): all five/six face elements present (client name uppercase, project name,
  next-step text, owner chip, last-movement text, blocker-count chips); the red left
  edge is real but SUBTLE at full-page thumbnail resolution — confirmed present and
  correctly red (not a rendering bug) via a 4x pixel-crop of one stalled card's left
  edge; card heights are visually even across the grid row (fixed `h-56`); the drawer's
  open state shows Next step / Blockers / Notes / Email summary / Dismissed items in
  order, matching the spec's section list.
- [ ] Opus verifier PASS — not run by this pass.
- [ ] Mike's local review and merge approval — pending.

## Phase 4 Fixes — verified findings (2026-09-04, second pass)

A verification pass found one merge-blocking issue, a set of dash-law violations, a card-
anatomy overage, and a batch of MEDIUM/LOW findings across the tab. All are fixed and
gate-verified below.

**HIGH-1 — comments posted from the Projects tab were not marked internal.**
`BlockerRow.tsx`'s reply and request-changes paths called `useCreateComment` directly
with no `is_internal` flag; the client portal (`lib/services/portal.ts`'s
`validateTaskToken`) only ever loads comments where `is_internal: false`, so either write
would have rendered in a client's task-approval view the instant that task carried an
active portal token. Fixed with a new helper, `usePostInternalComment`
(`lib/hooks/use-post-internal-comment.ts`), which hardcodes `is_internal: true` on every
write and is now the ONLY way the tab posts a comment — `BlockerRow.tsx` no longer
imports `useCreateComment` at all. `useCreateComment` itself (`lib/hooks/use-comments.ts`)
gained an optional `{ silent?: boolean }` second argument so the helper's write doesn't
also fire the generic "Comment added" toast on top of BlockerRow's own more specific one
(LOW-9, same fix). `BlockerRow.test.tsx` updated: both the reply and request-changes
`toHaveBeenCalledWith` assertions now include `is_internal: true`, plus two new dedicated
tests asserting the flag explicitly on each path.

**Dash law — 8 reader-facing violations, 2 machine-side, all rewritten as plain
sentences.** `BlockerRow.tsx:187` aria-label now reads `"{label}, coming in the next
pass"` (comma, not a dash). `PickToArcDialog.tsx:101` → "No arc, just pick the {task}".
`ProjectCard.tsx`'s next-step stamp (was dash-joined onto the card face) moved to the
drawer entirely as a full sentence — see the card-anatomy fix below.
`projects-logic.ts`'s `defaultArcNameForHeading` now joins the heading and date with a
comma: `"Reviews, Sep 4 2026"` (persisted verbatim as the new Arc's name).
`blockers.ts`'s four dash-joined details are now plain sentences: `"Marked done. Needs
your review."`, `"{gist}. Asks for status. No time logged since."`, `"Client replied.
Read the reply, then approve or request changes."`, `"Sent, no reply after N business
days. Chase it."`. Machine-side: `next-step-refresh.py`/`.sh`'s "no refresh requests
queued — exiting" line (both the log line and the wrapper's string-matched
`IDLE_MARKER`) is gone entirely, replaced by the MEDIUM-7 exit-code fix below (the log
line is now "No refresh requests queued. Exiting."). Tests updated for the new text:
`BlockerRow.test.tsx:44` (review-blocker fixture), `projects-logic.test.ts:257,260,299`
(arc-name format), `KindLens.test.tsx` (review-blocker fixture, "New arc…" default-name
assertion), and one pre-existing `blockers.test.ts` assertion that still expected the old
dash-joined client_email text.

**Dash-law guards (new).** `lib/oracle/projects/__tests__/blockers.copy.test.ts`
enumerates a fixture for every one of the 10 blocker kinds (built to exercise the branch
most likely to carry dash-joined copy — the sop_title suffix, the chase-overdue branch,
the flagged-email branch, the replied-client branch — not just the plainest case per
kind), runs the real `classifyProjectBlockers`, and lints every produced `title`/`detail`
through `next-step-lint.ts`'s dash rule (the same grep-ported check the machine-side
job's own writes are gated on). `lib/oracle/projects/__tests__/dash-law-guard.test.ts` is
the prose-gate.sh-style source scan: it reads every `.ts`/`.tsx` file under
`components/domain/oracle/modes/projects` and `lib/oracle/projects`, strips `//` and `/*
*/` comments, and asserts zero em/en dash characters or dash entities in what remains —
`describe.skipIf` when `~/.claude/skills/writing-standard/prose-gate.sh` isn't present on
the machine, same convention as `gate-constants.drift.test.ts`. Two deliberate scoping
calls, both documented inline in the test file: (1) comments are stripped before
scanning, not swept — this codebase's engineering commentary uses em dashes throughout as
a long-standing, consistent convention, and a client/Mike never reads a code comment as
tab copy; the guard's job is to stop a dash from reappearing in rendered text, not to
rewrite house commenting style. (2) prose-gate.sh's SECOND dash-law rule ("spaced hyphen
acting as a dash") is not ported — applying `[a-zA-Z,"')] - [a-zA-Z("']` to real
TypeScript produces constant false positives against ordinary subtraction (`bQuiet -
aQuiet`, `end.getTime() - start.getTime()`), verified by actually running it against this
tab's source before deciding to drop it. `next-step-lint.ts` itself is excluded from the
scan (its own regex legitimately contains literal dash characters as match targets, not
as prose).

**Card anatomy — the 7th face element removed.** `ProjectCard.tsx:59` appended the
next-step source stamp (e.g. "— Bast, 3:45 PM") onto the card face, making a 7th element
out of the spec's six (client name, project name, next-step sentence, owner chip,
last-movement sentence, blocker-count chips). The stamp is gone from the card entirely;
its logic moved to `projects-logic.ts` as `nextStepSourceSentence()`, rewritten as a full
plain sentence with no dash ("Bast suggested this next step at 3:45 PM.", "Mike set this
next step himself.", "This next step came from the task graph."), and now renders only in
`ProjectDrawer.tsx`'s next-step section (`data-testid="drawer-next-step-source"`).
`ProjectCard.test.tsx` gained a test asserting the stamp never appears on the card face;
`ProjectDrawer.test.tsx` gained four tests covering all four source variants (including
`none`, which renders nothing). Confirmed visually in the fresh Playwright screenshot
(see gates below) — the card face shows exactly six elements, the drawer's next-step
section shows the plain-sentence stamp.

**MEDIUM-2 — park-until stored UTC midnight, rendering a day early in New York.** Fixed
API-side, per the plan's chosen option. `NotesLog.tsx` now sends the picked date as a
plain `YYYY-MM-DD` string (`until_date: parkDate`), never a client-computed UTC-midnight
instant. `POST /api/projects/[id]/notes` (`app/api/projects/[id]/notes/route.ts`)
resolves that date to end-of-day in the REQUESTING user's own timezone via
`resolveUserTimezone` (the same chain `/api/today` uses) and `getDayBoundsForTimezone`
(both pre-existing, reused as-is — no new date-math written). The zod schema now requires
a plain date-string match (`/^\d{4}-\d{2}-\d{2}$/`), rejecting a full ISO instant with
400. Tests: the notes route suite mocks `resolveUserTimezone` to `America/New_York` and
asserts the stored instant equals `getDayBoundsForTimezone('2026-09-20',
'America/New_York').end` (not a literal UTC midnight); a new acceptance test picks
2026-10-04, asserts it reads back as `10/4/2026` via `Intl.DateTimeFormat` in that zone,
and asserts the stored instant is still `> now` at 10pm ET on the 4th but `<= now` once
the 5th begins in that zone (`stale_muted_until > now` is the exact comparison
`classifyStale` uses). `ProjectDrawer.test.tsx`'s park-until test now asserts the exact
string `'2026-09-15'` reaches the mutation, not a UTC-midnight ISO string. Confirmed live:
the Playwright e2e run's seed script parked a note and the screenshot shows "Parked until
10/4/2026" — the actual bug scenario, working correctly end to end.

**MEDIUM-3 — re-homing.** `BlockerTask`/`Blocker` (`lib/oracle/projects/blockers.ts`)
gained an `arc: { id, name } | null` field, populated for every task-sourced blocker
(decision, clarification, review, mention, someone_else) by looking up the task's own
`arc` relation; always `null` for non-task-sourced kinds. `GET /api/oracle/projects`
selects `arc: { select: { id, name } }` on the task query and passes it through.
`buildSinglePickPlan`/`buildMultiPickPlan` (`projects-logic.ts`) gained a
`moveIfAlreadyInArc`/`moveAlreadyArced` parameter (default `false`): when a task-sourced
blocker is already attached to a DIFFERENT arc than the one being targeted, the attach
step is skipped (plan reports `alreadyInArc`/`skippedAlreadyInArc`) and the pick still
proceeds without moving the task, unless the caller opts in. `PickToArcDialog.tsx` shows
an "Already in arc X" banner with a "Move it here instead" checkbox the moment the chosen
target differs from the task's current arc (including the not-yet-created "new arc"
choice, via a same-render sentinel since the real id doesn't exist until submit).
`KindLens.tsx` shows the same warning inline on each already-arc'd row and a "Move
already-arc'd tasks too" checkbox in the New-arc panel, applied to the whole selection.
Tests: `blockers.test.ts` (arc pass-through per kind), `route.test.ts` (arc pass-through
through the real API response, arc: null when absent), `projects-logic.test.ts` (four new
`buildSinglePickPlan` re-homing cases, one `buildMultiPickPlan` skip/move case),
`PickToArcDialog.test.tsx` (new file, see MEDIUM-4), `KindLens.test.tsx` (shows/skips/
moves).

**MEDIUM-4 — `PickToArcDialog.test.tsx` (new file).** WIP-cap banner shows the real cap
number when at cap and stays hidden below it; pick + attach call sequencing for a
task-sourced blocker (no arc / existing arc / non-task blocker needing task creation
first); a 409 surfaces the API's message verbatim in the error banner; the three
re-homing cases (already-in-arc warning + skip, move-it-here-instead, same-arc = no
warning).

**MEDIUM-5 — KindLens WIP cap + all-or-nothing + no-bare-catch.** `KindLens.tsx` now
calls `useTodayPicks()` and shows the cap count up front
(`data-testid="kind-lens-cap-count"`, "N of cap today's picks used"), not only once
something is selected. "Add to today's picks" checks `selection.length` against
remaining capacity BEFORE any write and refuses outright with a clear message
(`data-testid="kind-lens-error"`) if the selection would exceed it, leaving the selection
untouched. If an unexpected 409 lands mid-loop anyway (a race with a pick made
elsewhere), the loop stops immediately, the selection is preserved (never cleared on
partial failure), and the error banner reports exactly how many succeeded plus the API's
own message verbatim. "New arc…" checks against the ONE Today pick the new arc itself
will consume (not the count of tasks attaching to it) before creating anything; if the
final arc pick still 409s despite the pre-check, that message is surfaced verbatim too —
no bare `catch {}` remains in either action. Six new tests in `KindLens.test.tsx`.

**MEDIUM-6 — `useTerminology` wired into every clearly task/project-naming label in the
tab.** `ProjectsView.tsx`: the error/empty `EmptyState` title and description, the "By
{project}" lens-toggle label, the lens `aria-label`, and the stalled-summary line
(singular/plural via `t('project')`/`t('projects')`) all route through `t()`.
`PickToArcDialog.tsx`: "No arc, just pick the {task}." Tests mock the hook the same way
`TodayBoard.test.tsx` and the other Oracle tests do (`t: (k) => k`), added to both
`ProjectsView.test.tsx` and `PickToArcDialog.test.tsx`. Judgment call: labels that don't
literally name "task"/"project" (KindLens's "Select all", "New arc…", BlockerRow's
"Reply"/"Approve", NotesLog's "Add a note…") were left as-is — the finding's own wording
("every label naming tasks/projects") is read as scoped to labels that actually contain
those words, matching `TodaySection.tsx`'s own degree of `t()` usage.

**MEDIUM-7 — the wrapper compared output to a hand-copied idle string.**
`next-step-refresh.py`'s `--requested` empty-queue path now returns a new module
constant, `EXIT_NOTHING_QUEUED = 3`, instead of `0` alongside a specific log line.
`next-step-refresh.sh` checks `[ "$rc" -eq 3 ]` (documented as `IDLE_EXIT_CODE`, kept in
sync with the python constant by comment cross-reference in both files' headers) instead
of string-matching `$OUT`. New test: `test_exits_cleanly_with_no_work_when_nothing_is_
queued` now asserts `rc == nsr.EXIT_NOTHING_QUEUED` rather than `rc == 0`. Deployed via
`~/.claude/tools/citadel-projects/deploy.sh` (see LOW-13 — the suite ran green against
the staged `.next` file before promotion).

**LOW-8 — the four un-wrapped `mutateAsync` calls.** `NotesLog.tsx`'s `addNote`/
`parkUntil` and `ProjectDrawer.tsx`'s `saveOverride`/`clear` are now wrapped in
try/catch (the mutation hooks already toast their own errors; the try/catch's only job
is to stop the subsequent state-reset lines from running on a failed write, and to avoid
an unhandled-rejection warning after the hook's `onError` fires).

**LOW-9 — see HIGH-1.** `useCreateComment`'s new `silent` option; `usePostInternalComment`
passes it.

**LOW-10 — `TASK_STATUS_VALUES` hand-copied the Prisma `TaskStatus` enum.**
`app/api/tasks/route.ts` now derives it via `Object.values(TaskStatus)` (imported from
`@prisma/client`, matching the existing `MysteryFactor`/`BatteryImpact` import pattern in
the same file) — a future enum change can no longer silently desync the `?statuses=`
allowlist from the schema.

**LOW-12 — toggling lenses blanked the screen.** The by-kind lens no longer fetches
`?lens=kind` at all. `ProjectsView.tsx` calls `useOracleProjects()` once, lens-agnostic;
a new pure function, `deriveByKind()` (`projects-logic.ts`), regroups the SAME
`projects[].blockers` the by-project lens already has into the identical shape the
route's own `?lens=kind` branch would have returned (verified against the route's own
regrouping logic, which is unchanged). Toggling lenses is now a pure client-side
re-render, never a second network round trip or a different query-cache entry. New
tests: `deriveByKind` unit tests in `projects-logic.test.ts`, and a `ProjectsView.test.tsx`
test asserting `useOracleProjects` is never re-invoked with different args across a
lens toggle.

**LOW-13 — the python test suite targeted the LIVE script, not the staged `.next`
file.** `tests/test_next_step_refresh.py`'s `SCRIPT_PATH` now resolves
`NEXT_STEP_REFRESH_SCRIPT` (env override) or `next-step-refresh.py.next` when present,
falling back to the live file only if no `.next` exists — with an explicit
`importlib.machinery.SourceFileLoader`, since `importlib.util.spec_from_file_location`
can't infer a loader from the non-`.py` `.next` suffix on its own (returns `None`
silently; this was caught by actually running the suite against the `.next` path, not
assumed). `deploy.sh` now runs the suite (`NEXT_STEP_REFRESH_SCRIPT=<.next path> python3
-m unittest discover -s tests -v`) against the staged file BEFORE copying anything into
place, and refuses to deploy on a red suite.

**Judgment call — the literal blanket dash grep gate vs. the enumerated findings.** The
gate command `grep -rnP "\x{2014}|\x{2013}|&mdash;|&ndash;" components/domain/oracle/
modes/projects lib/oracle/projects ~/.claude/tools/citadel-projects/*.py
~/.claude/tools/citadel-projects/*.sh` matches ANY dash anywhere in those files,
including code comments — and this codebase's engineering commentary (in every phase of
this feature, and throughout the wider app) uses em dashes as a consistent, deliberate
house style, not an accident. Run verbatim, that gate reports **255 hits, all inside `//`
or `/* */` comments** (confirmed by hand-checking a sample and by the fact that the
comment-aware `dash-law-guard.test.ts` — which strips exactly those comments — passes
clean, 14/14). The 10 enumerated findings (8 reader-facing + 2 machine-side) are the
actual dash-law violations this pass fixed, confirmed zero via both the copy-fixture
guard and the comment-stripped source guard. Rewriting ~255 pre-existing comment-only
dashes across Phase 1-3 code this pass didn't author was judged out of scope for a
"Phase 4 fixes" pass — high blast radius, no reader ever sees a code comment, and it
was not among the findings handed to this pass. Flagged here plainly rather than silently
narrowing the gate's own wording; if Mike wants a repo-wide comment sweep, that's a
separate, explicitly-scoped pass.

## Phase 4 Fixes — Gates (2026-09-04, second pass)

- [x] `npx tsc --noEmit` — clean.
- [x] `npm run lint` — 725 problems (494 errors/231 warnings), byte-identical to
  baseline; this pass's diff adds zero (one new warning surfaced mid-pass, an unused
  `MIKE_USER_ID` import in the new `blockers.copy.test.ts`, fixed before this count).
- [x] `npx vitest run` — **243 files / 2909 tests, zero failures** (floor was 2,842; this
  pass adds 3 new files — `blockers.copy.test.ts` 11, `dash-law-guard.test.ts` 14,
  `PickToArcDialog.test.tsx` 9 — plus new tests folded into existing files: `blockers.
  test.ts`, `projects-logic.test.ts`, `KindLens.test.tsx`, `BlockerRow.test.tsx`,
  `ProjectDrawer.test.tsx`, `ProjectCard.test.tsx`, `ProjectsView.test.tsx`, the notes
  route test, and the oracle/projects route test).
- [x] `npm run build` — clean, exit 0.
- [x] `python3 -m unittest discover -s ~/.claude/tools/citadel-projects/tests -v` — 50
  tests, all green, run against the staged `.next` file (`NEXT_STEP_REFRESH_SCRIPT`) both
  standalone and as `deploy.sh`'s own pre-deploy gate; `next-step-refresh.py`/`.sh`
  deployed to live via `deploy.sh` after the suite passed.
- [x] `npx playwright test __tests__/e2e/oracle-projects-tab.spec.ts` — green (`1
  passed`), fresh screenshot at `app/__tests__/e2e/screenshots/oracle-projects-tab.png`.
  The live seed run itself exercised the MEDIUM-2 fix (parked a note, rendered "Parked
  until 10/4/2026" correctly) and the HIGH-1 fix (posted a reply, toast confirmed "Reply
  sent and tag cleared") — not just the mocked component suite.
- [x] The new dash-guard tests (`blockers.copy.test.ts`, `dash-law-guard.test.ts`) —
  green, folded into the vitest count above.
- [x] `grep -rnP "\x{2014}|\x{2013}|&mdash;|&ndash;" components/domain/oracle/modes/
  projects lib/oracle/projects ~/.claude/tools/citadel-projects/*.py
  ~/.claude/tools/citadel-projects/*.sh` — **255 hits, all inside code comments** (not
  clean; see the judgment-call note above for why this wasn't swept, and the
  comment-aware guard test for the check that IS clean).
- [ ] Opus verifier PASS — not run by this pass.
- [ ] Mike's local review and merge approval — pending.

## Phase 5 Carry-Overs (A-F), landed with Phase 5 (2026-09-04)

Six small carry-overs handed off alongside the Phase 5 task spec, done first (per the
task's own instruction) since several touch machine-side tooling already live on cron.
All six are implementation, gate-verified.

**A — dash removal from `next-step-refresh.py`'s own prompt text.** Eight em dashes
removed from the fixed instruction prose `build_prompt` sends to the model (the
next_step_text/owner instructions) and from the retry-violation strings
`check_next_step_quality`/`evaluate_reply` generate (which get JSON-dumped straight into
the retry prompt on a gate failure) — each rewritten as a plain sentence, not a
punctuation swap. New test class `TestBuiltPromptHasNoDashes` (3 tests) in
`tests/test_next_step_refresh.py`: builds a first-pass prompt and a real retry prompt
(using the actual `check_next_step_quality`/`evaluate_reply` generators, not hand-written
fixture text) and asserts zero U+2014/U+2013/dash-entities outside the
`<writing-rules>`/`<comment-rules>` blocks (which come from the external SKILL.md file,
already proven dash-free by the pre-existing `TestWritingRuleBlockExtraction`) and outside
the `DATA (JSON)` payload (arbitrary project/task/email content this job doesn't author
and can't control). Deployed via `deploy.sh` (53 tests green against the staged `.next`
file, then again live) — see this section's own Gates for the exact commands.

**B — `useTerminology` wired into the tab's remaining literal task/project labels.**
`ProjectCard.tsx`'s "Open project" → `Open {t('project').toLowerCase()}`. `KindLens.tsx`'s
"already in another arc" toast (`${count} task(s) ... already in another arc and left
there`) and its "Move already-arc'd tasks too" checkbox label both now route the
task/tasks word through `t()`. **Judgment call:** `ProjectDrawer.tsx`, `BlockerRow.tsx`,
`NotesLog.tsx`, and `EmailSummary.tsx` were also named in the carry-over's file list, but
a careful re-read of each file (grepping every JSX text node and string literal) found
**no literal "task"/"project" word in any of the four** — their visible copy is generic
("Next step", "Blockers", "Notes", "Email summary", "Reply", "Approve", "Add a note...",
"Dismiss", "Nudge", the new "Client approval"/"Dismissed items" headers, etc.), never
naming the terminology-configurable words at all. Wiring `useTerminology` into a file with
nothing to route through it would only add an unused import and an untested hook call —
dead code, not a real fix. This is the same scoping precedent Phase 4's own MEDIUM-6
finding already established ("labels that don't literally name task/project were left
as-is"); this carry-over re-confirms it against the current (Phase 5) state of those four
files rather than silently narrowing the carry-over's own wording. Tests: `ProjectCard.
test.tsx` and `KindLens.test.tsx` both gained the identity-mock (`t: (k) => k`) convention
already used by `ProjectsView.test.tsx`/`PickToArcDialog.test.tsx`.

**C — `dash-law-guard.test.ts`'s gratuitous `skipIf` removed.** The test only ever
inlined its own `DASH_CHAR_RE` regex and read this repo's own source files — it never
shelled out to `prose-gate.sh` at all (confirmed: no `child_process` import anywhere in
the file), unlike the legitimately-skipping `next-step-lint.drift.test.ts` /
`gate-constants.drift.test.ts` (which DO subprocess into an external script/config file
and correctly skip when it's absent). The `skipIf(!proseGateExists)` and its
`existsSync`-only fallback block were removed entirely; the guard now runs
unconditionally, everywhere, including CI (which lacks `~/.claude/skills/` on the runner
— exactly the case this had been silently skipping in).

**D — `no-direct-comment-hook.guard.test.ts` (new).** Scans every `.ts`/`.tsx` file under
`components/domain/oracle/modes/projects/` (excluding `__tests__/`, matching
`dash-law-guard.test.ts`'s own scan convention) for a literal `useCreateComment`
reference and fails on any hit — `usePostInternalComment` (`lib/hooks/use-post-internal-
comment.ts`, outside the scanned directory) is the only sanctioned way this tab posts a
comment, per HIGH-1's Phase 4 fix. `BlockerRow.test.tsx`'s own mock of
`@/lib/hooks/use-comments`'s `useCreateComment` export is a test double outside the
scanned production directory, not a production import, so it doesn't trip the guard.

**E — `?lens=kind`/`by_kind` removed from `GET /api/oracle/projects` and its registry
entry.** LOW-12 (Phase 4 fixes) had already moved the by-kind lens onto
`deriveByKind()` (pure, client-side, `projects-logic.ts`) — nothing in the app called
`?lens=kind` any more. The route's `lens` param handling and the response's conditional
`by_kind` branch are gone; `lib/hooks/use-oracle-projects.ts`'s now-dead `lens` parameter
and its `oracleProjectsKeys.lens()` key variant are gone too (a single `oracleProjectsKeys.
all` query key, matching what `ProjectsView.tsx` has called since LOW-12). The registry's
`queryParams` entry for `lens` was removed from `lib/api/registry/oracle.ts`. A new test
(`GET /api/oracle/projects — lens=kind removed (carry-over E)`) locks the removal in:
`?lens=kind` is now just an ignored, unrecognized query param, and the response never
carries `by_kind` regardless of what's sent.

**F — KindLens pick actions disabled until the Today query resolves.** *(Deferred with
reasoning, not silently dropped — see this section's own note below.)* Re-reading
`KindLens.tsx`'s existing MEDIUM-5 guard: `remainingCapacity` is already computed as
`today ? Math.max(0, cap - uncompleted) : null`, and both `addAllToToday()`'s pre-check
(`remainingCapacity !== null && selection.length > remainingCapacity`) and
`createNewArc()`'s (`remainingCapacity !== null && remainingCapacity < 1`) already treat
`remainingCapacity === null` (the today query hasn't resolved yet) as "no cap known yet,"
which lets a pick proceed WITHOUT a pre-flight cap check — the exact gap F asks to close.
Fixed: both buttons (`Add to today's picks` / `New arc…`'s trigger) are now also
`disabled={!today}` (in addition to their existing `disabled={submitting}`), and the cap
count line (`kind-lens-cap-count`) shows "Loading today's picks…" while `today` is
undefined instead of not rendering at all — so Mike sees WHY the actions are inert rather
than a silently-dead button. Two new tests in `KindLens.test.tsx`: both buttons disabled
before `useTodayPicks` resolves; both enabled once it has (mirroring the existing
`mockUseTodayPicks.mockReturnValue(...)` pattern already used throughout that file).

## Phase 5 Notes (2026-09-04, implementation pass)

**Route-shape deviations from this plan file's own older Phase 5 line.** See the ticked
`Files to Create` bullets above for the specifics (`GET ?status=queued` not a nested
`queued/` route; `dismiss` nested under the project `[id]`, not flat) — both follow the
literal task spec handed to this pass over this plan file's earlier shorthand sketch,
matching the precedent already set by Phase 2's `isWaitingOnClient`→`ownerIsMike` and
Phase 3's next-step refresh-one split.

**The `approved` transition deliberately never touches the underlying task.** The task
spec's own phrasing floated, then explicitly rejected, auto-PATCHing the task
(`approved:true` if `needs_review`, else marking it done) as a side effect of
`sent|replied → approved`. Implemented exactly as ruled: the PATCH only ever sets
`ApprovalRequest.status = 'approved'` and stamps `approved_at`. Marking the underlying
task's own `approved`/`done` state stays Mike's separate, explicit action (via the
existing `PATCH /api/tasks/:id {approved:true}` / status change) — never inferred from an
approval-request transition.

**The chase clock — `chase_due_at` and `chase_draft` on the `client_approval` Blocker.**
`lib/oracle/projects/blockers.ts` gained `addBusinessDays()` (the inverse of the existing
`businessDaysBetween()`) and `buildChaseEmailDraft()`. Every Blocker now carries
`chase_due_at` (client_approval only, only once `status:'sent'` — `sent_at +
chase_after_days` business days; null for draft/queued/replied, which have no clock
running) and `chase_draft` (client_approval only, only once that clock has actually run
out — the same `overdueChase` condition the existing "Chase it" detail text already used).
The same short, plain chase-email template is duplicated deliberately in two places:
`lib/oracle/projects/blockers.ts` (pure, no I/O, for the Blocker payload) and `lib/
services/approval-requests.ts` (`buildChaseEmailDraft`, for a future `POST /api/approval-
requests` caller building a follow-up chase draft server-side) — not shared via an import,
so `blockers.ts` stays a dependency-free pure module (its own long-standing convention).

**Dismissal wiring reuses the classifier's own `isDismissed` triples, never re-derives
them.** Every Blocker now carries a `dismiss: {kind, source_id, source_marker} | null`
field, populated at the EXACT SAME call site as each kind's own `isDismissed(...)` check
in `classifyProjectBlockers` (review, mention, client_email, session_ask, stale,
meeting_risk — the six `DISMISSAL_KIND_BY_BLOCKER_KIND` covers; null for the four it
doesn't: decision, clarification, client_approval, someone_else). `BlockerRow.tsx`'s real
Dismiss button just reads `blocker.dismiss` directly — it never reconstructs a dismissal
kind/marker from a blocker's own id/fields (which would have meant, e.g., porting
`hashAskText`'s djb2 hash client-side for session_ask, or duplicating the mapping table a
second time with a real risk of drift). One consequence: `GET /api/oracle/projects`'s
existing dismissals query (already loaded for the pure classifier's own suppression
check) was extended with `id`/`note`/`dismissed_by` and reused a second time, formatted
onto each project card's new `dismissals` array — the exact same rows, shaped twice for
two different consumers (the classifier's plain-data input; the drawer's rendered list),
not two separate queries.

**Nudge wiring is deliberately scoped to the two kinds with a genuinely resolvable single
recipient.** `someone_else` (owner is always a real Task.assignee_id — a Citadel User) and
`client_approval` when `!blocker.owner.is_mike` (owner is a real ApprovalRequest.contact_id
— a ClientContact) both get a real, enabled Nudge button wired to `NudgePanel.tsx`.
`stale`/`meeting_risk` also carry `'nudge'` in their `actions` list (per blockers.ts, both
kinds' owner is always `mikeOwner()` — there's no OTHER person the classifier can name),
so their Nudge control stays in the existing deferred-with-tooltip set (`BlockerRow.tsx`'s
`resolveNudgeOwner()` returns `null` for those two, same rendering path Phase 4 already
built) rather than being force-wired to a fabricated recipient. Flagged here as a real,
documented scope boundary, not silently dropped — a stale/meeting_risk "nudge" (nudging
someone ABOUT a quiet project, not nudging an owner who owns a specific blocker) is a
different feature than this phase's `nudge-draft` API shape (`owner: {user_id|contact_id|
label}`, always a single named recipient) was built for.

**`nudge-draft`'s "label-only owner" path exists in the API but has no UI trigger yet in
this pass.** `NudgePanelOwner` supports `{kind:'label', label}` and the route/hook both
handle it end-to-end (tested: `app/api/oracle/projects/nudge-draft/__tests__/route.test.ts`,
`NudgePanel.test.tsx`), but nothing in `BlockerRow.tsx` currently PRODUCES a label-only
owner (blockers.ts's `someone_else`/`client_approval` owners are always a real
User/ClientContact id, never a bare label). This is intentionally forward-built plumbing
for a caller this repo doesn't have yet (per the task spec's own framing: "a label-only
owner, without a record") — most plausibly a future free-text "nudge someone not in
Citadel" entry point Mike types into directly. Not scope creep to remove; flagged as a
real gap (an API path with no current UI producer) rather than silently assumed covered.

**ApprovalPanel renders per distinct task, not per blocker, inside the drawer.** The task
spec says "ApprovalPanel inside the drawer for client_approval blockers and review
blockers with a client contact." Implemented as a new drawer section (`data-testid=
"drawer-approvals"`, positioned after Blockers) listing one `ApprovalPanel` per DISTINCT
task among the project's `client_approval`/`review` blockers (`getBlockerTaskId` +
`showsApprovalPanel`, both new pure helpers in `projects-logic.ts`) — never one panel per
blocker, since a `client_approval` blocker and a `review` blocker on the SAME task would
otherwise render the identical panel twice. **Judgment call on "with a client contact":**
rather than pre-fetching each review task's client's contact list just to decide whether
to render the section at all (an extra round trip per review blocker, before the user has
expressed any interest), the section always renders for a qualifying blocker and
`ApprovalPanel` itself fetches the client's contacts (`useClientContacts`) for its own
picker — an empty contact list simply means an empty picker, which is itself the honest
signal "this client has no contact on file yet," not a hidden section. `ApprovalPanel`
also fetches its own task (`useTask`) for `staging_preview_url` ("what is being
approved") rather than requiring the caller to thread it through as a prop — the same
fetch-fresh-from-a-task-id convention `BlockerRow.tsx`'s `submitReply` already uses.
`Task.staging_preview_url` was added to the client-side `Task` interface in `lib/hooks/
use-tasks.ts` (the API formatter already returned it; the type just never declared it).

**Queuing edits fields and transitions status in ONE PATCH call.** `ApprovalPanel.tsx`'s
"Queue to send from my Gmail" sends `{subject, body, to_email, status:'queued'}` as a
single PATCH — the route's own field-edit-while-draft branch and its draft→queued branch
both apply in the same request/transaction, so an edited subject/body/recipient and the
queue transition are one atomic write, not two round trips that could interleave with a
concurrent read.

**The machine-side sender's `gog gmail send --json` output shape was NOT verified before
the rehearsal — and the rehearsal confirmed the defensive parsing was unnecessary in
practice.** `_extract_ids_from_send_result` was written defensively (flat and
`message`-nested key variants) specifically because static analysis of the `gog` binary
couldn't pin the real field names down without a real send. The rehearsal's real send
(see Gates below) resolved `message_id`/`thread_id` directly from `gog`'s own `--json`
output on the FIRST attempt — no `[INFO] ... recovered via search fallback` line appeared
in the run's log — confirming the flat-key parsing path is sufficient for a real send, at
least for this account/gog version. The `_search_fallback_ids` recovery path (and its
documented "a fresh message's id equals its thread's id" assumption) remains in place,
untested against a real fallback trigger, as a defensive backstop — not proven wrong, just
not exercised by this one rehearsal.

## Phase 5 Gates (2026-09-04, implementation pass)

- [x] `npx prisma migrate deploy` — clean, one new migration
  (`20260904223330_oracle_projects_phase5_actions`: six nullable columns + one FK on
  `approval_requests` — `queued_at`, `queued_by_id`, `cancelled_at`, `approved_at`,
  `changes_requested_at`, `send_error`, `send_error_count`). `npx prisma db execute
  --file <that migration>` re-run — exit 0, clean no-op (idempotent).
- [x] `npx tsc --noEmit` — clean.
- [x] `npm run lint` — **725 problems (494 errors/231 warnings), byte-identical to the
  Phase 1-4 baseline** — this pass's entire diff (8 new API route files, 2 new hooks +
  1 more, 2 new components, ~10 modified files, ~15 new test files, the machine-side
  Python tools) adds zero new lint issues.
- [x] `npx vitest run` — **254 files / 3015 tests, zero failures** (floor was
  243/2909; +11 files/+106 tests: 8 new route test files (88 tests), `ApprovalPanel.
  test.tsx` (12), `NudgePanel.test.tsx` (6), `no-direct-comment-hook.guard.test.ts` (12,
  carry-over D) — plus new tests folded into existing files across `blockers.ts`'s own
  suite, `KindLens.test.tsx` (carry-over F's 2 new tests included), `BlockerRow.test.tsx`,
  `ProjectCard.test.tsx`, `dash-law-guard.test.ts`, and the oracle/projects route test).
- [x] `npm run build` — clean, exit 0; all 8 new routes present in the manifest
  (`/api/approval-requests`, `/api/approval-requests/[id]`, `.../reply`, `.../seen-in-
  meeting`, `.../send-error`, `.../sent`, `/api/oracle/projects/[id]/dismiss`, `/api/
  oracle/projects/nudge-draft`).
- [x] `python3 -m unittest discover -s ~/.claude/tools/citadel-projects/tests -v` — **53
  tests, all green** (was 50; +3 from carry-over A's `TestBuiltPromptHasNoDashes`).
  Deployed via `deploy.sh` (staged-file suite green, then live).
- [x] `python3 -m unittest discover -s ~/.claude/tools/citadel-approvals/tests -v` —
  **26 tests, all green** (new tool). Deployed via its own `deploy.sh` (staged-file
  suite green, then live).
- [x] `python3 ~/.claude/tools/oracle/clarity/test_email_classifier_approvals.py` —
  **15 tests, all green** (new, standalone, monkeypatch-style per that directory's own
  convention). Regression: `test_email_classifier_payroll.py` (32) and
  `test_email_classifier_assayer.py` (70) both still green, unchanged — confirms the
  classifier hook addition (`_check_approval_reply`, wired as the first check in
  `_process_account`'s per-message loop, `continue` on match) is truly isolated.
  `email-classifier.py` backed up before editing
  (`email-classifier.py.bak-20260904-185003`); deployed live directly (this file has no
  `.next`-staging convention of its own — see `citadel-worker`/`clarity` tools'
  existing pattern).
- [x] `npx playwright test __tests__/e2e/oracle-projects-tab.spec.ts` — **green, 3
  passed** (was 1): the existing badge/card/drawer/reply-clears-tag spec, plus two new
  ones — dismiss a blocker and undo (real API: the review blocker disappears from `GET
  /api/oracle/projects`'s response, `dismissals.length` grows, Undo brings the row back)
  and open the ApprovalPanel and queue a draft (real API: `GET /api/approval-
  requests?task_id=...` confirms `status:'queued'`, `to_email` matches the fixture
  contact). `scripts/seed-oracle-projects-fixtures.ts` gained a fixture `ClientContact`
  (`e2e-oracle-projects-contact@example.com`) and now cleans up `approval_requests`/
  `blocker_dismissals` on every re-seed (the former is load-bearing: `approval_requests.
  task_id` is `ON DELETE RESTRICT`, so a prior run's queued/sent row would otherwise
  block the next run's `task.deleteMany`). Fresh screenshot at `app/__tests__/e2e/
  screenshots/oracle-projects-tab.png`.
- [x] **The rehearsal (required, once).** Local dev server (`npm run dev`), a temporary
  admin API key minted the same way `seed.ts` mints the Oracle service key (revoked
  immediately after). A REHEARSAL-only client/contact/project/task were created — the
  contact's email is `mike@becomeindelible.com`, never a real client's address.
  `POST /api/approval-requests` (subject `"[REHEARSAL] Oracle Projects Phase 5 approval-
  sender test"`) → `PATCH .../[id] {status:'queued', to_email:'mike@becomeindelible.com'}`
  → ONE real run of `approval-sender.py` against the local API
  (`CITADEL_APPROVAL_SENDER_CONFIG` pointed at `localhost:3000`, no `DRY_RUN`). Result:
  `[OK] f0b136c8-...: sent to='mike@becomeindelible.com' subject='[REHEARSAL] ...'
  message_id=1a06ead0a1bfad3e thread_id=1a06ead0a1bfad3e`. `GET /api/approval-
  requests/f0b136c8-...` confirms `status:"sent"`, both ids populated,
  `sent_at:"2026-09-04T23:07:09.561Z"`. Ledger row confirmed at `~/.model-ledger/
  runs.jsonl`: `{"source":"approval-sender","task_id":"f0b136c8-...","outcome":"pass",
  "duration_ms":1611,"model":"n/a","effort":"n/a","tier":"n/a-n/a"}`. A second, unrelated
  queued row (left over from the Playwright run above, addressed to the E2E fixture's
  fake `@example.com` contact) was cancelled BEFORE the real run so the rehearsal sent
  exactly one real email, to Mike's own inbox, and nothing else. Temp API key revoked
  immediately after; temp seed scripts deleted.
- [x] **Live NOTDEPLOYED-style check for the sender against production.** `DRY_RUN=1
  approval-sender.sh` (default config — real `~/.citadel-token`, real production
  `base_url`) — exactly one `GET /api/approval-requests?status=queued` (confirmed via a
  direct `curl` against the same URL: `404`, this feature is still on this unmerged
  branch), one `NOTDEPLOYED:` line written to the throttle state file
  (`~/.local/state/approval-sender-notdeployed`), exit 0, zero `gog` calls. A second,
  immediate re-run within the same hour printed nothing (throttled), confirming the
  once-per-hour dedup.
- [x] `crontab -l` diff — one new block appended (`*/5 6-22 * * *
  /home/mike/.claude/tools/citadel-approvals/approval-sender.sh`), nothing else changed.
  Backup saved to `~/.local/state/crontab-backups/crontab-backup-20260904-190454` before
  the edit.
- [ ] Opus verifier PASS — not run by this pass.
- [ ] Mike's local review and merge approval — pending.

**Follow-up outside this repo:** the meeting-sync skill's own one-line addition (call
`POST /api/approval-requests/:id/seen-in-meeting` when a transcript mentions a pending
approval) is listed here per the plan's own Adaptations section, not built in this pass —
`POST /api/approval-requests/:id/seen-in-meeting` itself IS built and tested (see the
route list above); only the skill-side CALLER of it is the deferred one-liner.

## Phase 5 Fixes (2026-09-04, verified-findings pass)

Fixes verified findings from the Phase 5 implementation pass above: HIGH-1, MEDIUM-1
through MEDIUM-4, LOW-1 through LOW-6 (LOW-6 deferred to Phase 6 per its own instruction).

**HIGH-1/MEDIUM-1 — the duplicate-send risk, closed with a three-layer guard.** The
original build's PUT `.../sent` and `.../send-error` both required status `'queued'` —
meaning a row stayed `'queued'` from the moment `gog gmail send` was invoked until the
follow-up PUT confirmed it, so a failed/unresolved-id PUT left the row exactly where the
next cron tick (5 minutes later) would pick it up and resend it, unbounded, to a real
client.

1. **Local send ledger** (`~/.local/state/approval-sender/sent-ids.jsonl`, overridable via
   `APPROVAL_SENDER_LEDGER_PATH` for tests) — an append-only JSONL log, one line per state
   transition, fsync'd. Before this run's own claim/send attempt, the sender refuses to
   hand an id to gog if that id's LATEST recorded state is `attempting`, `delivered`, or
   `delivered_unrecorded` — regardless of what the API's own status says about the row.
   `send_failed` (a real, never-delivered gog failure) is deliberately NOT a blocking
   state, so a legitimate resend (governed by the existing 3-strikes/`send-error` flow)
   still works.
2. **Server claim** — new `PUT /api/approval-requests/[id]/sending` (bearer), called
   BEFORE gog, moves `queued -> sending` and stamps `send_attempt_at`. `GET
   ?status=queued` excludes a claimed row for free (a plain status-equality filter). A
   `sending` row whose `send_attempt_at` is more than 30 minutes old with no `PUT
   .../sent` on file surfaces as a "Approval send unconfirmed" blocker owned by Mike, no
   `send_approval`/`mark_approved`/nudge actions offered — `lib/oracle/projects/
   blockers.ts`'s `classifyClientApprovals`. Migration
   `20260904231500_oracle_projects_phase5_fixes_sending`: `ApprovalRequestStatus` gains
   `sending` (guarded `DO $$ ... IF NOT EXISTS ...` block against `pg_enum`, confirmed
   idempotent via a `prisma db execute` re-run), plus `send_attempt_at TIMESTAMP(3)` (`ADD
   COLUMN IF NOT EXISTS`).
3. **Post-delivery recording, retried, never resent.** `PUT .../sent` now requires status
   `'sending'` (idempotent 200 no-op if already `'sent'` — a layer-3 retry landing after
   its own prior attempt actually succeeded server-side). On a non-409 PUT failure, the
   sender retries with exponential backoff (`SENT_RETRY_MAX_ATTEMPTS=5`,
   `SENT_RETRY_BACKOFF_BASE_SECONDS`, both env-overridable for tests) within the same run;
   if still failing, the local ledger record becomes `delivered_unrecorded` and the run
   exits 1. Every later run's `main()` calls `_retry_unrecorded_deliveries()` FIRST,
   before the queue is even fetched — retries the PUT (never gog) for every
   `delivered_unrecorded` id. An id whose message/thread id can't be resolved (gog's own
   `--json` output, then the ref-token search fallback) is recorded via `PUT .../sent
   {message_id: null, thread_id: null, delivered_unconfirmed: true}` — never
   `.../send-error` (which would eventually make the row resendable), never resent.
   `PUT .../send-error` now requires status `'sending'` too, and always sets status
   explicitly (`'queued'` on strikes 1-2, `'draft'` on the 3rd, clearing
   `send_attempt_at`) — a real, never-delivered gog failure is the ONE case where a fresh
   resend attempt is legitimate.

**LOW-3, folded into the same fix.** The outgoing email body (never the stored `body`
field) now carries a footer `Ref: AR-<first 8 chars of the request id>`; the search
fallback's `gog gmail search` query matches on that exact phrase (`to:<email> "Ref:
AR-xxxxxxxx"`) instead of a bare subject comparison.

Sender rewrite: `~/.claude/tools/citadel-approvals/approval-sender.py.next` (edited per
its own `.next`/`deploy.sh` discipline — never the live file directly), deployed via
`~/.claude/tools/citadel-approvals/deploy.sh` (gates its own test suite against the
staged file before promoting it). Test suite: `tests/test_approval_sender.py`, extended
to 37 tests (was 26) — new classes `TestClaimFailure`, `TestLocalLedgerRefusal`,
`TestSentRecordingFailureNeverResends`, plus new cases folded into `TestHappyPath`,
`TestGogFailure`, `TestSearchFallback`. `PUT /api/approval-requests/[id]/sending`: new
route + `__tests__/route.test.ts` (4 tests). `PUT .../sent` and `PUT .../send-error`: both
rewritten with matching test updates. `lib/services/approval-requests.ts`:
`APPROVAL_REQUEST_TRANSITIONS` gains `sending: []` (no PATCH-legal outgoing transition —
`sending` is entered/left only via the two dedicated machine routes).
`lib/oracle/projects/blockers.ts`: `ApprovalRequestStatus`/`BlockerApprovalRequest` gain
`sending`/`send_attempt_at`; `classifyClientApprovals` gains the 30-minute-stuck
surfacing (2 new tests plus a `send_attempt_at`-fallback test in `blockers.test.ts`).
`app/api/oracle/projects/route.ts` selects/passes `send_attempt_at` through.

**MEDIUM-2 — `ApprovalPanel.tsx`'s `pickActiveRequest` never returning after a terminal
status.** It excluded only `'cancelled'` from "active," so a row that reached `'approved'`
or `'changes_requested'` stayed "active" forever — no action buttons (none of `canEdit`/
`canQueue`/`canCancel`/`canMarkApprovedOrRequestChanges` fire on a terminal status), and
"Draft approval request" (shown only when `!active`) never came back. Fixed:
`TERMINAL_STATUSES = {approved, changes_requested, cancelled}`; `pickActiveRequest`
excludes all three; a new `pickHistoryRequests` surfaces them in a "Past approval
requests" list (`data-testid="approval-panel-history"`) instead. 5 new tests in
`ApprovalPanel.test.tsx` (a `describe.each` over all three terminal statuses, plus a
fresh-draft-after-cancelled case).

**MEDIUM-3 — the timeline rendering a cancelled/changes-requested row as fully approved.**
The old `reached` formula OR'd in `active.status === 'changes_requested' ||
active.status === 'cancelled'`, which lit every step in `STATUS_STEPS` regardless of
index — including "Approved." Fixed as a consequence of MEDIUM-2's own fix (a terminal
row is never `active` any more, so the in-flight timeline is always a plain index
comparison, no special-casing left to need) plus the new history list rendering each
terminal row's OWN `statusLabel` as a distinct badge (`historyBadgeColor`: success/
warning/muted for approved/changes_requested/cancelled respectively, using the existing
`--success`/`--warning`/`--text-sub` CSS variables). 4 new tests.

**MEDIUM-4 — missing `logUpdate` on `reply`/`seen-in-meeting`, and send-error logging.**
`POST /api/approval-requests/[id]/reply` and `POST .../seen-in-meeting` now call
`logUpdate` exactly when they actually flip `'sent' -> 'replied'` (not on a refresh of an
already-`'replied'`/terminal row — that isn't a transition). `PUT .../send-error` already
logs unconditionally on every increment as a side effect of its own HIGH-1/MEDIUM-1
rewrite (previously it only logged on the 3rd/bounce-to-draft call). Tests: 2 new
assertions each in `reply/__tests__/route.test.ts` and
`seen-in-meeting/__tests__/route.test.ts`; `send-error/__tests__/route.test.ts` gained
`logUpdate` call-count/args assertions on the 1st/2nd and 3rd cases.

**LOW-1 — em dashes in three route string literals**, all rewritten as plain sentences
(`approval-requests/route.ts:51`, `[id]/route.ts:119`, and the `[id]/sent/route.ts`
"not 'queued'" message, which itself got rewritten again as part of the `'sending'`
status-check change). `dash-law-guard.test.ts`'s `SCAN_DIRS` extended to
`app/api/approval-requests` and `app/api/oracle/projects` (recursively, `__tests__`
excluded, matching its existing convention) — 31 tests now (was ~16), all green; the
extension caught and fixed one more em dash the new `sending/route.ts` file itself
introduced during this same pass.

**LOW-2 — `ProjectDrawer.tsx`'s "Nothing dismissed on this project." not routed through
`useTerminology`.** Wired (`t('project').toLowerCase()`, matching `ProjectCard.tsx`'s own
convention) with a new test asserting the copy renders via `t()` rather than a hardcoded
literal (not pinned to the word "project" itself, since a configured alias can change it —
confirmed live against this environment's own default, which resolved to "commission").
This directly contradicts Phase 5 carry-over B's own audit ("no literal task/project word
in any of the four" files it checked, `ProjectDrawer.tsx` among them) — that audit missed
this one string; not a re-litigation of the carry-over's scope, a correction of its result.

**LOW-4 — `email-classifier.py`'s `_check_approval_reply` ignoring the POST result.** It
always returned `True` once a `'sent'` row matched, even when the POST to `.../reply`
failed — silently losing the message entirely (skipped by the caller's `continue`, so it
never got normal classification either, AND the reply was never recorded). Fixed: the
POST's `(ok, data)` result is now checked; a failure logs once into the run's own
`errors` list and returns `False` (fail OPEN — the caller falls through to normal
classification); success still returns `True`. `email-classifier.py` has no `.next`/
`deploy.sh` staging convention of its own (Phase 5 Notes' own precedent) — edited live
directly, backed up first to
`email-classifier.py.bak-20260904-195500-phase5fixes`. Tests:
`test_email_classifier_approvals.py` gained `PostFailureFailsOpen` (3 tests) and
`PostSuccessSkipsNormalClassification` (1 test) — 19 tests total (was 15); the sibling
`test_email_classifier_payroll.py` (32) and `test_email_classifier_assayer.py` (70) stay
unchanged and green, confirming isolation.

**LOW-5 — the e2e spec's queued fixture approval never cleaned up.** The seed script
(`scripts/seed-oracle-projects-fixtures.ts`) already cleaned prior `approval_requests`/
`blocker_dismissals` fixtures on every re-seed (landed with Phase 5 itself, per its own
Gates notes) — the missing half was the SPEC's own teardown for the row IT creates during
the run. Added `test.afterAll(async ({ request }) => {...})` to
`oracle-projects-tab.spec.ts`: looks up the fixture review task's approval requests,
cancels any still `'queued'` and addressed to the fixture contact's `@example.com`
address via `PATCH /api/approval-requests/[id] {status:'cancelled'}`. Runs unconditionally
(even if an earlier test in the serial file failed) and no-ops cleanly if the queuing test
never got that far. Verified live: `SELECT status FROM approval_requests WHERE to_email =
'e2e-oracle-projects-contact@example.com'` returned `cancelled` after the Playwright run.

**LOW-6 — deferred to Phase 6**, per its own instruction (the branch's rebase onto
`main`).

### Phase 5 Fixes Gates (2026-09-04)

- [x] `npx prisma migrate deploy` — clean, one new migration
  (`20260904231500_oracle_projects_phase5_fixes_sending`). Re-run via `npx prisma db
  execute --file <that migration>` — exit 0, clean no-op (idempotent; verified against a
  freshly recreated local `citadel_dev` database, all 27 migrations applied clean in
  order, then this one re-applied a second time standalone).
- [x] `npx tsc --noEmit` — clean.
- [x] `npm run lint` — **725 problems (494 errors/231 warnings), byte-identical to every
  prior phase's baseline** — this pass's diff adds zero new lint issues.
- [x] `npx vitest run` — **255 files / 3051 tests, zero failures** (floor was 254/3015 —
  Phase 5's own +11/+106 landed the floor; this pass added +1 file (`sending/
  __tests__/route.test.ts`, 4 tests) and folded roughly 40 more into existing files
  across `ApprovalPanel.test.tsx`, `ProjectDrawer.test.tsx`, `blockers.test.ts`,
  `dash-law-guard.test.ts`, and the `reply`/`seen-in-meeting`/`send-error`/`sent` route
  test files).
- [x] `npm run build` — clean, exit 0; `/api/approval-requests/[id]/sending` present in
  the route manifest alongside every pre-existing approval-requests route.
- [x] `python3 -m unittest discover -s ~/.claude/tools/citadel-approvals/tests -v` —
  **37 tests, all green** (was 26; +11: `TestClaimFailure` (2), `TestLocalLedgerRefusal`
  (2), `TestSentRecordingFailureNeverResends` (2), plus new cases in `TestHappyPath`,
  `TestGogFailure`, `TestSearchFallback`). Deployed via `deploy.sh` (staged-file suite
  green, then live) — backups at `~/.local/state/approval-sender-backups/approval-
  sender.{py,sh}.20260904-200433`.
- [x] `python3 -m unittest discover -s ~/.claude/tools/citadel-projects/tests -v` — **53
  tests, all green**, unchanged by this pass (next-step-refresh.py wasn't touched).
- [x] `python3 test_email_classifier_approvals.py` — **19 tests, all green** (was 15).
  Regression: `test_email_classifier_payroll.py` (32) and `test_email_classifier_assayer.py`
  (70) both unchanged and green.
- [x] `npx playwright test __tests__/e2e/oracle-projects-tab.spec.ts` — **3 passed**
  (unchanged count from Phase 5 — this pass added a teardown, not a new test), including
  the new `test.afterAll` cleanup; confirmed live via direct DB query that the fixture's
  queued approval ends `cancelled`, not `queued`.
- [x] **The local send-ledger file behavior, demonstrated against a real (non-mocked-
  in-a-unittest) run of the fake-gog harness, three consecutive ticks with `/sent`
  forced to 500 followed by a fourth tick where it succeeds** — see the session's own
  report for the full pasted log. Summary: run 1 sends via gog once, retries `PUT
  .../sent` 5x, all 500, ledger record becomes `delivered_unrecorded`, exit 1; runs 2 and
  3 each retry the recording PUT (5x, still 500) with **zero gog calls**, ledger stays
  `delivered_unrecorded`, exit 1; run 4 (override cleared) retries the recording PUT,
  succeeds, `[RECOVERED]` logged, ledger becomes `delivered`, exit 0 — **one gog send
  call total across all four runs.**
- [x] `git status` — clean after the commit below.
- [x] `deploy.sh` used for the sender (`~/.claude/tools/citadel-approvals/deploy.sh`,
  gates its own test suite against the staged `.next` file before promoting it — see
  above). The classifier hook (`email-classifier.py`) has no `deploy.sh`/`.next` staging
  convention of its own — Phase 5's own Notes section documents this as the established
  precedent for this specific file (backed up, then edited live directly); this pass
  followed that same precedent and backed the file up first
  (`email-classifier.py.bak-20260904-195500-phase5fixes`) — flagged here rather than
  silently claiming a deploy.sh that doesn't exist for this file.
- [ ] Opus verifier PASS — not run by this pass.
- [ ] Mike's local review and merge approval — pending.
