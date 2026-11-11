# Work stage G: the one-time looks-finished sweep (plan copy)

Copied from specs/work-integration-plan.md (system-review-2026-11), the STAGE G section, as the build started. Built on branch feat/work-stage-g from origin/main 73af128.

## STAGE G (run second): the one-time "looks finished" sweep

### What Mike sees
- **One row in Decisions ready:** `23 tasks look finished. Close them?`
- **Its card lists each task:**
  - the title (linked)
  - one evidence line with a link, for example: `Live on lifelineiv.com since Nov 2 (go-live receipt)`, `Its project "Phil Camp memorial page" is done`, `Bast finished it on Nov 4 (worker run), still marked in progress`, `Your email to Kue on Nov 9: "I removed the File Manager plugin."`, `The call with Morgan happened on Nov 12 (calendar)`
  - a tick box: ticked for strong evidence, unticked for medium
- **Buttons:** **Close the ticked ones**, **Not now**.
- **Groups below the main list, never closed by the batch button:**
  - `Security tasks (3). Each needs its own tap.` Each row has **Close this one**.
  - `Shows in the client's portal (4). Closing shows it as done to them.` Each row has **Close this one**.
  - `Done except for unticked items (5).` **Open** only.
  - `Filed by the old session sweep (N). Close them?` Its own batch button. These are "Orphaned thread:" tasks; the Echo Grace task c4722a17 is excluded, as in ruling b2.
- **After a tap:** a toast, and a Handled line `Closed 23 tasks that looked finished. Undo` (72 hours, compare-and-set: each task still done and unchanged since).
- **Keep** on a row means it is never offered again for 90 days.

### Rules (`app/lib/work/finished.ts`, pure, code only, no model)
- **Strong evidence:**
  - a `TaskReceipt` with step `live` (or `live_url` set) after the task was created
  - its project is `done` or `cancelled`
  - a worker ledger line `outcome: done` with exit 0 for the task after its last update (posted by the machine)
  - a slice 9 reconcile card or note quoting Mike's past-tense words about it
  - for a meeting task (title or tags say call or meeting), a `CalendarEvent` with a matching attendee that has ended
- **Medium evidence:**
  - every linked ask is closed and our side replied after the newest one
  - a later done task with the same client and title overlap of 0.6 or more
  - a commit in a local clone of the task's site repo (or its project's `plan_folder`) after creation, naming the task's short id or overlapping its title (posted by the machine)
- **Never offered:** deleted tasks; tasks assigned to other users (shown only as a count: `5 of Sabeen's look finished; she was not asked`); tasks edited in the last 48 hours.
- **Closing:**
  - `patchTask` to done (so Stage A closes linked asks), with an internal comment: `Closed from the looks-finished list: {evidence line}.`
  - A task with any unticked checklist item is never closed by this path (the existing done rule).

### Schema (migration `20261117020000_work_g`)
```prisma
// The one-time looks-finished list (and later the shared "looks done" card), owner only.
model WorkFinishedItem {
  id             String    @id @default(uuid()) @db.Uuid
  user_id        String    @db.Uuid
  user           User      @relation("WorkFinishedItemUser", fields: [user_id], references: [id], onDelete: Cascade)
  run_key        String    @db.VarChar(40)   // "sweep-2026-11-12" | "session:<id>" (Stage E)
  task_id        String    @db.Uuid
  grp            String    @db.VarChar(20)   // main | security | portal | unticked | orphan
  strength       String    @db.VarChar(8)    // strong | medium
  evidence       Json                         // [{kind, line, href, at}] built by the server
  state          String    @default("open") @db.VarChar(10) // open | closed | kept | undone | expired
  home_action_id String?   @db.Uuid
  created_at     DateTime  @default(now())
  resolved_at    DateTime?
  @@unique([user_id, run_key, task_id])
  @@index([user_id, state])
  @@map("work_finished_item")
}
```
Add the back-relation on User.

### Routes
- **`POST /api/bast-chat/worker/finished`** (chat key; strict). Body: `{dry: boolean, machine_evidence: [{task_id, kind:'worker_done'|'commit', ref, at}]}`.
  - With `dry`: returns the counts per group and strength, plus 10 sample titles, and writes nothing.
  - Without `dry`: makes the items once. A second run while open items exist answers `already_open`.
- **`POST /api/home/act`** gains `{action:'finished_close', item_keys[]}` (at most 100, the ticked list), `{action:'finished_close_one', item_key}` (security and portal rows) and `{action:'finished_keep', item_key}`. The chat may call all three: it is his word.

### Machine
New `~/.claude/tools/work-links/finished_evidence.py` (stdlib, no model). It reads:
- `~/.model-ledger/runs.jsonl` (citadel-worker `done` lines)
- `git log` in known local clones (`~/Documents/Wright/sites/*`, project `plan_folder`s from `GET /api/oracle/projects`), read-only

It POSTs with `dry:true` by default, and `--apply` for real.

### Task list, Stage G

| Id | What | Files | Depends | Model |
|---|---|---|---|---|
| G0 | Setup, after A merged | plan copy | A merged | Haiku low |
| G1 | Schema | `schema.prisma`, the migration folder | G0 | Sonnet medium |
| G2 | Evidence engine | new `app/lib/work/finished.ts`, `finished-store.ts`, tests and `__tests__/fixtures/finished-cases.json` (at least 30 cases) | G1 | Sonnet medium |
| G3 | Worker route | new `app/app/api/bast-chat/worker/finished/route.ts`, tests | G2 | Sonnet medium |
| G4 | Lane and registry | `lane-scopes.ts`, `registry/bast-chat.ts` | G0 | Haiku low |
| G5 (W) | Wire-in | `item-key.ts` (`finished:`), `types.ts`, `load.ts`, `select.ts` (one Decisions slot, groups), `actions-for.ts`, `copy.ts`, `act.ts` (three acts, undo), `lib/bast-chat/ops/home.ts`, tests | G2, G3, G4 | Sonnet medium |
| G6 | Card | `ItemCard.tsx` (tick list, groups), `use-home.ts`, tests | G5 | Sonnet medium |
| G7 | Machine | `~/.claude/tools/work-links/finished_evidence.py`, tests with fake git | G0 | Sonnet medium |
| G8 | Local run | `app/lib/work/__tests__/stage-g.integration.test.ts` | G5 | Sonnet medium |
| G9 | Gate | as A10, plus G tests | all | Sonnet medium |

**G8 asserts:**
- strong items are ticked and medium are not
- a security task is never in the batch, and one tap closes only that one
- a portal task is closed only by its own tap
- a task with an unticked item is never closed
- Undo restores the status and Stage A's asks
- Keep hides it for 90 days
- nothing changes without a tap

### Deploy, Stage G
Push, green, then the production dry run (`finished_evidence.py` with no flags) reports counts to Mike. Bast reads the sample, then runs `--apply`, which makes the card. Closing waits for his tap.

### Rollback, Stage G
Revert. Items stay unused. Closed tasks are undone from the Handled line.

### What could go wrong
- **Strong evidence is wrong:** a go-live receipt for the first half of a two-part task. Mitigations: unticked checklist items exclude it; Undo; nothing closes without his tap.
- **The card is long.** Strong items are first. The batch is one tap; scrolling is optional.

### Check on real data
The dry-run counts per group, and Bast spot-reads 10 strong items against the task pages (GET).

### Mike decides
- **Does closing a portal-visible task need its own tap?** Recommended: yes, as written. The client sees "done".
- **May the old sweep's orphan tasks be closed in one batch?** Recommended: yes, as he did with 61 on 9 Nov.

**Size: medium.**

**Client-visible:** only the portal group, and only on his per-task tap.

**Switched off or deleted:** nothing.

---

