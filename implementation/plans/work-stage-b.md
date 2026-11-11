# Work stage B: one intake decision per message (plan copy)

Copied from specs/work-integration-plan.md (system-review-2026-11), the STAGE B section, as the build started. Built on branch feat/work-stage-b from origin/main 1c119cd.

## STAGE B: one intake decision per message

### What Mike sees
- **Thank-yous, FYIs, receipts and "sounds good" never become owed replies.** Each one is recorded as handled when it arrives. Handled for you shows a quiet line with Undo:
  `Recorded as handled: Ken Duffy, "Appreciate it Mike". No reply needed. Undo`
  The line's "Show all" opens **Mail recorded as handled** (the last 30 days, each with Bast's reason and Undo). That list is the paper trail he asked for.
- **"Client email waiting" counts only mail that needs his words.**
- **A work request** shows as the task (Stage A), never as an email.
- **A meeting request** shows as a meeting row ("wants a time"). It closes when a calendar event with that person appears after the ask.
- **"Waiting on them"** (an auto-reply, "I'll send it next week") shows nothing until the 5-business-day wait comes into view.
- **Emergencies** appear in Needs you now, as today.
- **The weekly measures line gains:** `Recorded 41 emails as handled. You reopened 1.`

### Rules
1. **The classifier returns one disposition per message**, in the same Sonnet batch call it already makes. No new call. The schema adds:
   - `disposition`: `no_action | reply_mike | work | meeting | waiting_them | emergency`
   - `disposition_reason`: at most 120 characters, plain
   - `action_clear` stays as it is.
2. **Code rules applied after the model, in the classifier** (`final_disposition()`, the only place bodies exist):
   - crisis floor, urgent or any security marker means `emergency`; never `no_action`
   - client mail that hits `CLIENT_REQUEST_CUE_RE`, carries an attachment, or has money words cannot be `no_action` (it becomes `reply_mike`)
   - sales intent means `reply_mike` (a lead), never urgent
   - meeting intent means `meeting`
   - the first-message mint means `work` (the task is linked, Stage A)
   - a fold into an open task means `work`
   - "what do I do with this?" means `reply_mike`
   - the bare thank-you rule stays, as a fast path to `no_action`
3. **Structural floors re-applied in Citadel email-sync:** `is_urgent`, intent `admin` (money mail is always shown) and intent `sales` cannot be `no_action` or `waiting_them`. A refused value is stored as `reply_mike` and reported in `adjusted[]`.
4. **Owner:**
   - `work`: the task's assignee
   - `reply_mike`, `meeting` and `emergency`: Mike
   - `no_action` and `waiting_them`: nobody

   Stored as `owner`.
5. **When the ask is created:**
   - `no_action`: state handled, `closed_reason 'no_action'`, `closed_by 'intake'`
   - `waiting_them`: state handled, plus a `mail.awaiting_reply` wait on `email_thread_id` (idempotency `conv:<conversation_key>`)
   - These are set only when the row is created, never on a later update.
6. **The owed rule** (`app/lib/work/owed.ts`, the one place): an ask is owed only when `askIsMine` (Stage A) holds and its disposition is `reply_mike`, or is null on a row older than this deploy (legacy, until it ages past 21 days).
   - The drafter's queue, short drafts, clocks and Slack lines all read this function.
7. **Undo of an intake close** is the home act `reopen_ask` (session and chat).
   - It sets state open, `disposition reply_mike`, `decided_by 'mike'`, clears the `closed_*` fields, and writes a `home_actions` row. It is allowed for 30 days.
   - Reopens are counted for the measure. The classifier reads the last 30 reopens as calibration examples in its prompt: subject and Bast's reason only, never the body.
8. **Meeting closure:** the calendar sync's write path (`app/api/oracle/calendar-sync`) calls `closeMeetingAsks(event)`. An open `meeting` ask whose sender is among the attendees, with the event created after the ask, closes as `meeting_booked`.
9. **Pieces taken from the owed-triage branch into `lib/work/ask-closure.ts` and `select.ts`:**
   - the close record and Undo pattern
   - thread titles "sender, client: subject"
   - one state phrase on the meta line
   - "a thread is never the day's arc or an arc step" (keeper `arcs.ts`)

   Its triage columns, migration, drafter "triage" request kind, `probably_no_reply` group and confidence auto-dismiss are not taken. The worktree is left in place and marked superseded in DECISIONS (removing it is Mike's call, since Bast deletes nothing).

### Schema (migration `20261117030000_work_b`)
```prisma
// On EmailAsk:
  disposition        String? @db.VarChar(20) // no_action | reply_mike | work | meeting | waiting_them | emergency
  disposition_reason String? @db.VarChar(200)
  owner              String? @db.VarChar(10) // mike | bast | sabeen | nobody
  decided_by         String? @db.VarChar(20) // intake | mike | bast | other_copy
  @@index([disposition])
```

### Routes
- **`POST /api/oracle/email-sync`** accepts the four fields (optional). Its reply gains `{items:[{message_id, id, disposition, adjusted?, prior?:{disposition, task_id}}]}`. `prior` is used in Stage C to stop a second decision on another mailbox's copy.
- **`POST /api/home/act`** gains `{action:'reopen_ask', item_key:'ask:<id>'}`.
- **`GET /api/home`** gains the drawer group `handled_mail`, the 30-day list, read only.
- **`POST /api/bast-chat/worker/decision-replay`** (chat key; **writes nothing**). Body: `{items:[{ask_id, disposition, reason}]}`. It returns what each would change, for the replay check.
- **`POST /api/work/apply-decisions`** (porter; dry first; at most 300). It applies replayed dispositions to open legacy asks: closes those marked `no_action` with one Handled line and Undo. It never closes urgent, admin or sales asks.

### Machine
- **Classifier:** the schema field, `final_disposition()`, the email-sync fields, and calibration examples.
- **`--decide-replay` mode:** reads the open asks of the last 21 days from Citadel (GET) and the bodies through `mail_mirror.fetch_body` (read-only). It runs the same Sonnet batch with a $2.00 run cap, and prints decisions to `~/.local/state/work-b/replay.json`. It writes nothing unless `--apply`, which calls `apply-decisions` with `dry:true` first.
- **Model:** Sonnet, the existing classify batch call, cap unchanged. The replay is Sonnet at about $0.02 per batch of 25, capped at $2.00. Ledger: `--source email-classifier --sop intake-decision` for the replay.

### The drafter (paused): conditions to un-pause
1. A and B are live.
2. The replay has been applied, and `GET /api/bast-chat/worker/owed` (dry) lists only `reply_mike` threads.
3. Bast reads every listed thread's subject and reason and finds no thank-you, booked meeting or task-covered thread. If any appears, it stays paused and the rule is fixed.
4. One business day passes with the next classifier passes writing dispositions, with no wrong `no_action` that Mike reopened.

Then `rm ~/.owed-reply-paused` is allowed and Mike is told. No client mail is involved: drafts sit in his Gmail.

### Task list, Stage B

| Id | What | Files | Depends | Model |
|---|---|---|---|---|
| B0 | Setup after G merged; save `git -C /home/mike/.openclaw/workspace/citadel-owedtriage-wt diff` to the scratchpad as the salvage source | plan copy | G merged | Haiku low |
| B1 | Schema | `schema.prisma`, migration | B0 | Sonnet medium |
| B2 | Decision core | `app/lib/work/owed.ts` (disposition rule), new `app/lib/work/decision.ts` (floors, owner, birth state), `ask-closure.ts` (salvaged close record, `reopenAsk`, `closeMeetingAsks`), tests | B1 | Sonnet medium |
| B3 | Routes | `email-sync/route.ts`, new `app/app/api/work/apply-decisions/route.ts`, new `app/app/api/bast-chat/worker/decision-replay/route.ts`, `app/app/api/oracle/calendar-sync/route.ts` (meeting close call), tests | B2 | Sonnet medium |
| B4 | Lanes and registry | `lane-scopes.ts`, `registry/clarity.ts`, `registry/bast-chat.ts` | B0 | Haiku low |
| B5 (W) | Wire-in | `load.ts` (handled lines with undo, `handled_mail` group), `select.ts` (salvaged title and one phrase; owed reads `owed.ts`), `types.ts`, `copy.ts`, `actions-for.ts`, `act.ts` (`reopen_ask`), `keeper/arcs.ts` (no thread steps), `lib/home/learn/measures.ts` (the line), `lib/bast-chat/ops/home.ts`, tests | B2, B3, B4 | Sonnet medium |
| B6 | Card and list | `ItemCard.tsx`, `RestGroupCard.tsx`, `use-home.ts`, tests | B5 | Sonnet medium |
| B7 | Machine | `clarity-next/email-classifier.py` (schema, `final_disposition`, replay mode, calibration), tests incl. `test_email_classifier_disposition.py` with at least 40 cases from the 11 Nov examples | B0 | Sonnet medium |
| B8 | Local run | `app/lib/work/__tests__/stage-b.integration.test.ts` | B5 | Sonnet medium |
| B9 | Gate | as A10, plus the classifier suite | all | Sonnet medium |

**B8 asserts:**
- "Appreciate it Mike" with a phone-number signature means `no_action`: handled at birth, a line, Undo reopens it
- an urgent ask sent as `no_action` is stored as `reply_mike`
- a `work` fold is never owed
- a meeting ask closes when an event with that attendee lands
- `waiting_them` makes exactly one wait
- legacy null rows behave as today
- the drafter queue lists only `reply_mike`

### Deploy, Stage B
1. Push, green.
2. Swap the classifier (backup).
3. Run `--decide-replay` (no writes). Report to Mike: of the open asks, how many each disposition takes. The four threads Mike closed by hand on 11 Nov (Ken Duffy, Dan Wargo twice, Ashlei) must come out `no_action` or `meeting`, and Knisely 2 Nov must come out `work`.
4. Then `--apply`: a dry POST, then the real POST.

### Rollback, Stage B
Restore the classifier (it sends no disposition, so rows fall back to legacy behaviour). Reopen the replay closes from the Handled line, or with a data migration by `closed_by='intake'`.

### What could go wrong
- **The model calls a real ask "no action."** Mitigations: the body-level floor, the structural floors, the 30-day Undo, the weekly reopen count, and calibration from reopens.
- **A double decision on support@ copies.** Handled in Stage C through `prior`.

### Check on real data
The replay against his 20 manual dismissals. After a day, the reopen count is 0 or near it, and the drafter dry queue holds no thank-yous.

### Mike decides
- **Thank-yous recorded as handled:** already ruled yes.
- **Do "what do I do with this?" messages count as owed replies, so the drafter may draft them?** Recommended: they count as `reply_mike`, but the drafter writes "Needs thought" for them, never a full draft (the gist prefix is the signal).

**Size: medium.**

**Client-visible:** none.

**Switched off or deleted:** the owed-triage branch is not finished; `action_clear` is no longer used as a flag beyond the gist prefix.

