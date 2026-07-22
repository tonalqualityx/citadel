# Clarity Phase 4a — Email on the Glass — Verification Record

Spec: `feature-planning/clarity-phase4a-email-spots.md`. Plan: `implementation/plans/clarity-phase4a-email-spots.md`.

## Baseline

- `npm run test:run`: **1571 tests / 130 files, exit 0.**
- `npx playwright test`: initially **1 failed / 2 did not run / 8 passed, exit 1** —
  `scripts/seed-clarity-phase3-fixtures.ts` seeded today_picks/calendar_events on the raw
  UTC calendar date; Phase 3d moved `/api/today`'s own "today" resolution to the admin's
  zoned date (`America/New_York`). The two diverge for several hours every evening ET —
  this baseline happened to run at ~10pm ET, squarely in that window, so the seed script
  wrote picks for "tomorrow" (UTC) while the API asked for "today" (ET), leaving Today
  empty and failing the e2e. Fixed the seed script to resolve the same way the API does
  (the admin's own `UserPreference.timezone`, `getZonedDateString`, inlined rather than
  imported to keep the script dependency-free like its siblings). Re-ran: **11 passed / 0
  failed, exit 0.** Test-fixture-only fix, zero product code touched — recorded as a
  deviation, not scope creep, since the floor cannot be established honestly otherwise.

## Migration

`prisma/migrations/20260722021159_clarity_phase4a_email_asks/` — `EmailAskState` enum,
`email_asks` table (message_id unique, indexes on state/is_urgent/received_at, FK to
tasks with ON DELETE SET NULL), `NotificationType` +`oracle_urgent_email` via `ALTER TYPE
... ADD VALUE IF NOT EXISTS` (hand-edited in after `prisma migrate dev` generated it
without the guard — Prisma's autogen doesn't add it; every prior phase that touched this
shared enum required the same manual edit). Applied via `prisma migrate dev`, confirmed
via `\d email_asks` and `enum_range(NULL::"NotificationType")` — both present in
`citadel_dev` on :5433.

## API + data plane

- `POST /api/oracle/email-sync` — batch upsert by message_id (1-200/call, zod), fires
  `notifyUrgentEmail` only on NEW-urgent or became-urgent transitions (never on a re-sync
  of an already-urgent ask).
- `PATCH /api/email-asks/[id]` — state/task_id.
- `POST /api/email-asks/[id]/create-task` — idempotent, subject Re:/Fwd: stripped, gist +
  deep link description, client matched by from_email domain vs `Client.email`, arc
  passthrough via the SHARED `lib/arc-resolution.ts` (extracted verbatim from
  `session-tasks/route.ts`'s inline logic — session-tasks' own 22 tests stayed green
  untouched, confirming the extraction is behavior-preserving), severity->priority via the
  shared `lib/ask-severity.ts`, `sop_id` pure passthrough (no SOP-guessing logic — out of
  v1 scope per spec).
- `GET /api/waiting-on-me` — gained `crisis: []` (open+urgent) and `intake:
  {count, newest_at, items}` (open+non-urgent), verified never merged into
  decide/answer/review/do.
- `GET /api/today/due-soon` — rolling 24h window from `now` (real elapsed time, not a
  calendar-day cutoff — the exact bug class the baseline fix above ran into), excludes
  tasks already in that date's today_picks.
- Notification maps extended in the 4 exhaustive `Record<NotificationType, ...>` files:
  `lib/hooks/use-notification-preferences.ts`, `lib/services/notification-preferences.ts`,
  `lib/services/email-notifications.ts`, `lib/services/slack-notifications.ts` — confirmed
  exhaustive (no 5th file) via `npx tsc --noEmit` after adding `oracle_urgent_email` to the
  enum (a missing case in any of these is a TS compile error by construction).
- `lib/api/registry/oracle.ts` + `clarity.ts` updated for all 4 new/changed endpoints.

## UI

- `CrisisStrip` — renders only when `crisis.length > 0` (verified both by unit test and by
  the e2e screenshot below); error-family tokens (`--error`/`--error-subtle`, same pair
  `TimeShape`'s meeting blocks already use); From/subject/gist/severity chip; Open email +
  Handled.
- `IntakeDrawer` — collapsed by default, no persisted expand state (verified by
  re-mounting between assertions); Open email / Create / Create + open / Dismiss per card.
- `DueSoonRow` — foot of Today; add-to-Today reuses the existing `POST /api/today`; a 409
  (WIP cap) surfaces inline with the warning tint (`--warning`/`--warning-subtle`), not
  just a background toast.

## Gates (all executed, exit codes recorded)

| Gate | Result |
|---|---|
| `npm run test:run` | **1658 tests / 141 files, exit 0** (1571+87 baseline; 11 new files + 4 new tests added to the existing `waiting-on-me` suite) |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` (touched paths) | exit 0, no warnings |
| `npm run build` | exit 0, all 4 new routes present in the route table |
| `npx playwright test` (full suite, 10 workers) | **15 passed / 0 failed, exit 0** — final recorded run; see the flakiness note below |

**Full-suite flakiness under 10-way parallelism, observed and NOT swept under the rug:**
across ~15 full-suite runs during this build, roughly 80% came back clean; the rest hit a
single-test failure that moved between runs — sometimes `oracle-phase4a-email.spec.ts`,
sometimes the PRE-EXISTING (untouched-by-this-phase) `oracle-phase3.spec.ts`, always a
different specific assertion, never the same failure twice. This is genuine resource
contention (one shared dev-server process + the existing IP-bucketed `authRateLimit`, 10
Playwright workers firing concurrent logins/navigations against both) — a pre-existing
characteristic of this suite (confirmed by it landing on `oracle-phase3.spec.ts`, which
this phase never touched except its seed script's date bug), not a logic defect: every
`--workers=1` / single-file run was 100% reliable throughout. Mitigated within scope —
`oracle-phase4a-email.spec.ts` collapsed to ONE login for its whole file (storageState
reuse, see Deviation #6) and its first assertion per test got a 15s timeout instead of the
5s default — but not eliminated, since the underlying shared-server contention is
pre-existing infrastructure outside this phase's mandate to rearchitect. The gate result
above is the actual final run, not a cherry-picked green one.

New vitest coverage: `lib/__tests__/email-asks.test.ts` (24 — subject-strip, due-soon
window incl. the 8pm-boundary case, domain matching), `lib/__tests__/arc-resolution.test.ts`
(8), `app/api/oracle/email-sync/__tests__/route.test.ts` (9 — upsert, urgent-notification
transitions, no-double-notify), `app/api/email-asks/[id]/__tests__/route.test.ts` (7),
`app/api/email-asks/[id]/create-task/__tests__/route.test.ts` (8 — prefill, idempotency,
client-match, arc passthrough, sop_id passthrough), `app/api/today/due-soon/__tests__/route.test.ts`
(5), 4 new cases added to `app/api/waiting-on-me/__tests__/route.test.ts` (crisis/intake
shape, never-merged), component tests for `CrisisStrip`/`IntakeDrawer`/`DueSoonRow` (17
combined) plus their pure-logic siblings (15 combined). One pre-existing test fixed to
match reality: `notification-preferences.test.ts`'s hardcoded "16 notification types"
count bumped to 17.

## E2E — screenshots

- `app/test-results/clarity-phase4a/desktop-1280-oracle-crisis-visible.png` — the crisis
  strip visible above Today, error-family styling, due-soon row at the foot of Today,
  collapsed intake drawer at the bottom.
- `app/test-results/clarity-phase4a/mobile-390-oracle-crisis-visible.png` — same, at
  390px, full-width strip, no horizontal overflow.

New file `__tests__/e2e/oracle-phase4a-email.spec.ts` (4 tests): crisis strip
renders-with-fixture then disappears on Handled; intake drawer collapsed->expand; due-soon
row add-to-Today (moves the fixture from due-soon into Today, self-cleans its own created
pick afterward — see Deviations); mobile full-width crisis strip.

Fixtures: `scripts/seed-clarity-phase4a-email-fixtures.ts` (one open+urgent email_ask, one
open+non-urgent email_ask, one due-soon task 3 real hours out — zoned-date-aware from the
start, learned from the baseline bug).

## Classifier — real-run evidence

**Dry run against BOTH live mailboxes** (`python3 email-classifier.py --dry-run`, zero
Gmail/API writes):
- `mike@becomeindelible.com`: fetched 36, 25 new, classified 25 (23 noise / 1
  client_non_urgent / 1 personal / 0 urgent / 0 review), 1 would-sync.
- `mike@whoismikedion.com`: fetched 2, 2 new, classified 2 (2 noise), 0 would-sync.

**Real run against BOTH live mailboxes, posting to local dev** (`PORT=3005`, a throwaway
API key minted for `mike@becomeindelible.com` in `citadel_dev` the same way Phase 3b's
verification did — `citadel_` + 32 random hex bytes, sha256-hashed, revoked after):
- Same 25+2 classification counts as the dry run (identical inbox state).
- `mike@becomeindelible.com` sync: `POST /api/oracle/email-sync` -> `200
  {"success":true,"upserted":1,"created":1,"updated":0,"notified_urgent":0}` — the one
  `client_non_urgent` WordPress-moderation email landed in `email_asks` for real (confirmed
  via `psql`: `message_id=19f86e8466a1ebf5, is_urgent=f, state=open`).
- Real Gmail label/archive actions confirmed via `gog gmail messages search
  "label:Bast/Archived-Auto"` / `"label:Bast/Personal"` on both accounts — labels landed on
  real inbox messages, archived messages still `UNREAD` where they started (never marked
  read), never sent, never deleted.

**Synthetic-urgent path** (no real urgent email existed in either inbox during this
session — per spec, seeded via a direct API POST, never fabricated in Gmail):
`POST /api/oracle/email-sync` with `is_urgent: true` -> `notified_urgent: 1`. Confirmed via
`psql`: an `email_asks` row (`is_urgent=t, severity=client_blocking, state=open`) plus a
`notifications` row (`type=oracle_urgent_email, priority=critical, entity_type=email_ask`,
addressed to `mike@becomeindelible.com`). Re-POSTing the identical ask ->
`notified_urgent: 0` (idempotent, no double-notify). `GET /api/waiting-on-me` as admin
showed it in `crisis[]` immediately after. All synthetic/throwaway rows deleted after
verification; the one real classifier-produced row was left in place as evidence.

## Deviations

1. **Seed-script UTC-vs-zoned-date bug, fixed** (baseline section above) — pre-existing,
   test-infrastructure-only, not product code.
2. **A real, live-mailbox bug found and fixed during verification — flagged seriously, not
   buried.** The classifier's first implementation applied labels/archive via
   `gog gmail labels modify <threadId>` (THREAD-scoped), while message candidates come from
   a per-MESSAGE search. A real two-message thread in Mike's inbox ("Re: Firewood",
   Mike<->Hitchcock's Firewood) had its two messages classified differently in the same
   pass (`personal` and `noise`) — the thread-scoped calls applied BOTH labels to the whole
   thread and, because one of the two messages was `noise`, ARCHIVED THE WHOLE THREAD
   (removed INBOX from both messages), pulling a legitimately-inboxed personal
   conversation out of Mike's inbox. **Caught immediately during this same verification
   pass** (spotted while checking `label:Bast/Personal` search results), **repaired
   immediately** (`gog gmail batch modify` re-added INBOX to both messages — confirmed via
   a fresh label read), and the **script fixed** to use `gog gmail batch modify
   <messageId>` (message-scoped) for every label/archive action going forward. Scanned the
   rest of the same real pass (27 messages across both accounts) for any other
   multi-message-thread collision — found none. No other real-inbox side effect occurred.
3. **"MCA burner-domain genus" and "subject-poses-as-customer"** — searched this repo and
   Bast's memory for a canonical "sweep" reference document; found none (the terms exist
   only in the Phase 4a spec itself). Implemented as this script's own best-effort
   heuristics (documented inline in `email-classifier.py`'s module docstring and at each
   regex) rather than a known, previously-validated pattern. Flagged for Bast to tighten
   once real classification volume shows whether either heuristic is too loose/tight.
   `subject-poses-as-customer` is deliberately a MODEL HINT, never an auto-decision, to
   avoid silently mis-routing a real cold-lead's first reply as noise.
   `Bast/Review`/`Bast/Personal` labels already existed from an earlier, unrelated "sweep"
   tool (`Bast/Client-Unresolved`, `Bast/Archive-Candidate`, `Bast/Archived-Sweep` also
   present) — reused those two by exact name match; the other three
   (`Bast/Archived-Auto`, `Bast/Client`, `Bast/Urgent`) are new, per the spec's own naming.
4. **Roster-client matching added a `GET /api/clients` call from the classifier** — not a
   new endpoint (none needed), just an additional authenticated read using the same
   bearer the script already holds for `/api/oracle/email-sync`, to build a domain roster
   for heuristic #1. Not explicitly named as a data source in the spec, but the spec does
   call for a "roster clients" heuristic and this is the only existing surface that
   provides it.
5. Playwright's default `outputDir` cleanup wiped the custom `test-results/clarity-phase4a/`
   subdirectory between runs when it contained no failed-test artifacts from the previous
   run — the e2e file now recreates it defensively (`fs.mkdirSync(..., {recursive:true})`)
   in `beforeAll` before writing `storageState`/screenshots there.
6. **Cross-file login rate-limit contention.** Running the full Playwright suite together
   (15 tests, 10 workers) hit the existing `authRateLimit` (10 req/min, IP-bucketed) when
   every spec file's own `login()` helper fired near-simultaneously — `oracle-phase3.spec.ts`'s
   own file comment already flags this as a known concern (`mode: 'serial'` only
   serializes within that one file, not across files). Fixed entirely within the new file:
   `oracle-phase4a-email.spec.ts` now logs in via the UI exactly ONCE in `beforeAll`,
   persists cookies as Playwright `storageState`, and reuses it across all four tests —
   zero additional login calls after the first. No changes to shared config or other spec
   files.
7. **Self-inflicted today_picks WIP-cap pollution across repeated local runs.** The
   due-soon "add-to-Today" e2e test creates a real `today_pick`; repeated manual/CI runs
   without cleanup silently accumulated orphaned uncompleted picks (the seed script
   recreates the underlying task fresh each run, orphaning any earlier pick pointing at
   the deleted task id via the FK's `ON DELETE SET NULL`), which eventually filled the
   WIP cap (5) and 409'd a later run's add-to-Today click. Fixed two ways: the e2e test
   now deletes the pick it creates via `page.request.delete` after asserting, and the seed
   script prunes any orphaned `item_type=task, task_id=null` pick defensively on every run.
   One-time manual DB cleanup performed for the 3 orphans this bug had already produced.

## Commits

See `git log` on `feat/clarity-phase1-data-plane` — this spec + verification record
committed alongside the implementation, chunked per repo convention. No push.

## Classifier flip-checklist (for Bast, before wiring the cron)

- [ ] Read this verification record in full, especially Deviation #2.
- [ ] Confirm `~/.claude/tools/oracle/clarity/email-classifier.py` is the version WITH the
      message-scoped fix (`gog gmail batch modify`, not `gog gmail labels modify
      <threadId>`) — check the file's own header comment names the fix explicitly.
- [ ] Spot-check a handful of real `Bast/Archived-Auto` / `Bast/Client` /
      `Bast/Personal` classifications from this session's real run against both
      mailboxes (label searches in the verification section above) — confirm they read
      right to a human, not just structurally correct.
- [ ] Decide whether to tighten the MCA/subject-poses-as-customer heuristics (Deviation
      #3) before or after going live — they're conservative (model-hint, not
      auto-noise, for the ambiguous one) but unvalidated against real volume.
- [ ] Add `classifier-crontab.snippet`'s line to the real crontab via the file-based edit
      process (`crontab -l > tmp`, edit, `crontab tmp` — never `crontab -`).
- [ ] Watch `~/.oracle-email-classifier.log` for the first few real cron passes before
      considering this fully live.
