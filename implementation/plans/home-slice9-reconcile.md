# Build plan: the sent-mail reconciler (home screen Slice 9)

Nothing was changed while writing this plan. It was checked against:
- Citadel `main` f021d6e (read-only checkout) and the uncommitted worktree `/home/mike/.openclaw/workspace/citadel-sessionfix-wt` (branch `fix/session-card-clear`).
- `specs/home-slices-2-3-plan.md`, `home-slices-4-6-plan.md` and `home-slices-7-8-plan.md`.
- The last twelve sections of `DECISIONS.md`, including this morning's drafter loop and its fix.
- The live code:
  - `app/lib/home/**`, including `act.ts` (undo), `load.ts` (`KEEPER_ACTIONS`) and `item-key.ts`
  - `app/lib/bast-chat/` (`task-filter.ts`, `ops/*`, `actions.ts`)
  - `lib/services/task-patch.ts`, `lib/waits/*`, `app/api/waits/route.ts`
  - `app/api/time-entries/*`, `app/api/clients/[id]/retainer/route.ts`, `lib/calculations/retainer.ts`
  - the `Task`, `Comment`, `Wait`, `EmailAsk`, `OracleSession`, `Project`, `TimeEntry`, `HomeAction` and `HomeKeeperSettings` models
- The machine:
  - `email-classifier.py` (`_mike_reply_after`, `MIKE_ADDRESSES`) and `mail_mirror.py`
  - `~/.claude/tools/owed-reply/` (`drafter.py` with its `Gate` and `refused.json`) and `~/.claude/tools/home-keeper/`
  - `~/.claude/tools/citadel-tasks/create-task.py` and `~/.claude/tools/job-watch/jobs.json`
- One read-only query of the mail mirror's metadata, to size the work. No message body was read.

**Facts from the code that shape this plan**
1. **The mirror already holds what the reconciler needs.**
   - It mirrors `mike@becomeindelible.com`, `mike@whoismikedion.com` and `bast@becomeindelible.com`. `is_sent` comes from Gmail's SENT label.
   - In the last 14 days Mike sent 72 messages from his two accounts (about 5 a day). Bast sent 65 from bast@, mostly alerts to Mike. Those must be left out: they are not Mike's words.
   - Both real cases are visible in the metadata:
     - Kue: "Re: SPAM ON WEBSITE - Griswold Controls - September Website Report", from mike@whoismikedion.com on Nov 9.
     - Phil Camp: six sends to The Vermont Standard on Nov 10 and 11, from mike@becomeindelible.com.
2. **Bodies come only from `mail_mirror.fetch_body`.** It runs `gog ... get --format full`, which is read-only, and returns the whole plain part with the quoted text in it. Nothing in the mirror splits a reply's new text from the quote.
   - The classifier's `_mike_reply_after` checks SENT per thread and closes only `EmailAsk` rows. It never touches tasks, and the reconciler leaves it alone.
   - The classifier's `MIKE_ADDRESSES` also lists hello@, which is not mirrored.
3. **The chat lane can already change task status, but the reconciler cannot use the chat's route.**
   - Through `guardChatTaskBody` and `patchTask` (with an `expect` compare-and-set), the chat lane can set any task's status. Through the `comment` op it writes an internal, Bast-authored note with a reach check.
   - But `POST /api/bast-chat/worker/ops` needs a running conversation. It records into `BastChatAction`, whose `conversation_id` is required with `onDelete: Restrict`.
   - So the reconciler gets its own worker route. That route calls the same library functions (`patchTask`, `guardChatTaskBody`, the comment writer, `checkComment`) and records into `home_actions`, the way the keeper does.
4. **Nothing creates a "waiting on a person" wait today.**
   - The `wait` op only changes waits that already exist. `POST /api/waits` builds waits from templates.
   - The closest template, `portal.awaiting_client`, files a liaison task after 5 business days.
   - A new template entry costs no enum change. A wait on Mike that does not block a client stays at visibility level 1, so it never sends a Slack DM (`sweeper.ts`, step 5).
5. **Clearing a session question is being built now, and is not merged.**
   - The worktree `citadel-sessionfix-wt` has `home_item_state.session_cleared_at` and `session_cleared_hash`, `sessionAskHash()`, `loadSessionAsksFor()` and `GET /api/bast-chat/worker/session-asks/:id`.
   - Its migrations are `20261115010000_home_session_clear` and `20261115020000_home_on_day`.
   - Slice 9 starts after that branch merges. Its migrations are `20261115030000` and `20261115040000`.
6. **What Handled for you can show today.**
   - Lines come from `home_actions` rows with source `keeper`, an action in `KEEPER_ACTIONS` (`load.ts`), for 72 hours.
   - A keeper Undo is compare-and-set and puts a 30-day `keeper_hold_until` on the item.
   - `HomeQuietLine` has one link and one undo id. It has no second button and no time choice, so both are added.
7. **`start_project` does not fit work that is already under way.** It makes a hidden project (status `queue`) with a kickoff task meant for Bast's planning worker. Phil Camp needs a different writer, built from the `start-common.ts` helpers (`createStartTask`, `pickSite`, `inOneTransaction`, `abandonStartTask`).
8. **Project next steps.**
   - `NextStepSource` is `graph | bast | mike`.
   - `POST /api/oracle/projects/:id/refresh` only stamps `next_step_refresh_requested_at`. The engine polls every 2 minutes and rewrites the step from tasks and comments.
   - So "propose the next step" means: stamp a re-read after a note or a close lands. The step text is written directly only on Mike's tap.
9. **How time counts.** `TimeEntry` has `user_id`, `task_id`, `project_id`, `started_at`, `ended_at`, `duration` (minutes), `is_running`, `description`, `is_billable` (default true), `hourly_rate` and `is_deleted`. It has no source field.
   - `DELETE /api/time-entries/:id` is a soft delete (`is_deleted: true`). So Undo is a soft delete and needs no new column.
   - **What a time entry needs for the retainer report** (`app/api/clients/[id]/retainer/route.ts`) to count it:
     - `is_billable` true, not deleted, `started_at` inside the month
     - its task not deleted and not `is_support`
     - the task in a project of that client, or an ad hoc task with that `client_id`
     - and one of: the task is `is_retainer_work`, the project is `is_retainer`, or the client has `retainer_hours` and the task has no `billing_amount`
   - The retainer health badge (`lib/calculations/retainer.ts`) is stricter. It counts only entries whose own `project_id` points at a project of that client. So an entry should carry the task's project, and tasks should sit in a project.
10. **Lessons from this morning's drafter loop.** Keep one copy of each rule. Ask Citadel with a dry POST before writing anything. Keep a local refusal ledger and never retry a refusal. Count refusals. For Slice 9 that means:
    - The quoted-text splitter exists only on the machine, the only place bodies exist.
    - Matching, the evidence rules, caps, holds and dedupe exist only in Citadel TypeScript.
    - Python checks only the shape of the model's JSON.
11. **Mike's press on a Bast draft sends Bast's words.** `home_owed_thread.draft_hash` and `short_draft_hash` hold the hash of every draft Bast wrote. A sent body that hashes the same is not Mike's own statement. It never counts as evidence that he did something.

## 0. Rules for every builder

- **Repo.** `/home/mike/.openclaw/workspace/citadel` is read-only.
  - Each sub-slice gets its own worktree from `origin/main`: `/home/mike/.openclaw/workspace/citadel-home9a-wt` and `citadel-home9b-wt`, on branches `feat/home-slice9a` and `feat/home-slice9b`.
  - `W` is the worktree and `A` is `W/app`. Every check runs from `A`.
  - 9a starts only after `fix/session-card-clear` has merged to main.
- **Shell rules (put these in every agent prompt).**
  - Absolute paths only. Never `cd` in a command that deletes. Never `rm` a relative glob.
  - Delete nothing outside your own scratchpad. Never push, never merge.
  - No production calls except the GET-only steps written in a deploy section.
  - Agents never call `/api/cron`, `/api/engine`, sweep, recheck or refresh routes, or any worker POST. They never run a wrapper without `DRY_RUN=1`. Only cron sends real runs.
  - Never run `gog` against a real account in a test. Tests put a fake `gog` and a fake `claude` first on `PATH`.
- **Scratch Postgres.** Container `citadel-home-mig-check` on `localhost:55433` (user and password `citadel`).
  - Each integration file runs alone on its own clean database, made fresh for that run: `docker exec citadel-home-mig-check psql -U citadel -d postgres -c 'CREATE DATABASE home_s9a_int'` (then `_int2` and so on for reruns). Then `migrate deploy`, then that one file.
  - Integration files make their own fixtures inside the test. They never edit `scripts/seed-home-fixtures.ts`.
  - Leave the container running.
- **Scripts.** `npx ts-node -r tsconfig-paths/register --compiler-options '{"module":"CommonJS"}'`. Integration files are `*.integration.test.ts` and skip unless `DATABASE_URL` names `localhost:55433`.
- **On a failed check,** re-dispatch once with the stderr, then escalate.
- **Dependencies.** None new. Python is stdlib only, run with `python3 -I`. `mail_mirror.py` is imported by path, read-only, and never changed. Neither is `email-classifier.py`.
- **Text on Mike's screen, in comments and in prompts.**
  - Plain words. No em or en dash. Never "priority", "priorities" or "overdue".
  - `copy-guard.test.ts` covers `lib/home` (so `lib/home/reconcile/` too) and `components/domain/home`. Gates grep the machine scripts and prompts.
  - A dash inside Mike's own quoted words is shown as " - ".
- **Models.** Builders use Sonnet medium for implementation and Haiku low for setup, lane, registry and one-line wiring. No Opus or Fable builders. No attack round (Mike's ruling: an owner-only tool). Verification is the executed gate.
- **Migrations.**
  - Nullable or defaulted columns and new tables only. No `ALTER TYPE`.
  - Names: `20261115030000_home_reconcile_9a` and `20261115040000_home_reconcile_9b`. If another migration merged with a later name, rename your folder at rebase, before the gate.
- **Shared files** are `select.ts`, `types.ts`, `load.ts`, `actions-for.ts`, `copy.ts`, `act.ts`, `item-key.ts`, `ItemCard.tsx`, `HomeScreen.tsx`, `home-screen-logic.ts`, `use-home.ts`, `lane-scopes.ts` and the registry.
  - Only the task marked (W), plus the named Haiku lane task, edits them.
  - Before starting, those tasks run `git -C W fetch origin && git -C W rebase origin/main`.
  - New logic lives in `app/lib/home/reconcile/`.
- **Everything is for the owner only:** `BastChatSettings.owner_user_id`, an active admin with `home_view = home`. Anything else answers `{skipped:"home_off"}` and writes nothing. No other user's screen, counts or rows change.

**Order.**
1. 9a (proposals, auto-notes, Track it with time) ships first, today.
2. 9b (auto-apply) follows on its own branch after 9a merges.
3. 9c (Mike's own Citadel comments as a second input) is planned later and not built now.

---

## The binding table: what it may do on its own, and what is only a card

| What his sent mail shows | Applied on its own, as one Handled line with Undo | Only as a one-tap card |
|---|---|---|
| A note of what he said, on **his own** open task the message is about | **9a** | |
| A note on his own task tagged `security`, `security-report`, `lifeline` or `job-watch*` | **9a** (the note only) | Marking it done: always a card, with the remaining open points listed |
| He says he did the work on his own open task, and every evidence rule holds | **9b**: mark done | 9a: a card. 9b: a card whenever any rule fails. |
| He did his part and asked them for something, on his own task | **9b**: a wait on that person, and the task moves to "Waiting on them" | 9a: a card |
| His message answers a session question (`OracleSession.waiting_on`) | **9b**: clear it through the home row (`session_cleared_hash`) | 9a: a card |
| He asked someone for something and no task covers it | **9b**: start the wait "Waiting on {person} since {date}" | 9a: a card |
| A note or a close landed on a task of a project | **9b**: stamp the project's next-step re-read | |
| Anything on someone else's task (a note included) | never | card |
| Work with no task or project in Citadel (the Phil Camp case) | never | **Track it** card, with estimated time, placement and next step |
| Anything touching billing, price, scope or dates owed to a client | never | card, or nothing |
| A time entry | never, by any automatic path or by the chat | His tap on the home screen only (Track it, or "Log time?") |
| Model confidence `medium`, or any code rule fails | never | card |
| Confidence `low`, or a hedged or future statement ("I'll", "going to", "should be") | nothing | nothing |
| A message Bast drafted and he pressed Send on | never | at most a Track it card |
| Look-back mail (36 hours to 14 days old, first run only) | never, and no notes either | cards, in the drawer only |

**Caps.**
- 9a: at most 20 auto-notes a day and 10 new cards a day in normal running. The look-back makes at most 25 cards in all.
- 9b: at most 6 auto-changes a day (done, waiting, session, wait together). Past the cap, an auto-change becomes a card.
- **The breaker (9b).** Two "This was wrong" taps within 7 days stop all auto-changes. Notes and cards go on. One line says so and offers "Turn it back on".

---

## How confidence is decided (one copy, `app/lib/home/reconcile/evidence.ts` and `decide.ts`)

**The model gives a verdict:** `{action, target_id, quote, confidence: high|medium|low, said_by_mike_past_tense, remaining_open[], ...}`.

**Code then decides, and code always wins.** A change is applied on its own only when **all** of these hold. Otherwise it becomes a card (when confidence is medium or better) or nothing.
1. **The message is his.**
   - Account `mike@becomeindelible.com` or `mike@whoismikedion.com`, SENT label, not DRAFT, TRASH or SPAM.
   - From one of `MIKE_ADDRESSES`. Never bast@.
   - At least one recipient outside our own addresses and outside automated addresses (the `rules.ts` patterns). So no note to self.
   - Not an auto-reply or calendar answer (subject starting "Accepted:", "Declined:", "Automatic reply", "Out of office").
   - Not Bast's words (fact 11).
2. **The target is his.** The task is assigned to the owner, open (`not_started`, `in_progress` or `blocked`) and not deleted. It was created before the message was sent.
3. **The target is free to change.**
   - No reconcile hold on it, and none of the four protected tags.
   - Not `client_visible`, not source `portal`, no open approval request.
   - No task waits on it (no unblock cascade) and no open wait is linked to it.
   - The reach check (`checkComment` or the task reach check) says no tap is needed.
4. **Match basis, recomputed by Citadel from the database (the machine's opinion is never trusted).** At least one of:
   - `thread`: the task's `source_ref` is an RFC id in the message's cross-thread set, or an `EmailAsk` with this `task_id` sits on that thread, or `origin_url` names the thread.
   - `client` and `subject`: a recipient is a `ClientContact` of the task's client, or the recipient's domain is a site domain of that client. In both cases the subject and new text share at least 2 distinctive tokens with the task title, with token overlap of 0.3 or more.
   - `site` and `subject`: a site domain of the task appears in the new text, plus the same overlap.
5. **The quote is his own new words.**
   - It sits word for word (whitespace collapsed) inside `new_part`.
   - It does not appear in `quoted_part`.
   - At most 2 sentences and 400 characters.
6. **The tense rule.**
   - The quote holds a completion marker: a first-person past-tense verb ("I removed", "we fixed", "I've sent", "I have updated"), "is done", "is live", "is up", "is fixed", "has been", or, for a delivery, "here is", "here's" or "attached".
   - It holds none of these: `will`, `'ll`, `going to`, `plan`, `planning`, `hope`, `should`, `could`, `might`, `may`, `try`, `trying`, `tomorrow`, `next`, `soon`, `later`, `once`, `when I`, `if`, `not yet`, `haven't`, `didn't`, `still`, `?`.
7. **Nothing stays open.** For done, the model's `remaining_open` is empty after code intersects it with the task's real open checklist items. Any real open item makes it a card that lists them.
8. **No commitment.** No sentence of `new_part` that matches the task hits the owed commitment patterns (money, time, scope). These are imported from `lib/home/owed/checks.ts` (`OWED_CHECK`), not copied.
9. **The model is sure.** Confidence `high` and `said_by_mike_past_tense: true`.
10. **Running state allows it.** Not look-back. `reconcile_auto` on. Breaker not tripped. Daily cap not reached.

**A note needs less:** rules 1, 2 (or a protected tag), 4 and 5, confidence `medium` or better, and the model saying the message is about this task. A note never changes status.

**Fixture.** `app/lib/home/reconcile/__tests__/fixtures/evidence-cases.json` holds at least 60 cases (`{quote, new_part, quoted_part, ok, reason}`). It must include:
- passes: "I removed the File Manager plugin." and "Here is the sample page for the Phil Camp memorial."
- refusals: "I'll remove it tomorrow.", "Should be fixed now?", "Kue removed it." (not him), a sentence found only in the quoted part, and "I fixed it and the invoice is $400." (money)

---

## SLICE 9a (ships today): read sent mail, match, propose; auto-notes; Track it with time

### What Mike sees change

**1. Notes on his own tasks.** When an email he sent is about one of his own open tasks, Bast adds an internal note to that task within about 15 minutes. The job runs every 15 minutes, 07:00 to 22:59 Eastern. The note reads:

> From Mike's sent mail. Email to Kue Chen on Monday, November 9: "I removed the File Manager plugin." Open the email: {gmail thread link}

**2. Handled for you gets one line per note,** with Undo for 72 hours:
- The line: `Noted on "Griswold: clean up the hacked site" from your email to Kue Chen, November 9.`
- Its detail card shows:
  - the quote
  - "Open the email"
  - **Undo** (hides the note; nothing is deleted)
  - **This was wrong** (hides the note and keeps Bast from changing that task from his mail for 90 days)

**3. Cards.** Each card is its own row of type `proposal`.
- Only one sits in Decisions ready at a time. Security cards come first, then Track it, then the newest.
- The rest are in the drawer group **"From your sent mail"**.
- Look-back cards live only in the drawer.
- Every card shows:
  - the quote, with the recipient and date
  - "Open the email"
  - a "Why Bast asks" line
  - If you do nothing: "Stays here. Nothing changes until you tap."

**The Kue card (a security task):**
- Title: `Your email says you removed File Manager. Mark this done?`
- Lines:
  - `Your email to Kue Chen, Monday, November 9: "I removed the File Manager plugin."`
  - `Still open on this task: {each real open checklist item, joined}` (left out when there are none)
  - `Why Bast asks: it is a security task, so Bast never closes it on its own.`
- `Log time with it:` none (default), 15, 30, 60, 90, 120, or a number field. Shown only when the task has no time entries.
- Buttons: **Mark it done**, **Not yet** (the usual Not now), **No** (closes the card; this task is never proposed done again).

**Other card titles:**
- Someone else's task: `Your email to {name} is about Sabeen's task "{title}". Add a note?`
- Waiting: `You asked {name} for {what}. Wait on them?`
- Session question: `Your email to {name} answers "{session title}". Clear the question?`
- Done on his own task, when 9b would not act alone: `Your email says you {did phrase}. Mark this done?`

**The Phil Camp card (work not in Citadel):**
- Title: `You built and sent a sample page for Phil Camp. Track it?`
- Lines:
  - `Your email to The Vermont Standard, Tuesday, November 10: "{his quote}"`
  - `Done: Build and send the Phil Camp sample page (Tuesday, November 10).`
  - `Time spent: about 1 hour 30 minutes. This is Bast's estimate from 6 emails over 2 days and one Bast session of about 1 hour 40 minutes. Change it before you tap.` Below it: 15, 30, 60, 90, 120 and a number field. The estimate is preselected.
  - `Counts toward The Vermont Standard's retainer for November.` Shown when the client has `retainer_hours`. Otherwise: `Logged as billable time. Change that on the task page.` A **Not billable** choice sits beside it.
  - `Where it goes: {project name}.` Shown when one live project fits. When no live project exists: `No project for this yet.`
  - `Next: Get them on a call. They asked for a meeting on Wednesday, November 11.`
  - `Later: Get the content and images from them. Launch the page.`
- Buttons:
  - **Track it**: into the named live project. When there is none, the tasks are filed to the client with no project.
  - **Start a project for it**: a new live project. This is the first button when no live project exists, and the second otherwise.
  - **Not now**
  - **No, leave it**: never proposed again.
- If you do nothing: `Stays here for two weeks, then goes quietly. Nothing is made until you tap.`
- Toast after Track it: `Tracked: 4 tasks and 1 hour 30 minutes on The Vermont Standard. Undo`

**4. One piece of work is proposed once.**
- Later emails in the same thread add to the open card's evidence; they never make a second card.
- A card he said No to never comes back.
- A card closes quietly when its task closes another way, when a matching project or task appears, or after 14 days.

**5. The first run looks back 14 days.**
- Mail from the last 36 hours runs normally.
- Older mail (36 hours to 14 days) only makes cards, at most 25, all in the drawer. It writes no notes and changes nothing.

### Rules

**Placement for Track it** (pure, `reconcile/placement.ts`). "Live" means a project with status `ready`, `in_progress` or `review`.
1. The model named a candidate live project of that client, and its name or open tasks overlap the work: put the tasks there.
2. Else, the client has exactly one live project with `type = retainer` or `is_retainer`: put them there.
3. Else, the client has exactly one live project: put them there.
4. Else, no project: "Track it" files the tasks to the client with no project. "Start a project for it" is the first button.
- A project with status `quote`, `queue`, `suspended`, `cancelled` or `done` is never chosen.

**What "Track it" writes** (one transaction, in `reconcile/track.ts`, using `start-common` helpers):
- **A project, only for "Start a project for it".**
  - `type project`, `status in_progress`, `client_id` and `site_id` (`pickSite`), name from the card, created by the Bast user.
  - No billing, budget or rate field is touched.
  - `next_step_text` is the card's next step, with `next_step_owner_id` Mike and `next_step_source bast`.
- **The done task.**
  - Title from the card, assignee Mike, status `done`, `completed_at` = the send time of his delivering email.
  - `estimated_minutes` = the minutes chosen. Client, project and site set.
  - Tags `from-sent-mail`. `origin_url` = the gmail thread link.
  - Description: summary, the quote, the link and "Logged after the fact from your email of {date}."
- **The next-step task:** not started, assigned to Mike, no due date (the keeper gives it a day), description with the thread link.
- **The later tasks:** not started, assigned to Mike. Each is blocked by the next-step task, so they stay out of view until the call is done.
- **One `TimeEntry`, only when minutes are chosen.**
  - `user_id` Mike, `task_id` the done task, `project_id` the task's project (or null).
  - `started_at` = send time minus the minutes, `ended_at` = send time, `duration` = minutes.
  - `is_running` false, `is_billable` true unless he picked Not billable, `hourly_rate` null.
  - `description`: `Estimated, logged after the fact from your email of {date}.`
  - No column is added.
- **Card rules (W2-06) are followed in code.** Short summary descriptions. More than one deliverable goes on the checklist. Extras are links. These writes happen inside Citadel on his tap, so they are not machine-created tasks and `create-task.py` is not involved.

**Time estimate** (formed by the match model, bounded by code):
- **The model is given:**
  - his messages in the thread over the work window (count, dates, what each delivered, attachment names)
  - any Bast sessions in that window linked to the client or project, with their start and last-event times
  - the shape of the work
- **The model returns:** `minutes` and a one-line `estimate_basis`.
- **Code then:**
  - rounds to 15 and clamps to 15 to 480
  - counts each session's span at most 180 minutes
  - uses 30 minutes with the basis "no detail in the mail" when the model gives nothing
- **The screen always says** "Bast's estimate" and the basis. Nothing is saved until his tap.

**Light time prompt.** When he taps Mark it done on a card (9a) or Bast marks a task done (9b), and that task has no non-deleted time entries, one prompt appears: "Log time? 30 min" with the same choices.
- The default comes from the task's own `estimated_minutes`, else the model's estimate, else 30.
- His tap creates one `TimeEntry` on that task, dated the day of the email, with the same description rule.

**Who may create time entries.** Only `POST /api/home/reconcile`. It is session-only: `requireHomeUser()`, the same door as 4b's `/api/home/send`, so API keys are refused and the chat key cannot reach it. `homeActSchema` refuses `track_it` and `log_time`, with an invariant test.

**Card taps the chat may also make** (through `runHomeAct`, Mike's instruction in chat): yes on a done, waiting, session, wait or note card with no time, No, and Not now.

### Schema (migration `20261115030000_home_reconcile_9a`)

```prisma
// On User, with the other home back-relations:
  home_reconcile_messages HomeReconcileMessage[] @relation("HomeReconcileMessageUser")
  home_reconcile_changes  HomeReconcileChange[]  @relation("HomeReconcileChangeUser")
  home_reconcile_holds    HomeReconcileHold[]    @relation("HomeReconcileHoldUser")

// On HomeKeeperSettings:
  // Slice 9a: the sent-mail reconciler reads his sent mail, writes notes on his own tasks and makes cards. No row means off.
  reconcile_on Boolean @default(false)

// Slice 9a: one row per sent message the reconciler processed, for that user only. A message is processed once.
model HomeReconcileMessage {
  id           String    @id @default(uuid()) @db.Uuid
  user_id      String    @db.Uuid
  user         User      @relation("HomeReconcileMessageUser", fields: [user_id], references: [id], onDelete: Cascade)
  message_key  String    @db.VarChar(300)  // RFC Message-ID, lowercased, no brackets; else "<account>/<gmail_id>"
  account      String    @db.VarChar(255)
  gmail_id     String    @db.VarChar(64)
  thread_id    String    @db.VarChar(255)
  sent_at      DateTime
  to_label     String?   @db.VarChar(300)  // "Kue Chen" or "Kue Chen and 2 others"
  subject      String?   @db.VarChar(500)
  outcome      String    @db.VarChar(20)   // nothing | noted | proposed | acted | refused | bast_words | skipped
  refusal      String?   @db.VarChar(200)
  lookback     Boolean   @default(false)
  filter_model String?   @db.VarChar(20)
  match_model  String?   @db.VarChar(20)
  cost_usd     Decimal   @default(0) @db.Decimal(10, 4)
  wrong_at     DateTime?                   // "This was wrong" on any change from this message
  created_at   DateTime  @default(now())
  changes      HomeReconcileChange[]
  @@unique([user_id, message_key])
  @@index([user_id, sent_at])
  @@map("home_reconcile_message")
}

// Slice 9a: one evidence-carrying change: a note, an auto change (9b) or a card. Every row keeps the quote and the link.
model HomeReconcileChange {
  id               String    @id @default(uuid()) @db.Uuid
  user_id          String    @db.Uuid
  user             User      @relation("HomeReconcileChangeUser", fields: [user_id], references: [id], onDelete: Cascade)
  message_id       String    @db.Uuid
  message          HomeReconcileMessage @relation(fields: [message_id], references: [id], onDelete: Cascade)
  kind             String    @db.VarChar(12)  // note | done | waiting | session | wait | track | step
  mode             String    @db.VarChar(10)  // auto | card
  state            String    @default("open") @db.VarChar(12) // card: open | applied | dismissed | expired | undone; auto: applied | undone
  target_key       String?   @db.VarChar(300) // task:<id> | session:<external id> | wait:<id> | project:<id> | null for track
  dedupe_key       String    @db.VarChar(300) // note:<task>:<message> | done:<task> | waiting:<task> | session:<key>:<hash> | wait:<thread root>:<email> | work:<client or domain>:<thread root>
  title            String    @db.VarChar(300)
  lines            Json?                        // card lines (open points, the track plan), server-built
  plan             Json?                        // server-built: exactly what the tap performs
  quote            String?   @db.VarChar(400)
  quote_to         String?   @db.VarChar(300)
  quote_at         DateTime?
  link             String?   @db.VarChar(1000)  // gmail thread link
  confidence       String    @db.VarChar(8)     // high | medium
  basis            String[]  @default([]) @db.VarChar(20) // thread | client | site | subject
  reason           String?   @db.VarChar(200)   // why it is a card
  minutes_estimate Int?
  estimate_basis   String?   @db.VarChar(300)
  home_action_id   String?   @db.Uuid           // the Handled line, or his tap
  comment_id       String?   @db.Uuid
  time_entry_id    String?   @db.Uuid           // only ever set by his tap
  created_ids      Json?                        // {project_id?, task_ids[]} made by Track it
  shown_until      DateTime?                    // card expiry (14 days)
  created_at       DateTime  @default(now())
  resolved_at      DateTime?
  @@unique([user_id, dedupe_key])
  @@index([user_id, state])
  @@index([user_id, target_key])
  @@map("home_reconcile_change")
}

// Slice 9a: a target the reconciler leaves alone (after Undo 30 days, after "This was wrong" 90 days).
model HomeReconcileHold {
  id         String   @id @default(uuid()) @db.Uuid
  user_id    String   @db.Uuid
  user       User     @relation("HomeReconcileHoldUser", fields: [user_id], references: [id], onDelete: Cascade)
  target_key String   @db.VarChar(300)
  until      DateTime
  reason     String   @db.VarChar(20)  // undo | wrong | no
  created_at DateTime @default(now())
  @@unique([user_id, target_key])
  @@map("home_reconcile_hold")
}
```

The migration is three `CREATE TABLE`s with foreign keys and indexes, and one `ADD COLUMN` on `home_keeper_settings`. No `ALTER TYPE`. A separate data-only migration, `20261115031000_home_reconcile_on`, sets `reconcile_on = true` for the chat owner (upsert, every other column left alone).

### Routes

- **`GET /api/bast-chat/worker/reconcile`** (chat key; writes nothing; also the dry run). Returns:
  - `{owner_ok, on, auto:false, caps:{notes_left, cards_left}}`
  - `processed:[message_key]` for the last 21 days
  - `holds:[target_key]`
  - `bast_draft_hashes:[sha256]` from `home_owed_thread`, last 21 days
  - `lookback_done`: true once a row with `lookback=true` exists and the machine marked the end. The marker is a `home_keeper_runs` row of kind `reconcile_lookback`.
  - Or `{skipped:"home_off"}`.
- **`POST /api/bast-chat/worker/reconcile/candidates`** (chat key; strict body; at most 10 messages; 64 KB; **writes nothing**).
  - Body: `{messages:[{message_key, account, thread_id, thread_rfc_ids[], to[{email,name}], cc[], subject, sent_at}]}`.
  - Returns per message:
    - `client|null`
    - `tasks[]`, at most 8: id, title, mine, status, tags, protected, client and project names, up to 6 open checklist items, `basis[]`, `free_to_change`
    - `sessions[]`: asks parked on him, with text capped at 600, plus sessions in the work window, with start and last-event times
    - `waits[]` open on the thread
    - `projects[]`: the client's live projects
    - `retainer:{hours}|null`
    - `tracked_hint`: an open or dismissed `work:` card for the same thread root or client
- **`POST /api/bast-chat/worker/reconcile`** (chat key; strict body; at most 10 messages; 128 KB).
  - Body: `{dry:boolean, messages:[{message_key, account, gmail_id, thread_id, thread_root, sent_at, to_label, subject, lookback, bast_words, new_part (≤ 6,000 chars, never stored), quoted_part_hash, filter:{model,cost_usd}, match:{model,cost_usd}|null, outcome:'nothing'|'actions', actions:[...]}]}`.
  - Each action is one of:
    - `{type:'note', task_id, quote, confidence}`
    - `{type:'done'|'waiting', task_id, quote, confidence, past_tense, remaining_open[], did_phrase, wait_on?:{email,name,what}}`
    - `{type:'session', session_key, quote, confidence}`
    - `{type:'wait', wait_on:{email,name,what}, quote, confidence}`
    - `{type:'track', title, done_title, next_step, later[], client_id|null, project_id|null, minutes, estimate_basis, quote, confidence}`
  - The server:
    - recomputes the basis
    - runs every evidence rule
    - checks the target was among that message's candidates
    - applies caps, holds and dedupe
    - decides note, card or nothing per action
    - with `dry:true` returns the decisions and writes nothing
  - Without `dry`, in one transaction per message:
    - the message row (a second POST for the same `message_key` answers `already` and writes nothing)
    - the notes (comment as the Bast user, internal, `client_visible` false; same writer as `ops/comment.ts`)
    - one `home_actions` row per note: source `reconcile`, action `reconcile_note`, `undo_until` 72 hours, `after.line`, `after.details`, `before.reconcile`
    - the cards
  - Reply: `{messages:[{message_key, outcome, decisions:[{i, result:'noted'|'carded'|'nothing'|'refused', reason?}]}]}`. Refusal reasons are plain codes: `quote_not_new`, `quote_long`, `not_open`, `not_candidate`, `held`, `duplicate`, `already`, `bad_shape`, `bast_words`.
- **`POST /api/home/act`** gains `{action:'proposal_yes'|'proposal_no', item_key:'proposal:<uuid>'}`.
  - `proposal_yes` runs the card's stored `plan` after re-checking it: the task still open and still the same assignee.
  - It covers done, waiting, session, wait and note cards with no time. A Track it card or a time choice answers 400 "Tap this on the home screen."
  - Undo works as for any home tap.
- **`POST /api/home/reconcile`** (session only, `requireHomeUser()`):
  - `{action:'track_it', item_key, placement:'project'|'new_project'|'none', minutes:int|null, billable:boolean}`
  - `{action:'log_time', task_id, minutes, day}`
  - `{action:'proposal_yes', item_key, minutes}` (a done card with a time choice)
  - Writes as described, and one `home_actions` row (source `home`) with `before.reconcile` for Undo.
- **`POST /api/home/undo`** accepts `{action_id, wrong?: true}`. `wrong` is allowed only on source `reconcile` rows. It does the Undo, then puts a 90-day hold on the target and stamps `wrong_at` on the message.

**Undo of reconcile records** (new branch in `runHomeUndo` for `before.reconcile`, compare-and-set throughout, nothing deleted):
- A note: `comment.is_deleted = true`, only when not already hidden.
- Track it:
  - Tasks it made go to `abandoned` only while still as it left them: done task still `done`, others still `not_started` and Mike's.
  - A project it made goes to `cancelled` only while still `in_progress` with no other tasks.
  - Its time entry is soft-deleted (`is_deleted = true`) only while `duration` and `started_at` are unchanged.
- `log_time`: soft-delete that entry under the same rule.
- Done, waiting, session and wait cards: their 9b undo rules (below).
- After every Undo: a 30-day hold on the target and `state='undone'`.
- If anything changed since: "Changed since. Open the task."

### The machine job (`/home/mike/.claude/tools/sent-reconciler/`)

**Files:**
- `reconciler.py` (the run)
- `mailread.py` (selection, body, split, Bast-words check, bundle)
- `shape.py` (model JSON shape checks only)
- `prompts/filter.md`, `prompts/match.md`
- `sent-reconciler.sh`, `README.md`
- `tests/`: fakes for `gog`, `claude` and Citadel, plus a temp mirror

**Each run:**
1. The wrapper checks the pause file `~/.sent-reconciler-paused`, the fleet pause file, `flock` and the config `/home/mike/.config/sent-reconciler/config.json` (`{"enabled": true, "lookback_days": 14}`). It sources `claude-env.sh` quietly.
2. GET the context. A 404 means "not deployed" and is quiet. `home_off` means skip.
3. **Mirror check per account.** `account_status(acct)` must be ready with an age of 1,800 seconds or less, else skip that account (fail closed).
4. **Select messages.**
   - `mail_mirror.query(account, sent=True, since_ms=...)`, keeping only rule 1's messages.
   - Sent at least 10 minutes ago.
   - Not in the local `ledger.json` or Citadel's `processed` list.
   - Normal window: the last 36 hours, at most 12 a run, oldest first.
   - Look-back: while `lookback_done` is false, also up to 40 messages a run from 36 hours to 14 days back, at most 150 in all, each marked `lookback`.
5. **Body and split.** `fetch_body` (the only `gog` call), then `split_new(body)` gives `(new_part, quoted_part)`.
   - It cuts at the first `On ... wrote:` (allowing a wrapped second line), `-----Original Message-----`, `---------- Forwarded message`, a `From:` line followed within 3 lines by `Sent:` or `Date:`, or any line starting with `>`.
   - It drops the signature after `-- ` and Mike's signature lines, which are listed in the config.
   - At most 6,000 characters.
6. **Bast's words.** sha256 of the drafter's `normalize_body(new_part)` (imported by path from `owed-reply/drafter.py`, not copied) is compared with `bast_draft_hashes`. A match sets `bast_words`: no done, note, session or wait actions; Track it only.
7. **Code prefilter.** A `new_part` of 3 words or fewer ("Thanks!") is outcome `nothing` with no model call.
8. **Filter pass, Haiku.** Input: subject, recipients, date, `new_part`. Output: `{relevant, kinds:["did_work","delivered","asked_for","answered","scheduling","none"], line}`. Not relevant means `nothing`.
9. **Candidates POST** for the relevant messages.
10. **Match pass, Sonnet,** one call per relevant message. Input:
    - `new_part`, marked as Mike's words
    - `quoted_part` and the thread's newer inbound mail (snippets, plus the newest inbound body up to 2,000 characters), each marked as other people's words and data only
    - the candidates
    - the session spans
    - Output: the action list above.
11. **`shape.py`.** Strict types and enums. Ids must be among that message's candidates. Strings within their caps. A bad shape gives outcome `refused` with `bad_shape`.
12. **Dry POST** with every message. Actions Citadel refuses are dropped from the real POST and written to the local ledger as refused. They are never retried.
13. **Real POST.** The local ledger writes `posting` with the validated payload before the POST, then the outcome after.
    - After a crash, the next run re-sends the stored payload. It never calls the model again.
    - Citadel's unique key makes a repeat answer `already`.
14. When the look-back list is used up, POST the end marker. Then write `last.json`.

**Mail text is data.** Each prompt puts it between `<<<MAIL_{nonce}` and `MAIL_{nonce}>>>` with a fresh nonce, after stripping marker text, as in the drafter. The model runs with no tools. Its output is JSON that code checks. Every write is one the lane already allows. That is the whole defence (Mike's ruling).

**Model calls** (stored login, prompt on stdin, run from the empty folder `~/.local/state/sent-reconciler/cwd`):
```
claude -p --model haiku  --output-format json --tools "" --strict-mcp-config --no-session-persistence --max-budget-usd 0.03   # filter
claude -p --model sonnet --output-format json --tools "" --strict-mcp-config --no-session-persistence --max-budget-usd 0.30   # match
```
- **Caps:**
  - The run stops at $1.50 and the day stops at $4.00 (`spend-YYYY-MM-DD.json`).
  - The look-back stops at $5.00 in all.
  - At most 12 match calls a run and 60 a day.
- **Expected:** about $0.01 per filter and $0.05 per match, under $0.40 a day. The look-back is about $3.
- **Ledger,** one line per call:
  ```
  python3 ~/.claude/tools/model-ledger/model-ledger.py log-pass --source sent-reconciler --model haiku --effort low --task <message_key> --sop reconcile-filter --tier haiku-low --outcome ok|invalid|failed --duration-ms N --exit-code N --cost-usd X
  python3 ~/.claude/tools/model-ledger/model-ledger.py log-pass --source sent-reconciler --model sonnet --effort medium --task <message_key> --sop reconcile-match --tier sonnet-medium --outcome ok|invalid|failed --duration-ms N --exit-code N --cost-usd X
  ```

**The key and state.**
- The chat key is read from `/home/mike/.citadel-bast-chat-token` (override `SENT_RECONCILER_KEY_FILE`) and sent as a header, never in argv.
- State lives in `/home/mike/.local/state/sent-reconciler/`:
  - `last.json` and `last-dry-run.json`
  - `ledger.json` (message_key to outcome, payload when posting, timestamp; kept 60 days)
  - `spend-*.json`
- Log: `/home/mike/.local/log/sent-reconciler.log`.

**`DRY_RUN=1`:** the GET, mirror selection and split only. No model, no candidates, no POST. It prints the messages it would read.

**Crontab:**
```
*/15 7-22 * * * /home/mike/.local/bin/sent-reconciler.sh >> /home/mike/.local/log/sent-reconciler.log 2>&1
```

**Job watch entry,** added with `"install_pending": true` before the crontab line:
```json
{"id":"sent-reconciler","title":"Sent-mail reconciler","short":"the sent-mail reconciler","match":"sent-reconciler.sh","owner":"bast","client_facing":false,"out_of_scope":false,"evidence":"state_json","path":"/home/mike/.local/state/sent-reconciler/last.json","ts_field":"run_at","ok_field":"ok","pause_files":["/home/mike/.sent-reconciler-paused"],"honours_fleet_pause":true,"since":"2026-11-11","impact":"what Mike says in his sent mail stops reaching his tasks as notes and cards","check_first":"Read the last lines of /home/mike/.local/log/sent-reconciler.log and last.json."}
```

### Task list, 9a

| Id | What | Files it owns | Depends on | Model |
|---|---|---|---|---|
| M0 | Worktree (after `fix/session-card-clear` merged), `npm ci`, baseline tsc and vitest into the scratchpad, plan copy | `W/implementation/plans/home-slice9-reconcile.md` | none | Haiku low |
| M1 | Schema, migration, data migration | `app/prisma/schema.prisma`, `app/prisma/migrations/20261115030000_home_reconcile_9a/migration.sql`, `.../20261115031000_home_reconcile_on/migration.sql` | M0 | Sonnet medium |
| M2 | Reconcile core, pure | new `app/lib/home/reconcile/evidence.ts`, `match.ts`, `decide.ts`, `placement.ts`, `estimate.ts`, `dedupe.ts`, `copy.ts`; `__tests__/` for each, `__tests__/fixtures/evidence-cases.json` | M1 | Sonnet medium |
| M3 | Loader and store | new `reconcile/load.ts` (context, candidates), `reconcile/store.ts` (dry and real save, notes, cards, lines), `reconcile/note.ts` (comment writer built from `ops/comment.ts` helpers), tests | M2 | Sonnet medium |
| M4 | Taps and undo | new `reconcile/apply.ts` (card yes and no), `reconcile/track.ts` (Track it, time entry), `reconcile/time.ts` (log_time), `reconcile/undo.ts` (records, wrong, holds), tests | M2 | Sonnet medium |
| M5 | Wait template | `app/lib/waits/templates.ts` (`mail.awaiting_reply`), `app/lib/waits/templates.test.ts` | M0 | Sonnet medium |
| M6 | Worker routes | new `app/app/api/bast-chat/worker/reconcile/route.ts`, `.../reconcile/candidates/route.ts`, `__tests__/route.test.ts` for each | M3 | Sonnet medium |
| M7 | Home session route | new `app/app/api/home/reconcile/route.ts`, `__tests__/route.test.ts` | M4 | Sonnet medium |
| M8 | Lane and registry | `app/lib/auth/lane-scopes.ts` (three entries plus the comment count), `app/lib/api/registry/bast-chat.ts`, `app/lib/api/registry/dashboard.ts` | M0 | Haiku low |
| M9 (W) | Wire-in | `app/lib/home/item-key.ts` (`proposal:`), `types.ts`, `load.ts` (reconcile lines, cards), `select.ts` (proposal rows, one Decisions slot, drawer group `from_sent_mail`), `actions-for.ts`, `copy.ts`, `act.ts` (`proposal_yes`, `proposal_no`, undo branch, `wrong`), `app/app/api/home/undo/route.ts`, `app/lib/bast-chat/ops/home.ts`, `app/lib/bast-chat/actions.ts`, and their tests | M3, M4, M6, M7, M8 | Sonnet medium |
| M10 | Cards and Handled detail | `app/components/domain/home/ItemCard.tsx` (proposal block, time choices, placement buttons), `HomeScreen.tsx` and `home-screen-logic.ts` (This was wrong, Log time?), `app/lib/hooks/use-home.ts`, tests | M9 | Sonnet medium |
| M11 | Machine job | `/home/mike/.claude/tools/sent-reconciler/reconciler.py`, `mailread.py`, `shape.py`, `prompts/filter.md`, `prompts/match.md`, `sent-reconciler.sh`, `README.md`, `tests/test_reconciler.py`, `tests/test_mailread.py`, `tests/test_shape.py`, `tests/fakes/gog`, `tests/fakes/claude`, `tests/fixtures/*.eml.txt` | M0 (route shapes from this plan) | Sonnet medium |
| M12 | Local run | new `app/lib/home/__tests__/slice9a.integration.test.ts` | M9 | Sonnet medium |
| M13 | Gate | none (log in the scratchpad) | all | Sonnet medium |

**When each task can run.** No file appears in two rows.
1. M0, then M1, then M2.
2. In parallel: M3 and M4 (after M2); M5, M8 and M11 (after M0).
3. M6 after M3. M7 after M4.
4. M9 after the rebase. M10 and M12 in parallel after M9.
5. M13 last.

### Task details, 9a

**M2**
- `evidence.ts` exports `checkQuote(quote, newPart, quotedPart)`, `tenseOf(quote)` (`'done'|'hedged'|'none'`), `sentences(text)`, `commitmentHit(text)` (imports `OWED_CHECK`) and `plainQuote(q)` (dashes become " - ").
  - Every evidence-cases entry passes.
- `match.ts`: `basisFor(task, message, contacts, siteDomains)`, a pure token-overlap function with a named stop-word list.
- `decide.ts`: `decide(action, ctx)` gives `'note'|'card'|'nothing'` plus a reason, following the binding table. The 9b auto branch sits behind `ctx.auto`.
- `estimate.ts`: rounding, clamping and the basis words.
- `placement.ts`: the four placement steps.
- `copy.ts`: every string above, with `whyAsk(reason)`:
  - "it is a security task", "it is Sabeen's task", "Bast is not sure", "it is from older mail", "your email mentions a price or a date", "Bast wrote those words"
  - `noteText(...)`
  - `lineFor(kind, ...)`
- Checks: vitest on the folder, eslint, tsc.

**M3**
- The candidates loader runs only the queries named in Routes, for the owner. Sessions come from `loadSessionAsksFor` plus window sessions matched by arc client, project or title.
- `saveReconcile(db, userId, body, now, {dry})`: one transaction per message; with `dry` the same code path ends in a rollback.
- Tests:
  - a quote found only in the quoted part is refused
  - a second POST of a message gives `already`
  - a protected task gets a note and a done card, never an auto-change
  - someone else's task gets only a card
  - the look-back writes no notes
  - the caps turn the 21st note into a card
  - a dismissed `work:` key is never re-made
  - a later message in the same thread appends evidence to the open card

**M4**
- `track.ts` follows the "What Track it writes" list exactly.
- Tests:
  - the time entry has `project_id` equal to the task's project, `is_billable` per the choice, `started_at = sent - minutes`, and the description text
  - a retainer client's live retainer project is chosen
  - a quote, queue, suspended or done project is never chosen
  - Undo soft-deletes the entry and abandons the tasks; a task he edited after is left alone, with "Changed since"
  - `log_time` refuses a task that is not his

**M5**
- Add `mail.awaiting_reply`: kind `external`, enabled, `sends: false`, owner `client`, shepherd `mike`, `blocks_client: false`, title `Waiting on {subject}`, one step `bd(5)` `escalate` ("Comes into view on Mike's home screen: no answer yet."), `on_reply: 'stop'`.
- The test asserts it sends nothing and resolves to Mike when it has no contact. If `client` does not resolve that way, the owner becomes `mike`.
- 9a opens it only on a card tap.

**M6 and M7**
- Auth tests as in the 4a owed route: session, other lane and unenforced key refused.
- `home_off` skip. GET and candidates write nothing (the mock asserts no writes).
- 11 messages gives 400. An oversized body gives 413.
- `/api/home/reconcile` refuses any API key with 403.

**M8**
- Add `r('GET','/api/bast-chat/worker/reconcile')`, `r('POST','/api/bast-chat/worker/reconcile')` and `r('POST','/api/bast-chat/worker/reconcile/candidates')`.
- Update the lane comment: the route writes internal notes as Bast; nothing is sent.
- Add the registry entries, including `POST /api/home/reconcile` under dashboard ("session only; the only path that creates a time entry from the sent-mail cards").
- Checks: `lane-scopes.test.ts`, `lane-bast-chat.test.ts`, `registry.test.ts`, `app/api/docs/__tests__/route.test.ts`.

**M9 (wire-in)**
- `HomeItemType` gains `'proposal'`. `HomeRestGroupKey` gains `'from_sent_mail'` with the label "From your sent mail".
- `HomeQuietLine` gains `wrong_action_id: string|null` and `time_prompt: {task_id, minutes, day}|null`.
- `load.ts` reads source `reconcile` lines for 72 hours and the open cards.
- `select.ts`: one card in `next` (security first, then track, then newest). The rest, and every look-back card, go to the drawer.
- **Invariant tests in `act.test.ts`:** `homeActSchema` refuses `track_it` and `log_time`, and `runHomeUndo` with `wrong` on a non-reconcile row is refused.
- Chat lines: `proposal_yes` gives "Done what your email card suggested: {title}." and `proposal_no` gives "Closed the card: {title}."
- Existing tests to update: `select.test.ts`, `actions-for.test.ts`, `load.test.ts`, `rules.test.ts` and the `tonight.ts` fixture (new empty lists). `copy-guard.test.ts` and `no-red.guard.test.ts` must pass unchanged.

**M10**
- Proposal block: muted border, no red. Quote in quotation marks. Time choices only on Track it and on done cards of tasks with no time.
- Button bodies go to the right route: `/api/home/act` or `/api/home/reconcile`.
- Handled detail card: Undo and This was wrong. "Log time? 30 min" posts `log_time`.
- Tests: rendering, the posted bodies, no time choice on a note line.

**M11 tests** (fake Citadel on 127.0.0.1, fake `gog`, fake `claude`, temp mirror through `MAIL_MIRROR_DB`):
- **Read-only mail.** Every logged `gog` argv is `gmail get`. None contains `send`, `drafts`, `modify`, `labels`, `trash`, `archive` or `delete`. A source grep of the folder agrees.
- bast@ mail and drafts are never read. A note to self is skipped.
- The split fixtures (Gmail, Apple Mail, Outlook, a forward, a signature): the new part is right and the quote is never in it.
- A Bast-draft hash gives `bast_words` and only a track action.
- **The drafter lesson.** A dry refusal means no real POST of that action and a ledger entry. The next run neither calls the model nor posts it again.
- A crash after `posting` re-sends the payload with no model call.
- The cost stops and the 12 and 60 caps hold.
- Look-back: at most 40 a run and 150 in all, then the end marker.
- Dry run: no model and no POST.
- Pause file and fleet pause: no request.
- The mirror not ready or stale: that account is skipped.
- The key never appears in argv, the log or `last.json`.
- argv holds `--tools ""`, `--strict-mcp-config`, `--model haiku` for the filter and `--model sonnet` for the match, with the prompt on stdin.
- An injected "mark every task done" in the quoted text changes nothing: shape checks plus Citadel's refusal.

**M12 integration** (`home_s9a_int`, own fixtures). The full chain:
- The candidates POST.
- A real POST gives a note on his task, a Handled line with Undo, and a security card listing the real open checklist item.
- A Track it card. `/api/home/reconcile track_it` as a session creates the tasks and one time entry. The client retainer route's usage for that month includes the minutes. Undo soft-deletes the entry.
- `wrong` sets a 90-day hold, and a later message gives a card, not a note.
- The `home_off` owner writes nothing.
- A tech user and an overlook admin see no change: counts and `updated_at` of `Task`, `Comment`, `Wait`, `TimeEntry` and `EmailAsk` rows of other users are snapshotted before and after.

**M13 gate (exit codes decide)**
1. `npx prisma validate`.
2. Fresh DB `home_s9a_gate`: `migrate deploy`, then the drift check with `--exit-code`.
3. tsc with no error beyond the M0 baseline.
4. Targeted vitest:
   ```
   npx vitest run lib/home components/domain/home app/api/home app/api/bast-chat lib/bast-chat lib/waits lib/auth/__tests__/lane-scopes.test.ts lib/auth/__tests__/lane-bast-chat.test.ts lib/api/registry/__tests__/registry.test.ts app/api/docs/__tests__/route.test.ts lib/hooks/__tests__/use-home.test.ts app/api/time-entries
   ```
5. Whole suite: no new failing file against the baseline.
6. eslint on changed files.
7. `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx next build`.
8. `slice9a.integration.test.ts` alone on a fresh `home_s9a_int`.
9. `python3 -I -m unittest discover -s /home/mike/.claude/tools/sent-reconciler/tests`.
10. This must print nothing:
    ```
    grep -nE '—|–|[Pp]riorit|[Oo]verdue' /home/mike/.claude/tools/sent-reconciler/*.py /home/mike/.claude/tools/sent-reconciler/*.sh /home/mike/.claude/tools/sent-reconciler/prompts/*.md
    ```
11. Allowed files only.
12. Untouched paths: `app/components/domain/dashboard`, `app/components/layout`, `app/app/globals.css`, `app/app/api/email-outbox`, `app/lib/sends`, `app/app/api/email-asks`, `app/app/api/time-entries`, `app/app/api/clients`.
13. Commit only when 1 to 12 pass.

### Deploy, 9a
1. Push and merge to `main` (standing "push to citadel"). `gh run watch` until green.
2. **Production, GET only.**
   - Mike's home screen loads.
   - `DRY_RUN=1 /home/mike/.claude/tools/sent-reconciler/sent-reconciler.sh`: one GET, mirror selection and split, no model. `last-dry-run.json` should list about 10 normal messages and about 60 look-back messages, Kue's and the six Phil Camp sends among them.
3. **Machine.**
   - Backups: `crontab -l > /home/mike/.local/log/crontab-backup-20261111-reconciler` and `cp jobs.json jobs.json.bak-20261111-reconciler` in `~/.claude/tools/job-watch/`.
   - Add the jobs.json entry with `install_pending`.
   - `install -m 755 /home/mike/.claude/tools/sent-reconciler/sent-reconciler.sh /home/mike/.local/bin/sent-reconciler.sh`.
   - Write the config.
   - Add the crontab line, then remove `install_pending`.
   - `python3 /home/mike/.claude/tools/job-watch/job_watch.py --dry-run` shows the row is not failing.
4. The first real run is the next cron tick. Bast reads the first run's `last.json` and the cards it made, and tells Mike in the next report.

### Rollback, 9a
- `touch ~/.sent-reconciler-paused`, or set `reconcile_on = false` with a data migration.
- Revert the merge. The tables stay, unused.
- Notes already written stay, and each can be hidden by its Undo. Nothing is deleted.

---

## SLICE 9b: auto-apply (own branch after 9a merges; ships switched on, recommendation 1)

### What Mike sees
**Handled for you lines, each with Undo and This was wrong for 72 hours:**
- `Marked "{title}" done from your email to {name}, {date}.` Its card adds the quote and "Log time? 30 min" when the task has no time.
- `Moved "{title}" to waiting on {name} since {date}. It comes back when they answer, or on {day}.`
- `Cleared the question from "{session title}". Your email to {name} on {date} answers it.`
- `Started a wait: waiting on {name} since {date} for {what}.`

**Other changes:**
- A task with an open reconcile wait sits in the drawer group "Waiting on them".
  - When the wait comes into view, the wait row shows with the task link.
  - When they answer, the wait closes ("They answered on {date}.") and the task returns to where it was.
- After a note or close on a project task, Bast re-reads the project, so the next step on his screen updates within minutes.
- **The breaker line:** `Bast stopped changing tasks from your email after two wrong guesses this week. It still adds notes and suggestions.` with the button **Turn it back on**.

### Rules
- Auto applies only through `decide.ts` with `ctx.auto` and every evidence rule. The cap is 6 a day, read from today's `home_reconcile_change` rows with `mode = auto` under a row lock, the same as the chat's usage row. Past the cap, the change becomes a card.
- **Done:** `patchTask` with the chat key's auth, a body passed through `guardChatTaskBody`, and `expect {status, updated_at}`. A `changed_since` result makes a card.
  - Undo: `patchTask` back to the stored status with `expect {status:'done', updated_at: after}`.
- **Waiting:** opens `mail.awaiting_reply` with `task_id`, `email_thread_id`, `email_account`, `owner_contact_id` (when the recipient is a `ClientContact`), `created_by_automation 'sent-reconciler'` and `idempotency_key 'reconcile:'+dedupe_key`.
  - It uses `buildWaitData`, `prismaSweepStore.insertIdempotent` and the `created` event, as `POST /api/waits` does.
  - Undo cancels it while it is still `waiting`.
- **Session:** writes `session_cleared_at` and `session_cleared_hash` on his `home_item_state` row through the same function the `clear_session` act uses (exported from `act.ts` as `clearSessionPatch`).
  - Undo is compare-and-set on the hash.
- **Reply check (machine):** for each open reconcile wait the GET lists, an inbound mirror message in that thread from a non-own address after `started_at` makes the machine post `replies_seen`. Citadel resolves the wait as `completed` with that reason.
- **Next step:** stamp `next_step_refresh_requested_at` on the task's project (live projects only, at most once an hour per project). There is no Undo, because it only asks for a re-read. The line says nothing.
- **The breaker:** at the second `wrong_at` within 7 days, set `reconcile_auto_paused_at`. "Turn it back on" is a home act that clears it, with Undo.

### Schema (migration `20261115040000_home_reconcile_9b`)
- `HomeKeeperSettings` gains `reconcile_auto Boolean @default(false)` and `reconcile_auto_paused_at DateTime?`.
- A data migration `20261115041000_home_reconcile_auto_on` sets `reconcile_auto = true` for the owner.

### Task list, 9b

| Id | What | Files | Depends | Model |
|---|---|---|---|---|
| B0 | Setup, DB `home_s9b_int` | plan copy | 9a merged | Haiku low |
| B1 | Schema and data migration | `schema.prisma`, the two migration folders | B0 | Sonnet medium |
| B2 | Auto paths | `reconcile/decide.ts` (auto branch), new `reconcile/auto.ts` (done, waiting, session, wait, step), `reconcile/undo.ts` (their undo), `reconcile/store.ts` (caps, breaker, `replies_seen`), tests | B1 | Sonnet medium |
| B3 | Route changes | `worker/reconcile/route.ts` (`replies_seen`, `auto` in GET), tests | B2 | Sonnet medium |
| B4 (W) | Wire-in | `select.ts` (Waiting on them group), `act.ts` (export `clearSessionPatch`, `reconcile_resume`), `types.ts`, `copy.ts`, `load.ts`, `actions-for.ts`, `HomeScreen.tsx`, `use-home.ts`, `ops/home.ts`, tests | B2, B3 | Sonnet medium |
| B5 | Machine | `reconciler.py` (reply check, auto counts in `last.json`), tests | B0 | Sonnet medium |
| B6 | Local run | `app/lib/home/__tests__/slice9b.integration.test.ts` | B4 | Sonnet medium |
| B7 | Gate | as 9a, plus the 9b tests | all | Sonnet medium |

**B6 asserts:**
- a clean past-tense quote on his own thread-matched task marks it done, with a line, and Undo puts it back
- "I'll remove it tomorrow" does nothing
- a security task never closes on its own
- the 7th auto-change of the day becomes a card
- two wrong taps trip the breaker
- a reply in the mirror closes the wait and brings the task back
- a task Mike edited after the close is not reverted ("Changed since")
- other users are untouched

**Deploy:** push, green, then swap `reconciler.py` (backup `~/.claude/tools/sent-reconciler.bak-2026111x-9b`).

**Rollback:** set `reconcile_auto` false (9a keeps running), or use the pause file, or revert.

---

## SLICE 9c (later, small; not built now): his own Citadel comments as a second input

**Yes, later.** A comment Mike writes himself on one of his open tasks ("Removed the plugin, waiting on Kue for the password") is the same kind of evidence as a sent email, and it already sits in Citadel.
- The GET would list his human comments from the last day.
- The same matcher and evidence rules apply, with the comment as `new_part`.
- It would start as cards only.
- About one route field and one machine step.

**Slack messages to Bast: no.** The Slack listener is already a Bast session acting on what he says. A second reader would act twice.

**Chat messages like "I did X": no.** The chat already acts on his explicit words, with Undo. Feeding them into this matcher would double-apply and add a guess where he gave an instruction. The chat may *show* open reconcile cards later (read only).

---

## Off by default, or not built (so nothing is hidden)
- **No time entry is ever created** without his tap on the home screen. The chat cannot create one.
- **Nothing is sent, drafted or labelled.** The only `gog` call is `gmail get`.
- **Task billing fields are never touched:** `is_billable`, `billing_amount`, `is_retainer_work`, `is_support`, `hourly_rate`. Neither are dates or the promised fields (`due_date`, `hard_due_*`, `promised_to`).
- **A card for "you promised {client} a date" is not built.** That date is a real outside date, so it would be a card only. It is listed as decision 8.

## Decisions for Mike (builders proceed on each recommendation)
1. **Turn auto-apply (9b) on when it deploys?** Recommended: yes. Every change has a Handled line, Undo and This was wrong. The cap is 6 a day, and the breaker stops it after two wrong guesses in a week.
2. **Time from a card counts as billable?** Recommended: yes. The entry is `is_billable` true, which is Citadel's own default and what the retainer report counts. The task's billing fields stay his to set. The card has a Not billable choice.
3. **Where Track it puts work for a retainer client with no fitting project?** Recommended: into the client's live retainer project when there is exactly one. Then the hours land in that month's retainer report and the health badge.
4. **"Start a project for it" makes a live project, or a hidden one?** Recommended: live (`in_progress`), because the work has already started. `start_project`'s hidden kickoff stays for new work.
5. **The next step after Track it is a task, or only the project's step line?** Recommended: both. A task, so it cannot be lost when the engine rewrites the step, and the same words as the project's step.
6. **The look-back reaches 14 days, makes cards only, at most 25, drawer only, no notes?** Recommended: as written.
7. **Clearing a session question (9b) is automatic?** Recommended: yes. It only hides the question until the session asks something new.
8. **Card for client dates:** when his email promises a client a date, should Bast offer "Add a real date: Friday, November 13 (you told Kue)"? Recommended: yes, later, as a card only.
9. **A dash in his quoted words is shown as " - "?** Recommended: yes. It keeps the screen rule without dropping his words.

## Risks worth naming
- **The splitter misses a quote style.** Then other people's words could look like his. Mitigations: the quote must also be absent from the quoted part; the fixtures cover four mail clients; the model is told which part is whose. A miss on an odd client gives a card, not an auto-change.
- **"Done" in words is not done in fact.** He may write "I fixed it" about a different site. Mitigations: the match needs the thread, or the client or site plus a title overlap; open checklist items turn a close into a card; Undo and This was wrong cover the rest. Security tasks never close on their own.
- **Estimates can mislead billing.** The time is always labelled an estimate, it is only saved on his tap, and the entry's description says it was logged after the fact.
- **The session-clear branch is not merged yet.** 9a waits for it. If it changes shape, M9's rebase picks up the final names.
- **The first look-back costs about $3** and makes up to 25 drawer cards. It is capped and runs once.

### Critical Files for Implementation
- `/home/mike/.openclaw/workspace/citadel/app/lib/home/act.ts`
- `/home/mike/.openclaw/workspace/citadel/app/lib/home/select.ts`
- `/home/mike/.openclaw/workspace/citadel/app/lib/services/task-patch.ts`
- `/home/mike/.openclaw/workspace/citadel/app/lib/bast-chat/ops/comment.ts`
- `/home/mike/.openclaw/workspace/citadel/app/app/api/clients/[id]/retainer/route.ts`
- `/home/mike/.claude/tools/oracle/clarity/mail_mirror.py`
- `/home/mike/.claude/tools/owed-reply/drafter.py`