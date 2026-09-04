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
- [ ] `components/domain/oracle/modes/projects/ProjectsView.tsx` — lens toggle, grid / kind list, drawer host
- [ ] `components/domain/oracle/modes/projects/projects-logic.ts` — pure: sort (stalled first), stalled count, kind grouping, pick payload builder, 20+ collapse rule
- [ ] `components/domain/oracle/modes/projects/ProjectCard.tsx`, `ProjectDrawer.tsx`, `BlockerRow.tsx`, `KindLens.tsx`, `PickToArcDialog.tsx`, `NotesLog.tsx`, `EmailSummary.tsx`
- [ ] `components/domain/oracle/modes/projects/__tests__/projects-logic.test.ts`, `ProjectsView.test.tsx`, `ProjectCard.test.tsx`
- [x] `lib/hooks/use-project-notes.ts` — shipped in Phase 1 alongside the notes routes it wraps (see Phase 1 notes); `lib/hooks/use-pick-to-arc.ts` still Phase 4

### Phase 5: actions + approval loop
- [ ] `app/api/approval-requests/route.ts` (POST create draft), `[id]/route.ts` (PATCH edit draft / queue / cancel / mark approved), `[id]/seen-in-meeting/route.ts`, `queued/route.ts` (GET for the sender, bearer), `[id]/sent/route.ts` (PUT by the sender)
- [ ] `app/api/oracle/projects/dismiss/route.ts` — POST create BlockerDismissal; DELETE undo
- [ ] `app/api/oracle/projects/nudge-draft/route.ts` — POST returns a drafted nudge keyed off the person's record (user → comment text; contact/contractor → email draft); never sends
- [ ] `~/.claude/tools/citadel-approvals/approval-sender.py` + cron */5 — sends queued approvals via gog, writes back ids
- [ ] `lib/hooks/use-approval-requests.ts`, `use-blocker-dismissals.ts`
- [ ] `components/domain/oracle/modes/projects/ApprovalPanel.tsx`, `NudgePanel.tsx`
- [ ] Tests for every new route (mocked prisma) and the sender (fake gog)

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
- [ ] Pick logic: Phase 4
- [x] Email auto-match: Phase 2 — 6 tests on `app/api/oracle/email-sync/route.ts` (see Tests to Update)
- [ ] ApprovalRequest state machine: Phase 5
- [x] Dismissal: Phase 2 (classification-time suppression, covered above); the dismiss/undo ROUTE itself (`POST`/`DELETE /api/oracle/projects/dismiss`) is still Phase 5
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
