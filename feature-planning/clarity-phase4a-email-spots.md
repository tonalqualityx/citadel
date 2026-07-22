# Clarity Phase 4a — Email on the Glass (crisis strip, intake drawer, due-soon row, classifier)

Mike-ruled design (2026-07-21, talk-first): urgent email gets a CRISIS STRIP above Today, exception-based — zero pixels when calm. Non-urgent client mail waits in a collapsed INTAKE DRAWER (count always visible, contents open at rituals/on-demand). Plus the approved DUE-SOON row at the foot of Today. Hard rules identical to all prior phases (worktree only, additive migrations with IF-NOT-EXISTS on any multi-path DDL, baseline first — floor 1571 tests / 130 files vitest + 11/0 Playwright — every gate executed with exit-code discipline, registry updated, repo conventions, no push, no live crons/settings).

## Data plane (migration `clarity_phase4a_email_asks`)

`EmailAsk` (@@map "email_asks"): id uuid PK; `message_id VarChar(255) @unique`; `thread_id VarChar(255)`; `account VarChar(255)` (which mailbox); `from_name VarChar(255)?`, `from_email VarChar(255)`; `subject VarChar(500)`; `gist Text?` (one-liner — NEVER populated for personal correspondence); `queue AskQueue?`; `severity AskSeverity?`; `is_urgent Boolean @default(false)`; `state EmailAskState` enum (open/handled/dismissed) `@default(open)`; `task_id uuid?` + relation; `deep_link VarChar(1000)`; `received_at DateTime`; timestamps; indexes on (state), (is_urgent), (received_at).

New `NotificationType` enum value `oracle_urgent_email` (ALTER TYPE ADD VALUE IF NOT EXISTS — check the exhaustive NotificationType maps the Phase 1 builder found and extend them: labels/icons/defaults in the 4 known files).

## API

- **POST `/api/oracle/email-sync`** — bearer auth (session-tasks pattern). Batch upsert by message_id (max 200/call, zod). On inserting an `is_urgent` ask: create a Citadel Notification (type oracle_urgent_email) for the primary operator (email lookup, same as session-tasks default assignee). Register in registry.
- **PATCH `/api/email-asks/[id]`** — state (handled/dismissed), task_id.
- **POST `/api/email-asks/[id]/create-task`** — the Create / Create+open backend. Creates a Task prefilled: title from subject (prefix stripped of Re:/Fwd:), description = gist + deep link, `source: 'email'` (TaskSource has it), `origin_url` = deep_link, client matched by from_email domain vs Client.email domains (null if no match), assignee default = primary operator (same email-lookup helper), `severity`→priority mapping reused, optional `arc_id`/`arc_name` passthrough with the session-tasks resolution logic (extract that arc-resolution into a shared lib function rather than duplicating). Sets email_ask.task_id + state handled. Idempotent: if task_id already set, 200 with existing. SOP guessing is OUT of v1 scope — leave a `sop_id` passthrough param only.
- **`/api/waiting-on-me`** gains: `crisis: []` (open+urgent asks) and `intake: {count, newest_at, items: []}` (open non-urgent). Email asks do NOT merge into the decide/answer/review arrays — the drawer is its own surface.

## UI (Seeing Stone)

1. **Crisis strip** — above Today, renders ONLY when `crisis.length > 0`. Error-family treatment, direct labels: from, subject, gist line, severity chip. Actions: **Open email** (deep_link, primary), **Handled** (PATCH state). Mobile: full-width, never collapsed.
2. **Intake drawer** — one quiet line under Needs Reshi: "📬 Intake · N" (+ "newest 2:41 PM" in the resolved user timezone). Expands to email cards: Open email / **Create** / **Create + open** (create-task endpoint; Create+open navigates to the quest) / Dismiss. Collapsed by default always — state not persisted, it re-collapses each load (rituals open it deliberately).
3. **Due-soon row** — foot of Today: requester's tasks due within 24h (resolved user TZ), status not done/abandoned, NOT already in today_picks for today. Count + quiet title list, each with a one-tap "add to Today" (POST today pick; respects the cap with its 409 message surfaced as the warning tint). This closes the born-at-night-invisible-quest gap.

## Classifier (staged, NOT wired — machine-side)

`~/.claude/tools/oracle/clarity/email-classifier.py` + a `classifier-crontab.snippet` (Bast wires later): every 15 min, for BOTH accounts (becomeindelible: `--account mike@becomeindelible.com`; wmd: `--account mike@whoismikedion.com --client whoismikedion`), foreground-only (flock lock, chunked loops, NO detached background dispatches — sweep agents kept idling out on those):
- Fetch in:inbox messages newer than the per-account ledger watermark (`~/.claude/oracle/email-ledger-<account>.jsonl`, message-id keyed).
- Classify each (batch prompt through `claude -p` on the cheap tier, strict JSON out; sender-first heuristics before the model — roster clients, known-noise domains, List-Unsubscribe, the cold patterns from the sweep incl. subject-poses-as-customer and the MCA burner-domain genus; Fyxer's numbered labels are NEVER signal).
- Act: noise → label + archive (audit label `Bast/Archived-Auto`); client non-urgent → label `Bast/Client` + POST email-sync (intake); urgent (narrow bar: site down / security / upset client / same-day deadline, from client or known contact; vendor alerts clearing the same bar) → label `Bast/Urgent` + POST email-sync is_urgent; unknown-human/lead → label `Bast/Review` + POST (queue review); personal → label `Bast/Personal` ONLY, never posted, never gisted. NEVER send/delete/mark-read. Config override env for base_url like the other staged tools.
- Executed verification: one real run against both live mailboxes posting to the local dev server (PORT=3005), showing real classifications, a synthetic-urgent path exercised end-to-end (seed a fake urgent directly via the API if no real one exists — do NOT fabricate an email in Gmail), DB rows + notification row as evidence.

## Gates

Baseline first; vitest (floor 1571/130) + new tests (email_asks CRUD/state machine, sync upsert + urgent-notification side effect, create-task prefill/idempotency/client-match, waiting-on-me crisis/intake shape, due-soon TZ logic incl. the 8pm boundary, shared arc-resolution refactor keeps session-tasks tests green); tsc; build; FULL Playwright (floor 11/0) + new e2e: crisis strip renders only with seeded urgent + disappears on Handled; intake drawer collapsed-by-default + expand shows cards; due-soon row + add-to-Today; screenshots regenerated including one WITH the crisis strip visible. Commit repo-style incl. this spec + verification record. No push.

## Report

Counts, migration evidence, classifier real-run evidence per account, gate results, screenshot paths, commits, deviations, flip-checklist for the classifier cron.
