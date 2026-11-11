# Build plan: Mike's home screen, Slices 2 and 3

This is the plan as the answer. Nothing was changed. It was read against Citadel `main` 9239cf6, `specs/home-build-plan.md`, `design/home-screen.md` (sections 1.7, 2A, 2B, 2C, 4, 5.4), the last five sections of `DECISIONS.md`, the live home code, the Bast chat ops, `create-task.py`, the crontab and the job watch.

**The chat-task gap is confirmed, and it is wider than reported.** Kickoff and quote tasks get no date, no person-waiting clock and urgency 10. With an active client they land in class 1, which needs urgency 30 or more; without one they land in class 4. Both fail `meetsNextRule` (`select.ts` line 825) and get counted under "Waiting their turn". Tasks the chat's `create_task` tool makes also have their date removed, so they fail the same way. The fix in 2a covers all of them.

## 0. Rules for every builder

- **Repo.** `/home/mike/.openclaw/workspace/citadel` is read-only (a worker uses it). Each sub-slice gets its own worktree from `origin/main`:
  - 2a: `citadel-home2a-wt`, branch `feat/home-slice2a`
  - 2b: `citadel-home2b-wt`, branch `feat/home-slice2b`
  - 2c: `citadel-home2c-wt`, branch `feat/home-slice2c`
  - Slice 3: `citadel-home3-wt`, branch `feat/home-slice3`
  - All four sit under `/home/mike/.openclaw/workspace/`. Below, `W` is the worktree and `A` is `W/app`. Every check runs from `A`.
- **Shell rules (put these in every agent prompt).**
  - Absolute paths only. Never `cd` in a command that deletes. Never `rm` a relative glob.
  - Delete nothing outside your own scratchpad. Never push, never merge to `main`.
  - No production calls except the GET-only steps written in the deploy sections.
  - Agents never call `/api/cron`, `/api/engine`, sweep or recheck routes. They also never call the new keeper POST; only the crontab wrapper sends it.
- **Scratch Postgres.** The container `citadel-home-mig-check` is already running on `localhost:55433` (user and password `citadel`). Each sub-slice makes its own database:

  ```
  docker exec citadel-home-mig-check psql -U citadel -d postgres -c 'CREATE DATABASE home_s2a'
  ```

  Use `home_s2b`, `home_s2c` and `home_s3` for the others. Leave the container running.
- **Scripts.** `tsx` is not installed and must not be fetched. Run TypeScript scripts with `npx ts-node -r tsconfig-paths/register --compiler-options '{"module":"CommonJS"}'`. The "local run" checks are vitest `*.integration.test.ts` files that skip unless `DATABASE_URL` names `localhost:55433`, the same pattern as `lib/bast-chat/__tests__/tap-race.integration.test.ts`.
- **On a failed check,** re-dispatch the task once with the command's stderr, then escalate.
- **No new dependencies** in Citadel or in the machine scripts. Python is stdlib only.
- **Text on Mike's screen.** Plain words. No em or en dash. Never "priority", "priorities" or "overdue". The existing `copy-guard.test.ts` covers `lib/home` and `components/domain/home`. Each gate also greps the machine scripts' user-facing strings.
- **Models.** Sonnet medium for implementation. Haiku low for setup, seed and mechanical work. No Opus or Fable builders, and no attack round (Mike's ruling). Verification is the executed gate.

**Order:**
1. 2a tonight.
2. Slice 3 tasks T1, T2, T4 and T5 can be built alongside 2a (no shared files). T3 waits for 2a to merge.
3. Deploy 2a, then Slice 3, then 2b, then 2c (2c ships with its switches off).

---

## SLICE 2a (ships tonight): keeper, dates, drawer, quiet lines, chat-task fix

### What Mike sees change

- **Tasks he just made are listed.** Any open task assigned to him that is tagged `from-chat`, or that he created himself (`created_by_id` is his id), shows in Decisions ready for 2 business days from creation. Only items he tapped "This matters more" on sort above it. Why line: "New from the chat." (or "New, made by you."). Footer: "Why it's here: You made it in the last two business days, so it shows here first."
  - It also beats the "Other ventures" placement.
  - "Not now" still parks it as usual.
- **Every waiting task gets a day to come back.** A nightly sort at 02:35 Eastern gives each of his tasks that is waiting its turn a day to return.
  - At most 3 return on any business day, and his own "Not now" returns count toward those 3.
  - On its day it joins Decisions ready, with "Back today, after waiting its turn."
  - The first run sorts the whole backlog this way.
- **Dates read once.** The first run reads the dates already on his tasks.
  - A date that looks like a real outside date shows as a chip: "Due Sunday, November 15 (date from the task, source unclear)".
  - An invented 5-day default, or a date more than 14 days past, is set aside. Nothing on the task changes.
- **Real hard dates.** A task filed with a real outside date shows "Due Sunday, November 15 (domain renews)". That comes from `Task.hard_due_at` and `hard_due_source`, set by `create-task.py --hard-due ... --hard-due-source ...` or the task API.
- **New tasks for Mike come with no date.** Tasks filed to him through `create-task.py` no longer get an invented 5-day date; the nightly sort gives them a day. Tasks for anyone else are unchanged.
- **Everything else drawer.**
  - Heading line: "{N} other items are counted here. {D} have a day to come back." then "{M} are past their day." (or "None is past its day.").
  - When paused or unsigned projects exist: "{S} tasks on unsigned or paused projects are kept as scope, not work."
  - Clicking a group lists every item with who holds it and its day, for example "Back Thursday, November 12".
  - Each item that can move has one button, "Bring it forward", which puts it at the front of Decisions ready.
- **Handled for you shows the keeper's own lines**, each with Undo for 72 hours:
  - "Gave 41 waiting tasks a day to come back, at most 3 a day, starting Wednesday."
  - "Read the dates on 47 tasks: 6 now show as real dates, 41 were set aside." Its card lists the set-aside ones on client work, which covers the b3 ruling to show client-facing dates to him.

### Rules the keeper follows (pure code in `lib/home/keeper/`)

**What it writes.** Only `home_item_state`, `home_actions` (source `keeper`) and `home_keeper_runs`, for the owner. It never writes Task, Arc, EmailAsk, Wait, Comment or Notification rows, and never sends anything.

**Who it runs for.** The owner is `BastChatSettings.owner_user_id`. That user must be an active admin whose `home_view` is `home`. Otherwise the run answers `{skipped:"home_off"}` and writes nothing.

**Which items get a day.** Only the owner's own tasks that are in Everything else under "Waiting their turn" and do not meet the Next rule. All of these are skipped:
- emergencies, pinned and boosted items
- anything that already has a future `view_at`
- items under a `keeper_hold_until` hold
- threads, crises, sessions, review folds and waits (they keep their own clocks)
- other ventures and held projects

**How days are given.**
- New items are ranked with `rankCompare`, then take the earliest business day (Eastern) that has a free slot, starting with the run's own date when that is a business day.
- Each day holds 3, minus his own Not-now returns landing that day.
- The slot time is 00:05 his time, so an item is in view from that day's first load.
- Dates already given are never reshuffled.
- The write is `view_at`, with `view_set_by = 'keeper'`.

**Arrival.** A task with `view_set_by = 'keeper'` whose `view_at` has passed meets the Next rule.

**Mike's own parking.** `view_set_by` null or `'user'` is his "Not now" and is never touched by the keeper.

**Date reading.** This runs once per task, marked with `dates_read_at`. It covers the owner's open tasks that have a `due_date`, no `Task.hard_due_at`, no Slice 1 hard date (no `promised_to`, no `job-watch` or `lifeline` tag) and no `dates_read_at`.
- Due date 4 to 6 days after `created_at` (the `create-task.py` and email-classifier defaults): set aside.
- Due date more than 14 days in the past: set aside.
- Anything else: `read_hard_due_at` gets the due date and `read_hard_due_source` gets "date from the task, source unclear".
- Nothing on the Task changes, so its `updated_at` and the chat worker's task fingerprint stay put.

**Hard date precedence** in `score.ts`: `Task.hard_due_at` (with its source), then the Slice 1 rule (`promised_to` or tags), then `read_hard_due_at`. Emergency rule 7 (2 business days or less) applies to `Task.hard_due_at` and to `promised_to` dates. It never applies to "source unclear" readings.

**Runs and repeats.** One `home_keeper_runs` row per (user, zoned date, kind `nightly`). A second POST the same day answers `{already_ran:true}` and writes nothing. A row left unfinished for more than 1 hour may be taken over.

**Undo.** Each keeper action is one `home_actions` row with `source='keeper'` and `undo_until` 72 hours ahead, so a Friday run is still undoable on Monday. Keeper undo is compare-and-set: a field is put back only if it still holds the value the keeper wrote. Every affected key gets `keeper_hold_until = now + 30 days`, so the next night does not redo it. The markers `dates_read_at` and `card_summary_hash` are not reverted.

**Scores are not stored.** They stay live, computed per request. Stored weights come with Slice 7.

### Schema (migration `20261111010000_home_screen_slice2`, all nullable or defaulted, the only migration in Slice 2)

```prisma
// On Task, after promised_to:
  // Home screen Slice 2: a real outside date and who or what set it. Read only by the home screen.
  hard_due_at     DateTime?
  hard_due_source String?   @db.VarChar(200)

// On HomeItemState, after last_shown_at:
  view_set_by          String?   @db.VarChar(10)  // null or 'user': his Not now; 'keeper': the nightly sort
  keeper_hold_until    DateTime?                  // after an Undo of a keeper action, the keeper leaves the item alone
  read_hard_due_at     DateTime?                  // the keeper's reading of an existing due_date (2A.6)
  read_hard_due_source String?   @db.VarChar(200)
  dates_read_at        DateTime?
  card_summary         String?   @db.Text         // 2b
  card_checklist       Json?                      // 2b
  card_summary_hash    String?   @db.VarChar(64)  // 2b, sha256 of the description it summarizes
  card_summary_at      DateTime?                  // 2b

// On User, with the other home back-relations:
  home_keeper_runs     HomeKeeperRun[]     @relation("HomeKeeperRunUser")
  home_keeper_settings HomeKeeperSettings? @relation("HomeKeeperSettingsUser")

// Home screen Slice 2: one row per nightly keeper run for that user. Never read by any other screen.
model HomeKeeperRun {
  id          String    @id @default(uuid()) @db.Uuid
  user_id     String    @db.Uuid
  user        User      @relation("HomeKeeperRunUser", fields: [user_id], references: [id], onDelete: Cascade)
  date        DateTime  @db.Date
  kind        String    @default("nightly") @db.VarChar(30)
  started_at  DateTime  @default(now())
  finished_at DateTime?
  counts      Json?
  error       String?   @db.Text
  @@unique([user_id, date, kind])
  @@map("home_keeper_runs")
}

// Home screen Slice 2c: keeper actions outside the home screen's own rows. No row = everything off.
model HomeKeeperSettings {
  id              String   @id @default(uuid()) @db.Uuid
  user_id         String   @unique @db.Uuid
  user            User     @relation("HomeKeeperSettingsUser", fields: [user_id], references: [id], onDelete: Cascade)
  arcs_create     Boolean  @default(false)
  arcs_close      Boolean  @default(false)
  arcs_link_tasks Boolean  @default(false)
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
  @@map("home_keeper_settings")
}
```

The migration has no `ALTER TYPE`. It is two `ADD COLUMN` on `tasks`, nine on `home_item_state`, and two `CREATE TABLE` with their foreign keys and unique indexes.

### How the job is triggered

- **Citadel side.** One new route, `app/app/api/bast-chat/worker/home-keeper/route.ts`, in the chat worker namespace that already holds the `home` op.
  - `GET` is the dry run: it returns the plan (counts, the first 50 changes, the Handled lines it would write) and writes nothing.
  - `POST` is the real run, with a strict empty body.
  - Auth is `requireChatWorker()` (the enforced `bast-chat` lane key that already exists), then `workerOwnerId()`, then the home check above.
  - Both entries go into the `bast-chat` lane allowlist in `lib/auth/lane-scopes.ts`.
  - It is not under `/api/cron` and needs no `CRON_SECRET`.
- **Machine side.**
  - Wrapper `~/.local/bin/home-keeper.sh`, built in the tool folder and copied at deploy. It follows `citadel-wait-sweep.sh`: pause file `~/.home-keeper-paused`, fleet pause file, `flock`, the token sent as a header on stdin and never in argv, `CITADEL_BASE_URL` override.
  - `DRY_RUN=1` makes it send only the GET. It calls `~/.claude/tools/home-keeper/home_keeper.py`, which reads the key at `/home/mike/.citadel-bast-chat-token` (override with `HOME_KEEPER_KEY_FILE`).
  - Every run writes `/home/mike/.local/state/home-keeper/last.json` with `run_at`, `ok`, `steps` and `counts`, and one log line to `/home/mike/.local/log/home-keeper.log`.
- **Crontab** (the machine is on America/New_York):

  ```
  35 2 * * * /home/mike/.local/bin/home-keeper.sh >> /home/mike/.local/log/home-keeper.log 2>&1
  ```

- **Job watch** (`~/.claude/tools/job-watch/jobs.json`). Add this entry before the crontab line, with `"install_pending": true`. An unlisted crontab line would file a task as `unknown`. Remove `install_pending` once the line is in.

  ```json
  {"id":"home-keeper","title":"Home screen nightly sort","short":"the home screen nightly sort","match":"home-keeper.sh","owner":"bast","client_facing":false,"out_of_scope":false,"evidence":"state_json","path":"/home/mike/.local/state/home-keeper/last.json","ts_field":"run_at","ok_field":"ok","pause_files":["/home/mike/.home-keeper-paused"],"honours_fleet_pause":true,"since":"2026-11-11","impact":"waiting tasks stop getting a day to come back on Mike's home screen","check_first":"Read the last lines of /home/mike/.local/log/home-keeper.log and last.json."}
  ```

### Task list, 2a

| Id | What | Files it owns | Depends on | Model |
|---|---|---|---|---|
| A0 | Worktree, `npm ci`, baseline, plan copy, scratch DB | `W/implementation/plans/home-screen-slice2.md` | none | Haiku low |
| A1 | Schema and migration | `app/prisma/schema.prisma`, `app/prisma/migrations/20261111010000_home_screen_slice2/migration.sql` | A0 | Sonnet medium |
| A2 | Contract | `app/lib/home/types.ts`, `app/lib/home/rules.ts`, `app/lib/home/__tests__/rules.test.ts` | A1 | Sonnet medium |
| A3 | Selection, scoring, copy | `app/lib/home/select.ts`, `score.ts`, `copy.ts`; tests `select.test.ts`, `score.test.ts`, `copy.test.ts` (all under `app/lib/home/`) | A2 | Sonnet medium |
| A4 | Loader and state | `app/lib/home/load.ts`, `state.ts`, `__tests__/load.test.ts`, `__tests__/state.test.ts` | A2 | Sonnet medium |
| A5 | Task API hard date | `app/app/api/tasks/route.ts`, `app/lib/services/task-patch.ts`, `app/lib/api/registry/tasks.ts`, `app/app/api/tasks/__tests__/route.test.ts`, `app/lib/services/__tests__/task-patch.test.ts` | A1 | Sonnet medium |
| A6 | `create-task.py` (W2-06), staged copy | `/home/mike/.claude/tools/citadel-tasks-next/create-task.py`, `.../tests/test_create_task.py` | A0 | Sonnet medium |
| A7 | Machine job, staged | `/home/mike/.claude/tools/home-keeper/home_keeper.py`, `home-keeper.sh`, `README.md`, `tests/test_home_keeper.py` | A0 (route shape from this plan) | Sonnet medium |
| A8 | Fixture seed | `app/scripts/seed-home-fixtures.ts` | A1 | Haiku low |
| A9 | Act, undo, chat | `app/lib/home/act.ts`, `app/lib/bast-chat/ops/home.ts`, `app/lib/bast-chat/actions.ts`, `app/lib/bast-chat/route-helpers.ts`; tests `app/lib/home/__tests__/act.test.ts`, `app/lib/bast-chat/ops/__tests__/home.test.ts`, `app/lib/bast-chat/__tests__/route-helpers.test.ts`, `app/lib/bast-chat/__tests__/actions.test.ts` | A4 | Sonnet medium |
| A10 | Keeper core and local run | `app/lib/home/keeper/stagger.ts`, `dates.ts`, `lines.ts`, `plan.ts`, `run.ts`, `keeper/__tests__/*.test.ts`, `app/lib/home/__tests__/slice2.integration.test.ts` | A3, A4, A9 | Sonnet medium |
| A11 | Route, lane, registry | `app/app/api/bast-chat/worker/home-keeper/route.ts`, `.../home-keeper/__tests__/route.test.ts`, `app/lib/auth/lane-scopes.ts`, `app/lib/api/registry/bast-chat.ts` | A10 | Sonnet medium |
| A12 | Drawer, quiet lines, card UI | `app/components/domain/home/home-screen-logic.ts`, `HomeScreen.tsx`, new `RestGroupCard.tsx`, tests `home-screen-logic.test.ts`, `HomeScreen.test.tsx`, new `RestGroupCard.test.tsx` | A2 | Sonnet medium |
| A13 | Executed gate | none (log in its scratchpad) | all | Sonnet medium |

**When each task can run.** No file appears in two rows.
1. A0, then A1, then A2.
2. In parallel: A5 and A8 (after A1); A6 and A7 (after A0); A3, A4 and A12 (after A2).
3. A9 after A4.
4. A10 after A3, A4 and A9.
5. A11 after A10.
6. A13 last.

### Task details, 2a

**A0**
- `git -C /home/mike/.openclaw/workspace/citadel fetch origin`, then `git -C /home/mike/.openclaw/workspace/citadel worktree add -b feat/home-slice2a /home/mike/.openclaw/workspace/citadel-home2a-wt origin/main`.
- `npm --prefix A ci`.
- Copy this plan to `W/implementation/plans/home-screen-slice2.md`.
- Baseline into the scratchpad: `npx tsc --noEmit; echo $?` and `npx vitest run 2>&1 | tail -60`.
- Create DB `home_s2a`.
- `cp -a /home/mike/.claude/tools/citadel-tasks /home/mike/.claude/tools/citadel-tasks-next`.

**A1**
- Make the section 3 schema changes and generate the SQL with `prisma migrate diff --from-schema-datamodel <main schema> --to-schema-datamodel prisma/schema.prisma --script`, as Slice 1's H1 did.
- Checks:
  - `npx prisma validate`
  - `npx prisma generate`
  - `DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s2a npx prisma migrate deploy`
  - `npx prisma migrate diff --from-url <that url> --to-schema-datamodel prisma/schema.prisma --exit-code`
  - tsc with no new errors.

**A2 (contract, which every later task builds on)**
- `types.ts`:
  - `RawTask` gains `hard_due_at`, `hard_due_source`, `created_by_id`.
  - `RawItemState` gains every new state field.
  - New `RawHeldProject {project:{id,name}, count}` and `RawKeeperLine {id, action, text, details[], at, undo_until}`. `RawHomeInputs` gains `held_projects[]` and `keeper_lines[]`.
  - `HomeRestGroupKey` gains `'scheduled'`.
  - New `HomeRestItem {key|null, title, owner, check_text, check_at|null, past_check:boolean, can_bring_forward:boolean}`.
  - `HomeEverythingElseGroup` gains `items: HomeRestItem[]`.
  - `HomeEverythingElse` gains `with_day`, `past_day`, `scope_line|null`.
  - `HomeQuietLine` gains `undo_action_id: string|null` and `details: string[]`.
  - `HomeActRequest` gains `{action:'bring_forward', item_key}`.
  - New `KeeperPlan`, `KeeperResult`, and `KeeperActionKind = 'keeper_stagger'|'keeper_dates'|'keeper_summaries'|'keeper_arc_create'|'keeper_arc_close'|'keeper_arc_link'`.
- `rules.ts` constants:

  ```
  FRESH_NEW  = { chatTag:'from-chat', businessDays:2 }
  KEEPER     = { perDay:3, slotHour:0, slotMinute:5, lineHours:72, undoHours:72, holdDays:30 }
  DATE_READ  = { inventedMinDays:4, inventedMaxDays:6, deadPastDays:14, unclearSource:'date from the task, source unclear' }
  SUMMARY    = { minWords:120, maxWords:60, perRun:40, maxInputChars:6000 }   // 2b
  ARC_KEEPER = { staleDays:21, maxCreatePerNight:1, maxClosePerNight:5, linkCap:4 }   // 2c
  ```

  Plus `isFreshNew(task, userId, now)`.
- Tests are for the constants and the predicate.
- Checks: vitest on `rules.test.ts`, eslint on the two files, tsc.

**A3 (`select.ts`, `score.ts`, `copy.ts`)**
- Candidate gains `fresh`, `parkedBy: 'user'|'keeper'|null` and `arrived`. `parked` keeps meaning "hidden until `view_at`" for both, so `today.ts` needs no change.
- Placement changes:
  - Keeper-parked items go to rest group `scheduled`, not `parked`.
  - Ventures do not catch `fresh` items.
  - A boosted older thread goes to its People list.
  - A boosted wait that is not in view goes to Next.
- `meetsNextRule` (exported) adds `fresh` and `arrived`. `nextCompare` puts boosted first, then fresh, then class.
- Hard date precedence and chip with source, as above. Rule 7 extended to `Task.hard_due_at`.
- Everything else items per group, one row per item, with these check texts:

  | Group | Check text | Owner |
  |---|---|---|
  | scheduled, parked | "Back {Thursday, November 12}" | You |
  | waiting that meets Next | "Joins Next when a row frees up" | You |
  | waiting with no day | "Gets a day in tonight's sort" | You |
  | held projects (one row per project, from `held_projects`) | "When {project} starts" | The {project} project |
  | review pieces (one row per fold) | "With the {project} sign-off" | The {project} sign-off |
  | new mail (one row) | "Shows after one business day" | You |
  | older threads | "No set day. Open the thread to answer or close it." | You |
  | ventures | "No set day. Other hat." | You, other hat |

  - `can_bring_forward` is true for task, session, wait and thread candidates; false for crisis and the group rows.
  - `past_check` is true when `check_at` has passed and the item is still in rest.
- New copy: the "New from the chat." and "New, made by you." why lines with their reason; arrival "Back today, after waiting its turn."; the Everything else lines and scope line exactly as written in "What Mike sees". `everythingElseLine` changes, so `copy.test.ts` must be updated.
- Handled: merge `keeper_lines` with the classifier auto-closes, newest first, keeping the cap of 5.
- Tests to add:
  - from-chat and self-made tasks listed in Next ahead of class 1 and behind boosted; gone after 2 business days
  - keeper-parked not shown; arrived in Next
  - user Not-now still `parked`
  - each check text
  - hard date precedence and both chip texts
  - rule 7 for `hard_due_at`
- Existing tests to update: `select.test.ts`, `score.test.ts`, `copy.test.ts`. `tonight.test.ts` and `copy-guard.test.ts` must pass unchanged.
- Checks: vitest on the five files, eslint, tsc.

**A4 (`load.ts`, `state.ts`)**
- Task select adds `hard_due_at`, `hard_due_source`, `created_by_id`.
- Held-project tasks are read as `groupBy project_id` with names into `held_projects`. `held_project_task_count` stays as the sum.
- `keeper_lines`: `home_actions` where user is U, `source = 'keeper'`, `created_at` within 72 hours, `undone_at` null. Text and details come from `after.line` and `after.details`, which the keeper writes.
- `state.ts`: the new fields in the read mapping, in `HomeItemStatePatch`, and in upsert.
- `load.test.ts` has Prisma call-shape assertions; update them.
- Checks: vitest on the two tests, eslint, tsc.

**A5 (task API)**
- POST and PATCH schemas accept:
  - `hard_due_at: z.string().datetime().nullable().optional()`
  - `hard_due_source: z.string().trim().min(3).max(200).nullable().optional()`
- Refine both schemas: a non-null `hard_due_at` needs a source; `hard_due_at: null` clears the source too.
- `due_date` is not touched. GET task responses are unchanged (the home loader reads Prisma directly), so no other screen's payload changes.
- Registry entries in `tasks.ts` for both fields.
- Tests: set, clear, missing source is 400, `due_date` untouched.
- Checks: vitest on the two tests plus `app/api/tasks/__tests__/bast-chat-filter.test.ts`, eslint, tsc.

**A6 (`create-task.py`, W2-06, staged in `citadel-tasks-next`)**
- New `--hard-due DATE` and `--hard-due-source TEXT`. Both or neither; the source goes through the existing content guard.
  - It sends `hard_due_at`, `hard_due_source`, and `due_date` set to the same date, so other screens still see the date.
  - No 5-day limit.
  - `--due` together with `--hard-due` is an error.
- `--due` is unchanged for every caller.
- With no date flag:
  - If the resolved assignee is Mike (`KNOWN_USER_IDS['mike']` or the live `/api/users` match), send no `due_date` and print "No date: the home screen gives it a day." to stderr.
  - Anyone else still gets `default_due()`.
  - `build_post_payload` no longer raises on a missing `due_date`.
- Warn on stderr, never refuse, when `--what` runs over 60 words.
- Update the header docstring.
- Tests:
  - Mike with no date sends no `due_date`; Sabeen still gets the default.
  - `--hard-due` without a source is an error; both flags together is an error.
  - A hard due date 30 days out is fine.
  - Update `test_requires_title_assignee_due`.
- Checks:

  ```
  python3 -I -m unittest discover -s /home/mike/.claude/tools/citadel-tasks-next/tests
  bash /home/mike/.claude/tools/citadel-tasks-next/tests/test_guard.sh
  ```

  The test file's `MODULE_PATH` is relative, so it tests the staged copy.

**A7 (machine job)**
- `home_keeper.py`:
  - `--dry-run` sends GET; the default sends POST.
  - Writes `last.json` atomically.
  - Exit codes: 0 ok or skipped, 1 HTTP error, 2 config error.
  - A 404 logs once a day and exits 0 (not deployed yet).
- `home-keeper.sh` as described above; it sources `/home/mike/.config/bast/claude-env.sh`, which is needed in 2b.
- README covers: run, dry run, pause, install, the job-watch entry, and the standing rule that only cron sends the POST.
- Tests use a fake Citadel on 127.0.0.1, as job-watch's do: dry run sends only GET; POST once; 404 is quiet; pause file means no request; the token never appears in argv or the log.
- Check: `python3 -I -m unittest discover -s /home/mike/.claude/tools/home-keeper/tests`.

**A8 (seed)**
Extend the existing seed (it already refuses anything but `localhost:55433`). Add:
- a kickoff task tagged `from-chat`,`kickoff` with a client and no date
- a quote task tagged `from-chat`,`quote`
- 12 undated plain tasks for Mike, aged 10 to 40 days
- three dated tasks: one exactly 5 days after creation, one 40 days past, one 10 days ahead created 30 days ago
- one task with `hard_due_at` and source "domain renews" due in 2 business days
- one task Mike Not-now'd until tomorrow
- one task with a 300-word description (for 2b)

Check: the seed run against `home_s2a` exits 0.

**A9 (act, undo, chat)**
- `bring_forward`: sets `boosted_at = now`, `view_at = null`, `view_set_by = null`. Undoable. Message "Moved to the front of Next."
- `not_now` writes `view_set_by: 'user'`.
- `runHomeUndo`: when `row.source === 'keeper'`, use compare-and-set on each field, set `keeper_hold_until`, and put back only the visible fields (`view_at`, `view_set_by`, `read_hard_due_at`, `read_hard_due_source`, `card_summary`, `card_checklist`). The record kinds for 2c arcs are added in C1.
- Chat:
  - `lineFor` in `ops/home.ts` gets a `bring_forward` line: `"{title}" moved to the front of Next.`
  - The `OpLine` union and its text in `actions.ts` gain it.
  - `route-helpers.ts` `ownerToday` lists only `parkedBy === 'user'` as parked.
- Update the `act.test.ts` patch-shape assertions.
- Checks:

  ```
  npx vitest run lib/home/__tests__/act.test.ts lib/bast-chat/ops/__tests__/home.test.ts lib/bast-chat/ops/__tests__/ops-route.test.ts lib/bast-chat/__tests__/route-helpers.test.ts lib/bast-chat/__tests__/actions.test.ts app/api/bast-chat/__tests__/worker-routes.test.ts
  ```

  Then eslint and tsc.

**A10 (keeper core)**
- Pure functions: `planStagger(sel, states, now, tz)`, `planDates(tasks, states, now)` and `keeperLines(plan)`.
- `runKeeper(db, ownerId, now, {dryRun})`:
  1. Load and select, the same as `GET /api/home`.
  2. Plan.
  3. In a transaction (timeout 30 s): take the `home_keeper_runs` row, then the `updateMany` writes guarded on the before-values, then one `home_actions` row per kind with before, after, line and details. Skip a kind with 0 changes.
  4. Write `counts`.
- Dry run returns the plan and writes nothing.
- Unit tests:
  - never more than 3 a business day, counting user returns
  - no weekend slots
  - items in view, boosted, pinned, held and those under a hold get no day
  - assigned days are stable on the next run
  - the three date classes
  - undo then the next run leaves held items alone
- **`slice2.integration.test.ts`** (the local run on `home_s2a`, skipped unless the URL is scratch). It seeds its own users (owner admin `home`, an admin `overlook`, a tech) and asserts, building the screen through `loadHomeInputs`, `selectHome` and `assembleHomeResponse` as the GET does:
  - The kickoff and quote tasks are in `sections.next` with the fresh why line.
  - The keeper gives the 12 undated tasks days, 3 per business day, at 00:05 ET.
  - The Not-now'd task keeps its date and `view_set_by` user.
  - A second run says `already_ran` and the row counts are unchanged.
  - The 5-day and 40-days-past dates are set aside; the 10-day one reads with "(date from the task, source unclear)"; the "domain renews" task is in Needs you now with its chip.
  - Every Everything-else item has an owner and a check text, and the counts add up.
  - Handled has two keeper lines with `undo_action_id`. Undo clears the unchanged items and skips the one Mike changed after the keeper.
  - `bring_forward` puts an item at the top of Next.
  - A keeper run with the owner switched to `overlook` writes zero rows.
  - The tech and overlook admin have zero `home_item_state` rows, and none of their tasks changed `updated_at`.
- Checks: vitest on `keeper/__tests__`; `DATABASE_URL=...home_s2a npx vitest run lib/home/__tests__/slice2.integration.test.ts`; eslint; tsc.

**A11 (route, lane, registry)**
- Route GET (plan) and POST (run). Body cap via `chatWorkerBody`. Errors through `chatError`. `Cache-Control: no-store`.
- Lane: add `r('GET','/api/bast-chat/worker/home-keeper')` and `r('POST','/api/bast-chat/worker/home-keeper')`.
- Registry entries in group `bast-chat`. The notes say: owner only; skipped unless the owner's `home_view` is `home`; POST runs once per zoned day; GET writes nothing.
- Route tests:
  - 401 when signed out
  - 403 for a session, for another lane, and for an unenforced key
  - skipped when `home_off`
  - GET writes nothing (mock asserts no writes)
  - POST calls `runKeeper` once
- Checks: vitest on the route test plus `lib/auth/__tests__/lane-scopes.test.ts`, `lib/api/registry/__tests__/registry.test.ts`, `app/api/docs/__tests__/route.test.ts`; eslint; tsc.

**A12 (UI)**
- Everything else tile:
  - The left list stays the groups.
  - The right card becomes `RestGroupCard`: the two heading lines, then every item as a row (title, owner, check text). "Bring it forward" sits on rows where `can_bring_forward` is true and calls `useHomeAct({action:'bring_forward'})`, then refetches.
  - The list scrolls inside the card.
- Handled detail card: shows `details` lines muted, and an "Undo" button when `undo_action_id` is set (`useHomeUndo`). Toast "Put back."
- Tests: rows and buttons render; Bring it forward posts the right body; Undo posts the id; no button on group rows.
- Checks: vitest on the three tests plus `no-red.guard.test.ts` and `copy-guard.test.ts`; eslint; tsc.

**A13 (gate; exit codes decide)**
1. `npx prisma validate`.
2. Fresh DB `home_s2a_gate`: `migrate deploy`, then the drift check with `--exit-code`.
3. `npx tsc --noEmit`: no error beyond the A0 baseline.
4. Targeted vitest:

   ```
   npx vitest run lib/home components/domain/home app/api/home lib/bast-chat app/api/bast-chat app/api/tasks/__tests__ lib/services/__tests__/task-patch.test.ts lib/auth/__tests__/lane-scopes.test.ts lib/api/registry/__tests__/registry.test.ts app/api/docs/__tests__/route.test.ts "app/(app)/dashboard/__tests__/page.test.tsx" app/api/users/me/preferences/__tests__/route.test.ts lib/hooks/__tests__/use-home.test.ts
   ```

5. Whole suite `npx vitest run`: no new failing file against the baseline.
6. eslint on every added or modified `.ts` and `.tsx` file: 0 errors.
7. `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx next build`.
8. The A10 integration test on a freshly seeded `home_s2a`.
9. Machine tests: the home-keeper tests, and `citadel-tasks-next` tests plus `test_guard.sh`.
10. Plain-text grep on new user-facing strings, which must print nothing:

    ```
    grep -nE '—|–|[Pp]riorit|[Oo]verdue' /home/mike/.claude/tools/home-keeper/*.py /home/mike/.claude/tools/home-keeper/*.sh
    ```

    The copy guard covers the TypeScript.
11. Allowed files: `git -C W diff --name-only origin/main` lists only the files in the table above.
12. Untouched paths: this must print nothing:

    ```
    git -C W diff origin/main -- app/components/domain/dashboard app/components/layout app/app/globals.css app/app/api/waiting-on-me app/app/api/today app/app/api/dashboard "app/app/(app)/oracle" "app/app/(app)/dashboard"
    ```

13. By eye (recommended, not gating): `DATABASE_URL=...home_s2a npx next dev -p 3100` signed in as the fixture admin: drawer, Bring it forward, Handled Undo, the chat tasks in Next. Sign in as the tech fixture: the normal Overlook.
14. Commit on the branch only when steps 1 to 12 pass. Commit messages end with the attribution lines from the session rules.

### Deploy, 2a

1. Push the branch, then merge to `main` (open question 5). Watch the deploy run: `gh run watch` until it is green.
2. Production, GET only:
   - Mike's home screen loads.
   - `DRY_RUN=1 /home/mike/.claude/tools/home-keeper/home-keeper.sh`, which sends one GET to the keeper route with the chat key and writes nothing. Check `last.json` and the counts.
   - A chat message still works: one Not now and its Undo through the chat.
3. Machine:
   - Backups first:

     ```
     crontab -l > /home/mike/.local/log/crontab-backup-20261111-homekeeper
     cp jobs.json jobs.json.bak-20261111-homekeeper
     cp create-task.py create-task.py.bak-20261111-hard-due
     ```

     (`jobs.json` is in `~/.claude/tools/job-watch/`, `create-task.py` in `~/.claude/tools/citadel-tasks/`.)
   - Copy `create-task.py` and `tests/test_create_task.py` from `citadel-tasks-next`. Re-run its tests in place.
   - Run `npm --prefix /home/mike/.claude/tools/bast-chat test`. Its real-script test runs the real `create-task.py`.
   - Add the jobs.json entry with `install_pending`.
   - `install -m 755 /home/mike/.claude/tools/home-keeper/home-keeper.sh /home/mike/.local/bin/home-keeper.sh`.
   - Add the crontab line, then remove `install_pending`.
   - `python3 /home/mike/.claude/tools/job-watch/job_watch.py --dry-run`: the row is not `failing`, and the crontab line count matches the rows.
4. The first real run is the 02:35 cron. Nobody sends the POST by hand.
5. Rollback options:
   - `touch ~/.home-keeper-paused`
   - his Undo lines on the home screen
   - revert the merge (the tables and columns stay, unused)
   - restore the `create-task.py` backup

---

## SLICE 2b: card summaries written by Bast

### What Mike sees

A card whose task description runs over about 120 words opens on a short version: 1 to 3 sentences, at most 60 words. A muted line under it reads "Short version by Bast." "Original notes" still opens the full task.

If the text names several deliverables and the task has no checklist, a "Done when" list appears with one line each (only when there are 2 or more).

A quiet line appears: "Wrote short versions of 9 long cards. The full notes stay one click away." with Undo.

With no summary yet, the card shows exactly what it shows today: the first paragraph of the description cut at about 60 words on a word boundary. There is no "pending" text.

### Where the model runs, which model, what it costs

- **Where.** On the machine, in `~/.claude/tools/home-keeper/summarize.py`, step 2 of the same nightly wrapper. It uses the stored Claude login from `claude-env.sh`, the same way the canary and next-step-refresh do. There is never an API key in Citadel, and Citadel makes no model call.
- **Call:**

  ```
  claude -p <prompt> --model haiku --output-format json --tools "" --strict-mcp-config --no-session-persistence --max-budget-usd 0.05
  ```

  run from `/home/mike/.local/state/home-keeper/cwd`, an empty folder, so no project instructions load.
- **Model: Haiku.** The job is summarizing a few hundred words of task text against fixed rules, and the output is checked in code. If quality is poor, switch `"model": "sonnet"` in `/home/mike/.config/home-keeper/config.json`; the allowlist is haiku or sonnet only.
- **Cost bound.**
  - At most 40 cards a run, in-view cards first.
  - Input capped at 6,000 characters each.
  - $0.05 per call.
  - The run stops once the summed `total_cost_usd` reaches $1.00.
  - Expected about $0.15 a night. The backlog clears over a few nights.
  - Each call is logged with `model-ledger.py log-pass --source home-keeper-summaries`.

### Task list, 2b (worktree `citadel-home2b-wt` from `origin/main` after 2a is live)

| Id | What | Files | Depends | Model |
|---|---|---|---|---|
| B0 | Setup, baseline, DB `home_s2b` | plan copy | none | Haiku low |
| B1 | Citadel side | `app/lib/home/keeper/summaries.ts` and test; `app/app/api/bast-chat/worker/home-keeper/summaries/route.ts` and test; `app/lib/auth/lane-scopes.ts`; `app/lib/api/registry/bast-chat.ts`; `app/lib/home/select.ts`; `app/lib/home/types.ts`; `app/components/domain/home/ItemCard.tsx`; tests `select.test.ts`, `ItemCard.test.tsx`, `app/lib/home/__tests__/slice2b.integration.test.ts` | B0 | Sonnet medium |
| B2 | Machine side | `/home/mike/.claude/tools/home-keeper/summarize.py`, `prompts/card-summary.md`, `tests/test_summarize.py`, `home-keeper.sh` (step 2), `README.md` | B0 | Sonnet medium |
| B3 | Gate | none | B1, B2 | Sonnet medium |

B1 and B2 run in parallel. The contract between them is fixed here:

- **`GET .../home-keeper/summaries?limit=40`** returns `{items:[{item_key, task_id, title, text, hash, has_checklist}]}`.
  - Only the owner's open tasks whose plain description is over 120 words, and whose `card_summary_hash` does not equal the sha256 of the current description.
  - Items under a keeper hold are left out.
  - In-view first, then by rank.
- **`POST .../home-keeper/summaries`** takes `{items:[{item_key, hash, summary, done_when?}]}`, at most 40.
  - It refuses an item whose summary is over 60 words or has a dash, "priority", "priorities" or "overdue". The response lists each refusal; the others are saved.
  - It skips items whose hash no longer matches.
  - It writes the state fields and one keeper `home_actions` row with the line, which is undoable.
- `select.ts` uses `card_summary` only when the hash matches the current description. Otherwise it falls back to the Slice 1 summary.
- `HomeItem.opened` gains `summary_by: 'bast'|null`.
- **B2 tests:** a fake Citadel plus a fake `claude` placed first on PATH that returns fixed JSON. They check:
  - the cost stop and the 40 cap
  - a bad reply is skipped, not posted
  - argv has `--tools ""` and the haiku or sonnet allowlist
  - `DRY_RUN` makes no model call
- **B3:** the 2a gate list with its own files, the 2b integration test on `home_s2b`, and both machine test suites.
- **Deploy:**
  1. Push to `main`, deploy green.
  2. Add `"summaries": true` to `/home/mike/.config/home-keeper/config.json`. The wrapper skips step 2 without it.
  3. Run `DRY_RUN=1` once (GETs only, no model call).
  4. The jobs.json entry is unchanged (same wrapper and same `last.json`, now with a `steps.summaries` field).

---

## SLICE 2c: real Arc records and stale-arc housekeeping (built now, switched OFF)

### What Mike sees, once he says yes

With `arcs_create` on, a day built around a client or project that has no open arc gets a real arc on the Seeing Stone board: "Made the arc {name} with 4 of your tasks."

With `arcs_close` on:
- An arc whose steps are all done is closed: "Closed the arc {name}: every step is done."
- An arc untouched for 21 days is closed: "Closed the arc {name}: the 3 tasks left are still tracked."

With `arcs_link_tasks` on, his add and remove edits on the day's arc are copied to `Task.arc_id` for his own tasks. That closes Slice 1 open question 2.

Every one of these has Undo. Nothing is ever deleted; undoing a create closes the arc and unlinks the tasks still pointing at it.

**Until he says yes, he sees nothing.** The dry-run GET lists "would make" and "would close" lines for Bast to show him.

### Rules

- **Create.** At most 1 a night. Only for the group Today would propose, when it has 2 or more of his open tasks and no open Arc with that `client_id` or `project_id`. Name is the client or project name; description "Made by the home screen's nightly sort." Links up to 4 of his open tasks with `arc_id` null.
- **Close.** At most 5 a night.
  - Never today's `home_day.arc_id`.
  - Never an arc holding an open task of another human (anyone not Mike and not in `BOT_USER_IDS`).
  - "Stale" means the arc's `updated_at` and every task's `updated_at` are older than 21 days and it is not snoozed.
- **Link.** Only tasks with `assignee_id` Mike whose `arc_id` is null. On remove, only tasks whose `arc_id` equals that arc.

### Task list, 2c

| Id | What | Files | Depends | Model |
|---|---|---|---|---|
| C0 | Setup, DB `home_s2c` | plan copy | none | Haiku low |
| C1 | Arc planner, writer, undo | `app/lib/home/keeper/arcs.ts` and test, `app/lib/home/keeper/run.ts`, `app/lib/home/keeper/plan.ts`, `app/lib/home/keeper/lines.ts`, `app/lib/home/act.ts` (arc undo record kinds, compare-and-set on `closed_at` and `arc_id`), `app/lib/home/__tests__/act.test.ts` | C0 | Sonnet medium |
| C2 | Seed and local run | `app/scripts/seed-home-fixtures.ts` (a stale arc, an all-done arc, an arc holding Sabeen's task, a client group with no arc), `app/lib/home/__tests__/slice2c.integration.test.ts` | C1 | Sonnet medium |
| C3 | Gate | none | C1, C2 | Sonnet medium |

- **C2 asserts:**
  - With no settings row: the dry run lists the arcs, the real run writes no Arc or Task row.
  - With each switch on: the writes happen, the arc holding Sabeen's task is untouched, undo works.
  - Sabeen's task never changes.
- **Deploy:** push and go green; nothing else. Switching on happens only after Mike's yes, with one data-only migration (the bast-chat-enable pattern):

  ```sql
  INSERT INTO home_keeper_settings (id, user_id, arcs_create, arcs_close, arcs_link_tasks, created_at, updated_at)
  VALUES (gen_random_uuid(), <his id>, ..., now(), now())
  ```

---

## SLICE 3: quieter chrome for his user only

All of it hangs off `UserPreference.home_view = 'home'`, which is set only for Mike. There is no new schema. One switch turns it all off.

### What Mike sees

- **Every Citadel page:** the sidebar is folded away and a "Menu" button in the header opens the full menu at any width. The bell is gone.
- **Mentions from bots stop.** Bast or another bot mentioning him on a task no longer makes a notice in Citadel, Slack or email. People's mentions are unchanged.
- **Tasks Bast stopped on are listed.** So that muting loses nothing, a task assigned to Bast or another bot and tagged `needs-mike` shows in Decisions ready.
  - Who: "Bast". Why: "Bast stopped on this and needs you."
  - Footer: "If you do nothing: Stays with Bast, stopped, until you answer on the task."
  - Buttons: Open, Not now, This matters more. No Done and no "I'll do it now" (it is Bast's task). It never becomes a Today step and the keeper never gives it a day.
- **Settings has a "First screen" card** for admins, with "Home screen" and "Overlook". Its help text: "Home screen also hides the bell, folds the sidebar behind Menu, and quiets mentions from Bast and other bots."
- **Coming back to a pinned item.** When an item is pinned and he comes back to the tab after 20 minutes or more away, the bar reads "You were on this." with "Still on it", "Done" and "Stop for now".

### Task list, Slice 3 (worktree `citadel-home3-wt`; T1, T2, T4 and T5 can start tonight from `origin/main`; T3 starts after 2a is merged; rebase before T6)

| Id | What | Files | Depends | Model |
|---|---|---|---|---|
| T0 | Setup, baseline, DB `home_s3` | plan copy | none | Haiku low |
| T1 | Shell | new `app/components/layout/AppShell.tsx`, `app/app/(app)/layout.tsx`, `app/components/layout/Header.tsx`, `app/components/layout/MobileNav.tsx`, new `app/components/layout/__tests__/AppShell.test.tsx`, `app/components/layout/__tests__/MobileNav.test.tsx` | T0 | Sonnet medium |
| T2 | Bot mention mute | `app/lib/services/notifications.ts`, `app/app/api/tasks/[id]/comments/route.ts`, `app/app/api/comments/[id]/route.ts`, `app/app/api/troubador/articles/[id]/comments/route.ts`, new `app/lib/services/__tests__/notifications-bot-mention.test.ts`, and the three route tests beside those routes | T0 | Sonnet medium |
| T3 | `needs-mike` source | `app/lib/home/load.ts`, `select.ts`, `actions-for.ts`, `copy.ts`, `types.ts`, `today.ts` and their tests (`load`, `select`, `actions-for`, `copy`, `today`) | 2a merged | Sonnet medium |
| T4 | "You were on this" | new `app/components/domain/home/away.ts`, `WorkingOnBar.tsx`, new `__tests__/away.test.ts`, new `__tests__/WorkingOnBar.test.tsx` | T0 | Sonnet medium |
| T5 | Settings card | `app/app/(app)/settings/page.tsx`, new `app/app/(app)/settings/__tests__/first-screen.test.tsx` | T0 | Haiku low |
| T6 | Seed, local run, gate | `app/scripts/seed-home-fixtures.ts` (a Bast task tagged `needs-mike`; a bot comment mentioning the home admin and the tech) | T1 to T5 | Sonnet medium |

**T1 (shell)**
- `AppShell` is a client component inside `AppProviders`. It reads `usePreferences()`: `home = data?.preferences?.home_view === 'home'`.
  - It renders `<Sidebar collapsed={home} />`, `lg:pl-60` only when not home, and `<Header homeChrome={home} />`.
  - While loading or on error, `home` is false, so the chrome is exactly today's. Mike may see the sidebar for a moment on a cold load; that is accepted.
- `layout.tsx` keeps its server-side checks and replaces only the inner markup with `<AppShell>{children}</AppShell>`.
- `Header`:
  - `homeChrome` drops `lg:hidden` from the Menu button and adds the visible word "Menu".
  - `homeChrome` does not render `NotificationBell`.
  - It passes `anyWidth` to `MobileNav`, which drops `lg:hidden` on the overlay and the panel.
- `DesignStaffShell` and `Sidebar.tsx` are not edited.
- Tests (overlook, missing and error preferences render today's chrome; home renders the new chrome):
  - Overlook, missing and error: bell present, `lg:pl-60` present, sidebar not collapsed, Menu hidden on wide screens.
  - Home: no bell, sidebar collapsed, Menu visible, clicking it opens the nav.

**T2 (mute)**
- `CreateNotificationParams` gains `actorUserId?: string`.
- When the type is `task_mentioned`, the actor is in `BOT_USER_IDS`, and the recipient's `UserPreference.home_view` is `home`: return without creating a row or dispatching.
- The three comment routes pass `auth.userId` (troubador passes the comment author).
- Tests:
  - muted: home user plus bot actor
  - not muted: home user plus human actor; overlook user plus bot actor; `comment_added` from a bot
- Update the three route tests' `createNotification` call assertions for the new field.

**T3 (`needs-mike` source)**
- Loader: open, non-deleted tasks with `assignee_id` in `BOT_USER_IDS`, tag `needs-mike`, project status not excluded. Mark them `bot_task: true`.
- Always meets the Next rule.
- Excluded from Today steps and from the keeper pool. Check the keeper pool is filtered to the owner's assignee id, or add that filter in this task.
- `actionsFor` gives Open plus the home actions.

**T4 (away prompt)**
- `isLongAway(hiddenAt, now, 20 min)` is pure.
- `useAwayReturn` listens to `visibilitychange`.
- "Still on it" only closes the prompt.
- Tests use fake timers: 19 minutes away shows no prompt, 20 minutes shows it.

**T6 gate**
- tsc against baseline.
- vitest:

  ```
  npx vitest run components/layout app/(app)/settings lib/services/__tests__ app/api/tasks app/api/comments app/api/troubador lib/home components/domain/home lib/bast-chat "app/(design)/__tests__/layout.test.tsx" "app/(app)/dashboard/__tests__/page.test.tsx"
  ```

- Whole suite against baseline, eslint, `next build`.
- Allowed files.
- Untouched paths: `app/components/domain/dashboard`, `app/app/globals.css`, `app/components/layout/Sidebar.tsx`, `app/components/domain/design`, `app/app/api/dashboard`.
- Local run: `next dev -p 3100` on `home_s3` with the seed.
  - As the fixture admin with `home`: Menu, no bell, the Bast `needs-mike` row in Next, the bot mention makes no notification row (check with `psql`), and the 20-minute prompt (fake time in the unit test only).
  - As the tech fixture: the normal sidebar and bell, and the bot mention does make a row.
- **Registry:** no route changes.
- **Deploy:** push to `main`, deploy green. Mike's chrome changes at once because his `home_view` is already `home`. Turning it all off: Settings, First screen, Overlook.

---

## Off by default, waiting for Mike's yes

1. **Keeper arc writes (2c),** all off, with no `home_keeper_settings` row:
   - making real arcs (`arcs_create`)
   - closing done and stale arcs (`arcs_close`)
   - copying his arc edits into `Task.arc_id` (`arcs_link_tasks`)

   Ask him: "May the nightly sort make an arc for the day's client when none exists, close arcs whose steps are all done or that sat 21 days, and copy your arc edits onto your own tasks? Each shows a line with Undo. Nothing is ever deleted, and arcs holding someone else's open task are left alone."
2. **Nothing in 2a, 2b or 3 messages anyone, hands work to anyone, or changes anyone else's task.** The keeper writes only his home rows. `create-task.py` drops the invented date only on tasks filed to him. The mute affects only his notifications.

## Open questions (each with the recommendation builders will follow)

1. **The keeper's key.** Reuse the existing enforced `bast-chat` lane key and add three keeper routes to that lane (no new credential), or mint a separate `home-keeper` key, which needs his yes before the job can run.
   - **Recommended:** reuse the chat key. It is already the Bast-on-his-home-rows identity and already allowed to make the same writes through the `home` op.
2. **The one-time date reading** turns undated-source future dates, and dates less than 14 days past, into chips reading "(date from the task, source unclear)". That can pull several tasks into Decisions ready on the first morning.
   - **Recommended:** yes, as design 2A.6 says ("nothing is quietly lost"), with the Undo line.
3. **The bot mention mute** covers Citadel, Slack and email, paired with listing Bast's `needs-mike` tasks. If it were in-app only, the worker's escalations would keep pinging Slack.
   - **Recommended:** all three channels plus the listing. Without the listing, muting would hide the worker's questions, because those tasks are assigned to Bast.
4. **Pace of return.** 3 a day spreads about 150 waiting tasks over roughly 10 weeks.
   - **Recommended:** keep 3 (design 2A.4 and 4). He can "Bring it forward" any of them from the drawer.
5. **Deploying.** Push each sub-slice to `main` after its gate is green, without waking Mike, under his standing "when you're finished go ahead and push to citadel" and "Yes just keep going" on nightly sorting.
   - **Recommended:** yes for 2a, 2b and 3. 2c deploys with every switch off.

## Risks worth naming

- **The first night is busy.** One undoable action per kind, compare-and-set undo, and the 30-day hold keep it reversible. The pause file stops it.
- **Email-classifier tasks still carry their own 5-day dates.** It creates tasks through the API, not through `create-task.py`. The date reading sets those aside as invented, but the classifier itself is not changed. That is a follow-up.
- **The chat daemon does not yet offer "Bring it forward" or hard dates.** The Citadel side accepts both and nothing breaks; the daemon prompt gets them in a follow-up.

### Critical files for implementation
- /home/mike/.openclaw/workspace/citadel/app/lib/home/select.ts
- /home/mike/.openclaw/workspace/citadel/app/lib/home/act.ts
- /home/mike/.openclaw/workspace/citadel/app/lib/home/types.ts
- /home/mike/.openclaw/workspace/citadel/app/lib/auth/lane-scopes.ts
- /home/mike/.claude/tools/citadel-tasks/create-task.py