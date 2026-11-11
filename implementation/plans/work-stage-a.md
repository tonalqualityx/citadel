# Work stage A: link and close (plan copy)

Copied from specs/work-integration-plan.md (system-review-2026-11), the STAGE A section, as the build started. Built on branch feat/work-stage-a from origin/main 987567b.

## STAGE A: link and close (small; ships first)

### What Mike sees
- **An email that belongs to a task never shows as "client email waiting".** It shows on that task's card under "Email": "Jeffrey Knisely, Nov 2: Website update. Open the email".
- **Finished work closes its emails.** When a task goes to done or abandoned, every open email linked to it closes, and Handled for you gets one line with Undo for 72 hours: `Closed 2 emails from Jeffrey Knisely: done in "Add the blurb" (Nov 2). Undo`
- **A one-time tidy of existing data**, reported first as counts in the morning report from a dry run, then run. One line: `Linked 37 emails to their tasks and closed 22 whose tasks are finished. Undo`. The line's detail lists every email and task with links.

### Rules
1. **Link at intake.**
   - The classifier's `_mint_fold` PATCHes the new ask with `{task_id, state: 'handled', closed_reason: 'with_task', closed_by: 'classifier'}`, the same as `_maybe_mint_intake` does for first messages. It does this only when the task is open (`not_started`, `in_progress`, `review` or `blocked`).
   - When the fold target is done or abandoned, the ask stays open and unlinked, as today. A message after the work finished is a new decision (Stage B).
2. **Link when any lane files a task from mail.**
   - In `POST /api/tasks` with `source='email'` and `source_ref`, link every ask whose `message_id = source_ref`, or whose `rfc_message_id` equals the new optional `source_rfc`.
   - Also link the earlier open asks of the same conversation: the same `conversation_key`, else the same `account` and `thread_id`.
   - Each linked ask goes to handled, with `closed_reason 'with_task'`, in the same transaction.
   - This covers email-check, worker, chat, Assayer and payroll tasks. `create-task.py --source-email` adds `source_rfc`, resolved from the mirror (`mail_mirror.query(account, gmail_id)`).
3. **Close when the work ends.**
   - `closeAsksForTask(tx, taskId, newStatus, actor)` in `app/lib/work/ask-closure.ts`. On the change into done or abandoned, every linked ask that is still `open` becomes `handled`, with `closed_reason 'task_done' | 'task_abandoned'`, `closed_at` and `closed_by 'task'`.
   - It writes one close record (the salvaged `TriageCloseRecord` shape: ask ids, previous states) into a `home_actions` row of source `keeper` and action `work_close`, with Undo for 72 hours.
   - Callers: `afterStatusChange`, `markLive`, portal `confirm.ts`, `tasks/bulk/route.ts` and `reconcile/track.ts`. Nothing else may write `state` on a linked ask.
   - The nightly keeper (`lib/home/keeper/run.ts`) gains a catch-up step: any open ask whose task is done or abandoned closes with `closed_by 'catchup'`.
4. **The hard rule, in one place.** `app/lib/work/owed.ts` exports `askIsMine(ask)`. An ask with a `task_id` pointing at a task that is not deleted (any status) is never owed, never drafted, never a thread row and never an arc step.
   - `loadThreads` filters on it. The drafter's GET queue uses the same loader, so it is covered.
   - Urgent asks keep their emergency path. A security flag is never dismissed by a link.
5. **Conversation key**, worked out once on the machine (`conversation.py conversation_key(account, gmail_id)`):
   1. the key of an existing ask in the same `account` and `thread_id`, or whose RFC id appears in this message's References;
   2. else the first id in References;
   3. else In-Reply-To;
   4. else the message's own Message-ID.

   All lowercased, with no brackets. The classifier sends `rfc_message_id` and `conversation_key` on email-sync.

### Schema (migration `20261117010000_work_a`)
```prisma
// On EmailAsk:
  rfc_message_id   String?   @db.VarChar(255) // RFC Message-ID, lowercased, no brackets
  conversation_key String?   @db.VarChar(255) // RFC id of the conversation root (rule 5)
  closed_at        DateTime?
  closed_reason    String?   @db.VarChar(40)  // with_task | task_done | task_abandoned | no_action | waiting_them | answered_by_mike | answered_by_bast | meeting_booked | archived | mike | backfill | catchup
  closed_by        String?   @db.VarChar(20)  // classifier | intake | task | mike | bast | backfill | catchup
  @@index([rfc_message_id])
  @@index([conversation_key])
  @@index([task_id])
```

### Routes
- **`POST /api/oracle/email-sync`** accepts `rfc_message_id` and `conversation_key` (optional; absent means untouched).
- **`PATCH /api/email-asks/:id`** lets the porter lane write `closed_reason` and `closed_by` together with `state`, and `conversation_key` only over null.
- **`POST /api/tasks`** accepts `source_rfc` (optional, at most 255 characters).
- **`POST /api/work/backfill-links`** (porter lane; strict body; at most 500 pairs).
  - Body: `{dry: boolean, pairs: [{ask_id|message_id, task_id, basis: 'mint_ledger'|'registry'|'source_ref'|'cross_mailbox'}], keys: [{ask_id, rfc_message_id, conversation_key}]}`.
  - Citadel recomputes: the ask is open, the task exists, and the basis holds.
  - It links the asks. It closes those whose task is done or abandoned **and** whose `received_at <= completed_at`.
  - Asks received after completion are listed, not closed. Security-tagged tasks' asks are linked, never closed.
  - `dry:true` writes nothing and returns counts: `{open_total, linkable_by_basis, with_open_task, would_close, left_open_after_done, keys_set, unmatched}`.

### Machine
- **Classifier (`email-classifier.py`):**
  - the `_mint_fold` patch
  - `rfc_message_id` and `conversation_key` on every email-sync item (via `conversation.py`)
  - the `create-task.py` call passes `--source-rfc`
- **`create-task.py`:** `--source-rfc` (looked up when `--source-email` is given and the mirror has the message).
- **New `~/.claude/tools/work-links/backfill.py`** (stdlib, no model). It reads:
  - `~/.claude/oracle/minted-asks.jsonl` (17 lines: mint, clarify, fold)
  - `thread-registry.db` threads that carry a task (read-only)
  - `GET /api/tasks?source=email` (source_ref ids resolved to RFC ids through the mirror, so bast@-filed tasks find their mike@ copies)
  - `GET /api/email-asks?state=open` (keys filled from the mirror)

  It POSTs with `dry:true` first and prints the counts. `--apply` POSTs for real. It uses the porter key from the classifier's config, sent as a header.

### Task list, Stage A

| Id | What | Files it owns | Depends on | Model |
|---|---|---|---|---|
| A0 | Worktree, `npm ci`, baseline tsc and vitest, plan copy | `W/implementation/plans/work-stage-a.md` | none | Haiku low |
| A1 | Schema and migration | `app/prisma/schema.prisma`, `app/prisma/migrations/20261117010000_work_a/migration.sql` | A0 | Sonnet medium |
| A2 | Closure and owed core | new `app/lib/work/ask-closure.ts`, `app/lib/work/owed.ts`, `app/lib/work/copy.ts`, `app/lib/work/__tests__/ask-closure.test.ts`, `owed.test.ts` | A1 | Sonnet medium |
| A3 | Callers of closure | `app/lib/services/task-patch.ts`, `app/lib/portal/go-live.ts`, `app/lib/portal/chat/confirm.ts`, `app/app/api/tasks/bulk/route.ts`, `app/lib/home/reconcile/track.ts`, their existing tests plus one new test each | A2 | Sonnet medium |
| A4 | Intake routes | `app/app/api/oracle/email-sync/route.ts`, `app/app/api/email-asks/[id]/route.ts`, `app/app/api/tasks/route.ts` (link on create), tests | A2 | Sonnet medium |
| A5 | Backfill route | new `app/app/api/work/backfill-links/route.ts`, `__tests__/route.test.ts` | A2 | Sonnet medium |
| A6 | Lane and registry | `app/lib/auth/lane-scopes.ts` (porter: backfill route), `app/lib/api/registry/clarity.ts` | A0 | Haiku low |
| A7 (W) | Wire-in | `app/lib/home/load.ts` (filter, task card "Email" lines, `work_close` in `KEEPER_ACTIONS`), `select.ts`, `types.ts`, `copy.ts`, `act.ts` (undo branch for `work_close`), `app/lib/home/keeper/run.ts` (catch-up), tests | A2, A3, A4, A5, A6 | Sonnet medium |
| A8 | Machine | `~/.claude/tools/oracle/clarity-next/email-classifier.py` (fold patch, keys), new `conversation.py`, `~/.claude/tools/citadel-tasks-next/create-task.py` (`--source-rfc`), new `~/.claude/tools/work-links/backfill.py`, `tests/` with fake gog, fake Citadel and a temp mirror | A0 (route shapes from this plan) | Sonnet medium |
| A9 | Local run | new `app/lib/work/__tests__/stage-a.integration.test.ts` | A7 | Sonnet medium |
| A10 | Gate | none | all | Sonnet medium |

**When each task can run.** No file appears in two rows.
1. A0, then A1, then A2.
2. In parallel: A3, A4 and A5 (after A2); A6 and A8 (after A0).
3. A7 after the rebase.
4. A9 after A7.
5. A10 last.

### Task details, Stage A
- **A2.**
  - `closeAsksForTask` is idempotent and compare-and-set (`state: 'open'` in the where). It returns the closed ids for the line.
  - `undoWorkClose(tx, rec)` reopens only asks still `handled` with that `closed_reason`. It then puts a 30-day hold on the task's asks, so the catch-up does not re-close them.
  - `askIsMine(ask, taskById)` is pure.
- **A9 asserts:**
  - the Knisely replay: a fold to open task T, then T done, means the ask is closed with `task_done` and is never in `loadThreads` while T is open
  - a fold to a done task leaves the ask open
  - an email-check task with a bast@ `source_ref` plus `source_rfc` links the mike@ copy
  - a `markLive` close closes the asks
  - Undo reopens them
  - the backfill dry run writes nothing; the real run never closes an ask received after completion and never closes a security task's ask
  - another user's screen is unchanged
- **A10 gate (exit codes decide):**
  1. `npx prisma validate`
  2. migrate deploy on a fresh `work_a_gate`, then the drift check with `--exit-code`
  3. tsc no worse than the baseline
  4. `npx vitest run lib/work lib/home app/api/tasks app/api/email-asks app/api/oracle/email-sync app/api/work lib/portal lib/services lib/auth/__tests__/lane-scopes.test.ts lib/api/registry/__tests__/registry.test.ts`
  5. the whole suite: no new failing file
  6. eslint on changed files
  7. `NEXT_PUBLIC_APP_URL=http://localhost:3000 npx next build`
  8. A9 alone on `work_a_int`
  9. `python3 -I -m unittest discover` in each changed machine folder (the classifier's existing tests included)
  10. the dash and banned-word grep over the machine files prints nothing
  11. only the allowed files changed

### Deploy, Stage A
1. Push and merge (standing "push to citadel"), then `gh run watch` until green.
2. Production, GET only: Mike's home loads, and the owed count is noted.
3. Swap in the classifier and `create-task.py`, with backups `*.bak-2026111x-work-a`.
4. `python3 -I ~/.claude/tools/work-links/backfill.py` (the dry run, the default). The counts go into the morning report.
5. Bast reads 10 of the would-close pairs (titles and dates only), then runs `--apply`. Mike's dry-run report is the check. Nothing sends, and everything has Undo.

### Rollback, Stage A
- Revert the merge (the columns stay, unused) and restore the classifier backup.
- Backfill closes are undone from the one Handled line within 72 hours. After that, a data-only migration reopens rows by `closed_by='backfill'`.

### What could go wrong
- **A long thread is linked to an old task.** "Website update" has run since 7 Oct.
  - Mitigations: intake links only to open tasks; the backfill closes only asks that arrived before completion; every close has a note and Undo.
- **A fold patch races the email-sync upsert.** The fold runs after the sync in the same pass. The PATCH is by ask id, so it is safe.

### Check on real data, sending nothing
- The dry-run counts.
- Then `GET /api/email-asks?state=open` joined to tasks: open asks with a done task = 0 (except those that arrived after completion, which are listed).
- The Knisely thread's asks are not in the owed queue (`GET /api/bast-chat/worker/owed`, a dry read).

### Mike decides
Nothing blocks this stage. Recommended: run the tidy after the dry-run counts are reported, with no further step.

**Size: small to medium.** **A client sees no difference.** **Switched off or deleted: nothing yet.**

