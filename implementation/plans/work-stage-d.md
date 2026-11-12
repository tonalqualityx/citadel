# Work stage D: the linking model and "never a second to-do" (plan copy and as-built notes)

Copied from specs/work-integration-plan.md (system-review-2026-11), the STAGE D section, as the build started. Built on branch feat/work-stage-d from origin/main 8acf086. Stage C is not built or merged: where Stage D depends on a Stage C piece, the build reads what main has today and leaves a marked seam (listed under "As built").

## STAGE D: the linking model and "never a second to-do"

### What Mike sees
- **The project drawer and task card list everything attached:** email conversations (across inboxes), sessions, our sends, deploys and commits, calendar events and waits. Each shows its date and link.
  - Thermalnetics, for example: two email threads, three sessions, the Oct 7 sync event, and Bast's 2 sends.
- **One state line** per project or task: `With Bast since Nov 2` / `Waiting on Kelly since Nov 5` / `Looks done: live receipt Nov 4. Close it?`
- **One question when the match is unclear,** as one row:
  - `New email from Ashlei (Thermalnetics): add to "Thermalnetics website" or "Thermalnetics hosting", or start a new project?`
  - Each name is a link. Buttons: one per candidate, **New project**, **Just a task**, **Not work**.
- **Quiet attaches** show as Handled lines with Undo: `Added the email from Ashlei to "Thermalnetics website". Undo`
- **An email, a session question or a card never becomes a to-do** while something attached to the same work is handling it. It appears inside that work's row instead.

### Rules
1. **`work_link`** attaches a source (`kind`, `ref`) to one target (`project:<id>` or `task:<id>`).
   - An email conversation has at most one active target. This is enforced in code, under a row lock on the conversation's asks.
   - A session can attach to several targets, one row per project it worked in.
   - Writing an email link stamps `task_id` and `project_id` on that conversation's asks (one writer, `attachSource`), so Stage A's field and the link never disagree.
2. **Candidates** (`lib/work/candidates.ts`, pure):
   - the conversation already linked
   - the sender's client's live projects (`ready | in_progress | review`, never `done`, `cancelled`, `quote`, `queue` or `suspended`, so a finished project is never reused)
   - for sessions: a project whose `plan_folder` contains the cwd, a site whose `repo_url` matches the cwd's git remote, or the Wright client slug folder mapped to a client
   - a folder-to-project choice Mike made before (stored as a `work_link` of kind `folder`)

   A clear match (exactly one candidate, basis `same_conversation`, `plan_folder` or `prior_choice`) attaches quietly. Two or more, or a client with no live project, makes the one question. "When in doubt, ask."
3. **Project rule.** "New project" makes a live project (`in_progress`, client, site, the source attached). "Just a task" makes a task with the source attached, and is offered only when the source names one deliverable. Adding tasks to a live project is fine.
4. **Evidence.** `work_evidence` rows are written only by code paths:
   - the courier and door (sends)
   - receipts (deploys, live)
   - the classifier (their message, our reply)
   - calendar sync (meeting held)
   - the reconciler (Mike's quote)
   - the session close pass (commits, Stage E)
   - the worker ledger (Bast run)

   Each row holds kind, ref, time and a short line. No mail text.
5. **One derived state** (`lib/work/state.ts workState(target)`): `done` (status) > `looks_done` (strong evidence per `finished.ts`, not closed) > `waiting_them` (open wait on a contact) > `with_<assignee>` (open task with an owner) > `open`.
6. **One guard** (`lib/work/guard.ts handledElsewhere(sourceKey)`): returns the target when the source is attached to an open task, or to a done task whose completion came after the source's latest activity.
   - **Callers, each with an invariant test in `guard.test.ts` that enumerates them:**
     - home `select.ts` (thread rows, session waiting-on cards, proposal cards)
     - `POST /api/tasks` (`source_key`)
     - `POST /api/session-tasks`
     - `POST /api/email-asks/:id/create-task`
     - the chat's create task and `start_project`
     - `reconcile/track.ts`
     - the keeper's arc steps
   - **A create path that finds an attachment** answers `200 {already_tracked:true, task}` and adds the source as evidence. No task is created.
7. **Consumers read `workState`:**
   - the drafter queue (through the home loader)
   - the reconciler candidates (`reconcile/load.ts` adds `work_state` and `attached`; never proposes Track it for an attached source)
   - the worker: `spawn-gate.py` reads `GET /api/work/task/:id/state`, and an active attended session link means "a live session has this, keep off", which replaces the `cockpit-owned` tag
   - the chat (`work_state` read op)
   - Slack lines (one line per work key)
   - measures: `No second to-dos: 6 kept off your list.`
8. **The reconciler's planned 9b auto-apply is merged here.**
   - Its auto "done" goes through `finished.ts` and the one looks-done card, not its own path.
   - Its auto wait and session clear stay as planned, but read `handledElsewhere` first.
   - 9b is built after D.

### Schema (migration `20261117050000_work_d`)
```prisma
model WorkLink {
  id            String    @id @default(uuid()) @db.Uuid
  target_key    String    @db.VarChar(60)   // project:<uuid> | task:<uuid>
  project_id    String?   @db.Uuid
  task_id       String?   @db.Uuid
  kind          String    @db.VarChar(20)   // email | session | send | deploy | commit | calendar | wait | folder
  ref           String    @db.VarChar(300)  // conversation_key | session external id | outbox id | deploy id | sha@repo | event id | wait id | folder path
  label         String?   @db.VarChar(300)
  attached_by   String    @db.VarChar(20)   // auto | mike | bast | intake
  basis         String?   @db.VarChar(40)
  state         String    @default("active") @db.VarChar(10) // proposed | active | detached
  candidates    Json?                        // proposed only: [{target_key, label, href}]
  first_seen_at DateTime  @default(now())
  last_seen_at  DateTime  @default(now())
  detached_at   DateTime?
  home_action_id String?  @db.Uuid
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt
  @@unique([kind, ref, target_key])
  @@index([kind, ref, state])
  @@index([project_id])
  @@index([task_id])
  @@map("work_link")
}

model WorkEvidence {
  id          String   @id @default(uuid()) @db.Uuid
  target_key  String   @db.VarChar(60)
  project_id  String?  @db.Uuid
  task_id     String?  @db.Uuid
  link_id     String?  @db.Uuid
  kind        String   @db.VarChar(20) // their_message | our_reply | send | deploy | live | commit | gate | delivered_file | meeting_held | mike_quote | bast_run | client_approval
  ref         String   @db.VarChar(300)
  at          DateTime
  line        String   @db.VarChar(300)
  href        String?  @db.VarChar(1000)
  source      String   @db.VarChar(30)
  dedupe_key  String   @unique @db.VarChar(400)
  created_at  DateTime @default(now())
  @@index([target_key, at])
  @@map("work_evidence")
}
```
A data-only backfill writes email links from asks with `task_id` and `conversation_key`, and send links from outbox rows with `task_id`.

### Routes
- **`GET /api/work/:target_key/state`** (session, bast, oracle, bast-chat, porter).
- **`POST /api/work/attach`** (porter, oracle, bast-chat, session): `{kind, ref, label, target_key?|propose:true, candidates?}`.
- **`POST /api/work/evidence`** (bast, courier, porter, oracle): `{items:[...]}` at most 100.
- **`POST /api/home/act`** gains `{action:'attach_choose', item_key:'attach:<link id>', choice:'<target_key>'|'new_project'|'task'|'not_work'}` and undo.

### Task list, Stage D

| Id | What | Files | Depends | Model |
|---|---|---|---|---|
| D0 | Setup after C merged | plan copy | C merged | Haiku low |
| D1 | Schema and link backfill | `schema.prisma`, migration, data migration | D0 | Sonnet medium |
| D2 | Core | new `app/lib/work/links.ts` (`attachSource`), `candidates.ts`, `state.ts`, `guard.ts`, `evidence.ts`, tests incl. `guard.test.ts` (every create path) and the Thermalnetics fixture | D1 | Sonnet medium |
| D3 | Create paths | `app/app/api/tasks/route.ts`, `app/app/api/session-tasks/route.ts`, `app/app/api/email-asks/[id]/create-task/route.ts`, `app/lib/bast-chat/ops/start-project.ts`, `start-common.ts`, `app/lib/home/reconcile/track.ts`, `reconcile/load.ts`, tests | D2 | Sonnet medium |
| D4 | Evidence writers | `app/lib/sends/outbox.ts` and `/api/sends/record` (send evidence), `app/lib/portal/receipts.ts` (deploy and live), `app/app/api/oracle/calendar-sync/route.ts`, `app/lib/home/reconcile/store.ts`, tests | D2 | Sonnet medium |
| D5 | Routes | new `app/app/api/work/[key]/state/route.ts`, `work/attach/route.ts`, `work/evidence/route.ts`, tests | D2 | Sonnet medium |
| D6 | Lanes and registry | `lane-scopes.ts`, registry files | D0 | Haiku low |
| D7 (W) | Wire-in | `select.ts` (guard everywhere, attach rows), `load.ts`, `types.ts`, `copy.ts`, `act.ts`, `actions-for.ts`, `item-key.ts` (`attach:`), `keeper/arcs.ts`, `lib/home/learn/measures.ts`, `lib/bast-chat/ops/home.ts` plus the new read op `ops/work.ts`, tests | D2 to D6 | Sonnet medium |
| D8 | Drawer and card | `HomeProjectDrawer.tsx`, `ItemCard.tsx`, `use-home.ts`, tests | D7 | Sonnet medium |
| D9 | Machine | classifier (attach on intake when `prior` and `client` are known), `citadel-worker/spawn-gate.py` (state read instead of the `cockpit-owned` tag), `home-watch` (one line per work key), tests | D0 | Sonnet medium |
| D10 | Local run | `app/lib/work/__tests__/stage-d.integration.test.ts` (the Thermalnetics walk) | D7 | Sonnet medium |
| D11 | Gate | as A10 | all | Sonnet medium |

**D10 walks through the Thermalnetics case:**
- two email threads from two people attach to one project (the second by Mike's choice on the question row)
- a session in its plan folder attaches quietly
- Bast's send attaches
- a new email on a conversation whose task is open becomes no row
- a chat "create a task" for an attached conversation answers `already_tracked`
- a done project is never a candidate
- the question offers links to each candidate

### Deploy, rollback and checks, Stage D
- **Deploy:** push, green, swap the machine files.
- **Check:** GET `/api/work/project:<thermalnetics id>/state` on production after the link backfill. Count home rows before and after; the drop must be fully explained by attached sources (Bast lists them).
- **Rollback:** revert; links stay unused, and Stage A to C behaviour is unchanged.

### What could go wrong
- **Wrong quiet attaches.** Only the three clear bases attach quietly. Everything else asks, and every attach has Undo.
- **A missed create path makes a second to-do.** The invariant test enumerates every route that creates a Task, by grepping `task.create` in `app/` and `lib/`, and fails on any path not routed through the guard.

### Mike decides
**Should sessions and emails attach to a project even when a task fits?** Recommended: attach to the task when one open task clearly fits, else to the project. Builders proceed.

**Size: large.** **Client-visible:** none. **Switched off:** the `cockpit-owned` tag stops being read by the worker (the tag is left on old tasks, harmless).

---

---

## As built (Citadel side; D0 to D8, D10 and the Citadel part of D11; D9, the machine side, is held)

### Schema and migration `20261117050000_work_d`
- Two new tables, `work_link` and `work_evidence`, exactly the plan's columns plus one nullable extra on `work_link`: `context` (JSON; what "New project" and "Just a task" need while a question waits). No foreign keys, no `ALTER TYPE`.
- Data backfill, links only (no ask, task, project or outbox row is updated, closed or deleted), idempotent by the unique key and a `NOT EXISTS` guard:
  1. one active `email` link per conversation (`email_asks.conversation_key`), to the task the conversation's newest ask points at (task not deleted), `attached_by auto`, `basis backfill`; a conversation that already has an active email link is skipped; asks with no conversation key are not linked;
  2. one active `send` link per delivered `email_outbox` row that names a non-deleted task (`sent_at` set, not superseded); the subject is the label; no body or address is copied.

### Where the guard sits (`lib/work/guard.ts`, invariant in `lib/work/__tests__/guard.test.ts`)
- Every task create path: `POST /api/tasks` (`source_key`, and source_ref or source_rfc on an email task), `POST /api/session-tasks`, `POST /api/email-asks/:id/create-task`, the chat's `start_project` (its kickoff task, through `createStartTask`/`refuseIfTracked`), Track it (`reconcile/track.ts`, re-read at the tap), and the owner's own "Just a task" answer (the named override). Every other file that creates a task is named in `EXEMPT` with its reason; a new create path fails the test until it is guarded or named.
- Every home row source: the loader (`lib/home/load.ts` through `lib/work/home-guard.ts`) leaves out mail, session questions and Track it cards that open work carries; `select.ts` drops the same keys again (`raw.handled_elsewhere`). The reconciler's evaluate step refuses a Track it for an attached conversation (`refused: already`) and its candidates carry `attached`. The keeper's arc steps come from select's rows.
- A create path that finds the work answers `200 {already_tracked: true, task, project, target_key, name, href, state}`, creates nothing, and records the source as evidence once a day. The explicit owner override is `create_anyway: true`, honoured only for a browser session and the bast-chat lane; a machine lane that sends it is still answered `already_tracked`. Urgent mail, a client_blocking or launch_blocking session ask, and a security-tagged task's source are never answered or hidden by the guard.

### The quiet-attach rule as built (`lib/work/candidates.ts`)
- A source attaches quietly only when it has exactly one candidate and that candidate's basis is `same_conversation`, `plan_folder` or `prior_choice`. Everything else is one question; no candidate and no client is no question.
- Deviation, on purpose: `same_conversation` short-circuits. A conversation already linked to live work stays there (result `already`) even when the client has other live projects; a new message on a linked conversation is never a new question.
- A done, cancelled, quote, queue or suspended project is never a candidate, and attaching to a finished project or task is refused (409 `target_finished`).

### Routes as built (for the machine side)
- `GET /api/work/:target_key/state` (also `GET /api/work/task/:id/state`, the path the spawn gate reads): owner session, lanes bast, oracle, bast-chat, porter. `{target_key, type, id, name, href, status, state, since, line, attached[], evidence[], live_session}`.
- `POST /api/work/attach`: owner session, lanes porter, oracle, bast-chat. Strict body `{kind, ref, label?, target_key | propose: true, candidates?, client_id?, cwd?, repo_remote?, one_deliverable?}`. `{result: attached | already | proposed | dismissed | none | skipped, ...}`.
- `POST /api/work/evidence`: owner session, lanes bast, courier, porter, oracle. Strict body `{items: [{kind, ref, at, line, href?, source, target_key | from: {kind, ref}}]}`, at most 100. `{written, duplicates, unattached}`.
- `POST /api/home/act` gains `{action: 'attach_choose', item_key: 'attach:<link id>', choice: '<target_key>' | 'new_project' | 'task' | 'not_work'}`; Undo is the existing `POST /api/home/undo` for 72 hours.
- Lane lists: ten lines added (porter 3, bast 3, courier 1, oracle 3) and two to bast-chat (the state read and the attach).

### Stage C seams (not built)
- `lib/sends/lanes.ts` and the send door: not built. `lib/work/evidence-writers.ts` `recordSendWork` has a reserved `lane` and a TODO(stage-c).
- `POST /api/sends/record`: not built. Sends are seen at the courier's mark-sent route (`/api/email-outbox/:id/sent`, TODO(stage-c) marked) and by `syncSendEvidence`, which reads `email_outbox` (delivered, naming a task) and runs after the nightly keeper.
- `answered_since`: not used. The evidence kind `our_reply` exists in the vocabulary and has no writer yet.
- `lib/sends/outbox.ts` (named in D4) does not exist on main; the send evidence hook is the courier route.

### Not built, and why
- The chat's `work_state` read op (`lib/bast-chat/ops/work.ts`): the ops registry is closed at seven ops by its route, the reach check and their tests; the chat reads the state through the new `GET /api/work/:target_key/state` in its own lane, and answers the question through the existing `home` op (`attach_choose`).
- D9 (classifier attach on intake, spawn-gate, home-watch): held.
- Attaching the source to the project that `start_project` or Track it creates: not done (an Undo of either abandons or cancels what it made, and would close or orphan the attached asks).
