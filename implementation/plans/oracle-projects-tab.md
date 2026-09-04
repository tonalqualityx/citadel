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
- [ ] `lib/oracle/projects/blockers.ts` — pure classification: `classifyProjectBlockers(input) -> Blocker[]` for kinds decision / clarification / review / session_ask / mention / client_email / client_approval / someone_else / stale / meeting_risk; shares tag/bot constants with the spawn gate (`~/.config/citadel-worker/gate.json` mirrored as a TS const with a drift test)
- [ ] `lib/oracle/projects/movement.ts` — pure: `lastMovement(input)`, `isStale(input, now)`, `isWaitingOnClient(blockers)`
- [ ] `lib/oracle/projects/next-step-candidate.ts` — pure: first ready task in phase/sort order with blockers done
- [ ] `lib/oracle/projects/__tests__/*.test.ts` — unit tests for the three pure modules
- [ ] `app/api/oracle/projects/route.ts` — GET: in-progress `type=project` projects with blockers, owner, movement, stale, next step, dismissals applied; `?lens=kind` returns the same blockers grouped
- [ ] `app/api/oracle/projects/__tests__/route.test.ts`
- [ ] `lib/hooks/use-oracle-projects.ts`

### Phase 3: next-step engine
- [ ] `app/api/oracle/projects/[id]/next-step/route.ts` — PATCH (Mike override: source=mike) / POST refresh-one (enqueues; returns 202 with job id) 
- [ ] `app/api/oracle/projects/refresh/route.ts` — POST refresh-all
- [ ] `app/api/oracle/projects/[id]/next-step/write/route.ts` — PUT used by the machine-side job (bearer) to write `next_step_text/owner/source=bast/at` and `email_summary`
- [ ] `~/.claude/tools/citadel-projects/next-step-refresh.sh` + `next-step-refresh.py` — gathers ready tasks + recent comments + linked emails per project, runs Sonnet, PUTs the lines, runs `comment-gate.sh` on each line, logs to the ledger; honors `--project <id>` for on-demand; crontab line `0 3 * * *`
- [ ] `~/.claude/tools/citadel-projects/tests/test_next_step_refresh.py`

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
- [ ] `app/api/oracle/email-sync/route.ts` — auto-match NOT built in Phase 1 (out of the scope handed to this pass; the schema columns and the manual `attach` path are in place, ready for a later phase to wire the auto-matcher on top)
- [x] `app/api/email-asks/[id]/attach/route.ts` — accepts `project_id` as a third mutually-exclusive option (sets `match_source='mike'`); arc_id/task_id branches unchanged
- [x] `components/domain/oracle/modes/mode-shell-logic.ts` — `OracleMode` gains `'projects'`; `getModeTabs(flags)` added, `MODE_TABS` kept as `getModeTabs(currentFlags)` for compatibility
- [x] `components/domain/oracle/modes/ModeTabs.tsx` — `projectsBadgeCount` prop, red-dot badge, law comment amended
- [x] `components/domain/oracle/modes/ModeShell.tsx` — `projects` render branch → placeholder `ProjectsView`; `projectsBadgeCount={0}` hardcoded (no stalled-count query yet — Phase 2 wires the signals API that count would read)
- [x] `lib/config/feature-flags.ts` — `ORACLE_PROJECTS_TAB` (const true) and `ORACLE_HIDE_PLAN_PROCESS` (env override `NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS`, default true); `playwright.config.ts` webServer env sets it false
- [x] `lib/api/registry/projects.ts`, `lib/api/registry/sops.ts` — new notes routes + `needs_review` param documented
- [ ] `~/.config/citadel-worker/gate.json` — no change; TS mirror + drift test are Phase 2 work (blockers.ts doesn't exist yet)

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
- [ ] `app/api/oracle/email-sync/__tests__/route.test.ts` — NOT touched. The auto-match logic itself is out of Phase 1's handed-off scope (see Files to Modify); this test file is unaffected because the route wasn't changed.
- [x] 14 Playwright specs click `mode-tab-plan` or assert `mode-tab-process`. `playwright.config.ts` webServer now sets `NEXT_PUBLIC_ORACLE_HIDE_PLAN_PROCESS: 'false'`. No spec edits.

At risk, keep the shape:
- [x] `app/api/email-asks/[id]/attach/__tests__/route.test.ts` — added `prisma.project.findUnique` mock; generalized the "neither"/"both" tests to a three-field version (`arc_id`+`task_id`+`project_id` all rejected together); added `project_id` attach + 404 tests. Arc/task branch payload assertions untouched.

Confirmed safe (no assertion changes): `app/api/tasks/__tests__/route.test.ts` (added a `charter.findUnique` mock plus new describe block for the review-workflow defaults — existing fixtures/assertions untouched), charters commission-tasks, review-tasks, arcs/[id] (filters/selects only, not modified), portal list, task-form, session-tasks (already false), kickoff (already false), seed fixtures (explicit values), doors-logic/SignalsRail (door targets preserved).

## Tests to Write
- [x] Migration idempotence: applied via `prisma migrate deploy`, then re-run clean via `prisma db execute` (exit 0 both)
- [x] Creation paths: task without SOP → `needs_review=false`, `is_billable=false`; with SOP `needs_review=true` → `true`; with SOP `needs_review=false` → `false`; explicit `true`/`false` honored over both no-SOP and SOP-present cases; charter tasks never billable even with explicit override
- [ ] `classifyProjectBlockers`: Phase 2 (module doesn't exist yet)
- [ ] `lastMovement` / `isStale`: Phase 2
- [ ] next-step candidate: Phase 2
- [ ] Projects route: Phase 2
- [ ] Pick logic: Phase 4
- [ ] Email auto-match: not built in Phase 1 (see Files to Modify) — deferred to whichever phase wires `email-sync`'s auto-matcher
- [ ] ApprovalRequest state machine: Phase 5
- [ ] Dismissal: Phase 2/5
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

## Phase 1 Notes (2026-09-04, implementation pass)

Judgment calls made while landing Phase 1:

1. **Portal default flip.** `app/api/portal/tasks/[token]/new-task/route.ts`'s hardcoded `needs_review: true` was flipped to `false`, per Mike's blanket ruling that the review-required default no longer holds anywhere. Left a one-line comment marking this as the line to revert if portal-originated (client-filed) requests should stay review-gated while everything else defaults open — that's a real, separable policy question Mike may want to revisit independently of the general default flip.
2. **Seed data now seeds `needs_review=false` implicitly.** `prisma/seed.ts` sets explicit values on its fixtures already (confirmed safe in Impact Analysis) — the default flip doesn't touch it, but any *future* seed fixture that omits `needs_review`/`is_billable` will now come in `false` instead of `true`. Not a problem today; flagging it so nobody is surprised later.
3. **`schema.postgresql.prisma` mirror is partial, by necessity.** This duplicate schema was already badly stale before this pass — it predates `EmailAsk`, `ClientContact`, `Arc`, `dependencies_ordering_only`, and is referenced by zero tooling in this repo (`package.json`'s `prisma` config and every `npx prisma` command point at `schema.prisma`). Mirrored: the `Task`/`Sop` default flips, and `Project`'s 7 new scalar fields + the `next_step_owner` relation + `NextStepSource` enum (their target models, `Task`/`Sop`/`Project`/`User`, all exist there). NOT mirrored: `ProjectNote`, `ApprovalRequest`, `BlockerDismissal`, and the `EmailAsk` columns — their related models (`ClientContact`, `EmailAsk` itself) don't exist in this duplicate, and fabricating them there would be new scope, not mirroring. Documented inline in the file itself.
4. **`app/api/oracle/email-sync/route.ts` auto-match was NOT built.** The plan's "Files to Modify" lists it, but the scope handed to this Phase 1 pass covered schema + creation-path defaults + notes routes + cleanup script + flags/shell — not the email auto-matcher. The schema is ready (`EmailAsk.client_id`/`project_id`/`match_source`, `EmailMatchSource` enum) and the manual path (`POST /api/email-asks/:id/attach {project_id}` → `match_source='mike'`) is live; the auto-matcher itself (sender → ClientContact → Client → exactly-one in-progress project) is left for whichever phase actually needs it — likely folded into Phase 2 alongside the rest of the signals API, since it's the same "read email/comment context for a project" muscle.
5. **`ModeShell`'s Projects badge is hardcoded 0 in Phase 1.** There's no signals API yet to count "projects stalled on Mike" against (`blockers.ts` is Phase 2). `projectsBadgeCount={0}` is passed explicitly so `ModeTabs` never shows a fake/stale count; Phase 2/4 wires a real hook once the count has something real to read.
6. **`ProjectsView.tsx` and `lib/hooks/use-project-notes.ts` shipped a phase early.** The plan's "Files to Create" lists both under Phase 4, but the task handed to this pass explicitly asked for the Phase 1 placeholder view now (an `EmptyState` reading "Projects" / "Phase 2 wires the data.") so the tab, the flag plumbing, and the escort-law badge exception could land and be reviewed independently of the real card/kind-lens UI — and the notes hook is the natural client-side pair to the notes routes this pass already built, so it shipped alongside them rather than sitting unused until Phase 4. Phase 4 replaces `ProjectsView.tsx`'s contents and wires the hook into the real UI; both files already exist.
7. **Lint gate.** `npm run lint` does not exit 0 on this branch — but it doesn't exit 0 on `main` either. Verified via `git stash -u` (temporarily removing every change from this pass) that the baseline is 725 problems (494 errors, 231 warnings), overwhelmingly `@typescript-eslint/no-explicit-any` spread across dozens of pre-existing files (`lib/api/formatters.ts`, `lib/hooks/use-projects.ts`, `lib/hooks/use-tasks.ts`, `types/entities.ts`, etc.) — none of it introduced by this feature. This pass's diff adds zero net-new lint problems (confirmed by diffing full lint output before/after); the 3 `any` usages this pass initially introduced in new files were fixed to use real types rather than added to the pile. Fixing the pre-existing 725 is a separate, much larger cleanup outside Oracle Projects Tab's scope.
