# Plan: FYI mail, new client mail shown at once, two classifier fixes, and the dependency rule

Four work packages. Citadel's disposition column is plain text, so no enum migration is needed. The FYI row and the email-sync change must go out in one Citadel deploy, before the classifier is swapped. The dependency change ships on its own and will release some tasks that are blocked today.

## 1. What is already true, and what must change

### A. The FYI row (Dan and Lisa)

**Already true:**
- **Disposition storage.** `EmailAsk.disposition` is `String? @db.VarChar(20)`, not an enum (`app/prisma/schema.prisma:3367`). A new value `fyi` needs no DDL.
- **One list drives all validation.** Every check reads `DISPOSITIONS` in `app/lib/work/decision.ts:20`:
  - email-sync: `z.enum(DISPOSITIONS)` at `app/api/oracle/email-sync/route.ts:54`
  - apply-decisions and decision-replay: `replayItem` in `app/lib/work/intake.ts` (last lines)
  - Adding `'fyi'` there makes all three routes accept it.
- **The email-sync body schema is not `.strict()`** (route.ts:26-61). Unknown keys such as `addressed_to` are dropped silently by old Citadel. An unknown disposition value is a 400 for the whole batch, so Citadel must deploy first.
- **Only reply_mike is owed today.** `askIsOwed` (`lib/work/owed.ts:54`) is true only for reply_mike, an undecided row, or `work` with no live task. Meeting rows show through `askShowsAsMeeting` (owed.ts:64).
- **`loadThreads` drops everything else.** It (`lib/home/load.ts:912-939`) skips any ask that is neither owed nor a meeting. If Citadel accepted `fyi` with no screen change, FYI mail would silently vanish from home. So WP1 and WP2 must ship together.
- **The meeting row is the template.** It has no clock, no draft and no Waiting words:
  - `newestIsMeeting` (`select.ts:969`)
  - the `meeting` branches in `buildThread` (`select.ts:826-966`)
  - the drafter skip in `owedQueue` (`lib/home/owed/queue.ts:91`)
  - `actions-for.ts:121-126`
  - placement in `select.ts:1577-1581`
- **Threads are never the day's arc or an arc step.** `arcPool` excludes `kind==='thread'` (`lib/home/today.ts:118-121`). Quick still reads `todayPool`, so a thread can sit in Quick.
- **"Clear" exists already.** `no_reply_needed` PATCHes every ask of the thread to `dismissed`, with Undo (`lib/hooks/use-home.ts:565-579`).
- **No stored recipient.** `EmailAsk` has no To/Cc field, so "Dan and Lisa" cannot be rendered without a new nullable column.
- **The classifier sends To but not Cc.**
  - `_fetch_detail` asks gog for `From,Subject,To,...` (`email-classifier.py:884`) and returns `"to"` (line 927).
  - Cc is never requested and never set. `_portal_chat_mail` (line 857) reads `detail.get("cc")`, which is always absent.
  - The model input is only `from`, `subject`, `snippet` (500 chars), `hint` and `client_sender` (lines 1594-1610).

**Must change:**
- A new disposition `fyi`, a nullable `addressed_to` column, server floors, an FYI row on home, and the classifier's model call, schema and code floor.
- **One trap.** The client-floor clamp (`email-classifier.py` ~6150-6164) prefixes the gist with "what do I do with this?" whenever the model returns `action_clear:false`. The `unclear` floor (line ~1978) then forces reply_mike. An FYI from a client would always be refused unless the prompt tells the model to return `action_clear:true` for fyi. That fails safe if the model ignores it.

### B. New client mail shown at once, and mail carried by a task

**Already true:**
- **The one-day hold.** It lives in `threadStatus` (`lib/home/select.ts:342-359`, rule at line 357, constant `THREAD_MIN_AGE_BUSINESS_DAYS = 1` at `lib/home/rules.ts:140`).
- **"Known" has three meanings.** A thread is known when (select.ts:349-352):
  - any ask has a client, or
  - Mike has a Gmail draft on it (`draft_url`), or
  - its intent is sales.
- **Sales already shows from the first minute.** So after B, only threads known through Mike's own draft keep the one-day hold.
- **A live task already hides the email.** `askIsMine` (owed.ts:32-38): an ask whose `task_id` points at a task that is not deleted, whatever its status, is never owed and never a thread row.
  - Exceptions: an urgent ask, or a deleted or missing task.
  - The loader feeds this from `linkedTaskFacts` (owed.ts:69-77, called at load.ts:921).
  - Work stage D's `handled_elsewhere` keys also keep threads off home (select.ts:1374, 1392).
- **"Linked to the task" already works.**
  - The classifier links the ask when it mints or folds: `_patch_ask_link`, or a pending link applied by `_apply_pending_links` right after the sync (`email-classifier.py` ~5296-5306).
  - The home task card lists the linked emails under links: `task.emails` from `load.ts:325-379`, rendered at `select.ts:584-585`, "Email: sender, date: subject".
  - The peek drawer shows `origin_url` (`components/domain/tasks/task-peek-drawer.tsx`).
  - Nothing new is needed for "linked to the task".

**Not already true:**
- **Client threads are held one business day.**
- **A short window for minted mail.** For the seconds between the email-sync POST and the link PATCH, a minted message is `work` with no task, so it is owed. Today the one-day hold hides that window; after B it can flash on screen for one pass. If the link fails, it stays visible, which is the designed fallback in owed.ts:48-51.
- **The drafter shares `threadStatus`** (queue.ts:96). Changing `threadStatus` alone would also make the paused drafter draft new client mail at once. Mike's yes was about what he sees, so keep the drafter's timing.

**Decision on the one-day rule for known non-client people** (threads known only by Mike's own draft): keep it. Mike's words cover clients only. That is the smallest change, and those threads already have his draft open in Gmail. The "New mail, shown after one business day" group stays accurate for them, so `copy.ts:410` and `:450` and `projects/drawer.ts:31` stay unchanged.

### C. WPMU DEV payment receipts

**Already true:**
- The live mirror (`~/.claude/oracle/mail-mirror.db`, read-only) holds 7 such messages:
  - from `contact@wpmudev.com` to mike@whoismikedion.com
  - subject `You Received Payment from Mike Lynn for Invoice INV-0042`
  - snippet `You have received a payment of $23.99. Attached are the payment details.`
- "Invoice" matches `MONEY_SUBJECT_RE` (email-classifier.py:304), so the intent is admin. That means the server's admin floor refuses no_action unless the server's own closed list (`PROVIDER_RECEIPT_RULES`, decision.ts:74) verifies it.
- Neither list has WPMU.

**Must change:** both lists, server first.

### D. Bast's own mail stamped reply_mike by a fallback

**Which floors catch it today:**
- **Never model-judged.** `_heuristic_classify` returns `review` for any `ASSISTANT_SENDERS` sender (email-classifier.py:1383), and `_heuristic_intent` returns `general` (1484). The classification therefore has no `disposition` and `gist:""` (built at ~6104-6112).
- **The path through `_final_disposition` (1948-2004):**
  1. `own_notice` fires only for the closed subject list (1832-1840).
  2. Sales does not apply.
  3. The emergency floor fires on crisis or security wording. This is correct; keep it.
  4. Not work, not meeting, not a receipt.
  5. Not unclear: the gist is empty and the client floor never matches Bast (line 1065).
  6. Not admin.
  7. Then `model is None`, which gives **`no_model_value` → reply_mike (line 1986)**. This is the fallback that catches nearly all of it.
- **Two more fallbacks** in `_apply_dispositions` (2024-2040) also give reply_mike: `no_context` and `error`.

**What Bast's mail does on home today:** `bast@becomeindelible.com` is in `OWN_ADDRESSES` (`lib/home/rules.ts:67-73`), so `threadStatus` returns `'no'` and those rows never show on home or go to the drafter. The harm is the stored value: owed semantics, owner mike, inflated open counts and measures.

**Smallest safe change:** when no model value exists and the sender is in `ASSISTANT_SENDERS`, store **`fyi`** instead of reply_mike.
- It is not owed and closes nothing. It stays open and in every list it is in now.
- Explicit subject markers keep reply_mike: "needs your call" and similar, NEW LEAD, and money words.
- The emergency floor is unchanged.
- I chose `fyi` over `no_action` because no_action would birth-close Bast's lead and "needs your call" forwards. Stage B deliberately kept those open (comment at 1834-1836, test `test_unknown_subject_from_bast_is_not_swallowed`).

### E. Dependency rule

**Already true:**
- `isBlockerSatisfied` (`lib/services/dependencies.ts:30-34`) says a blocker is satisfied when it is done AND (`project.dependencies_ordering_only` OR `approved`).
- Every release path uses it through `isDependentReleasable`:
  - `unblockEligibleDependents`, called on done at `lib/services/task-patch.ts:351` and on approve at `:905`
  - `releaseQuestionDependents` and `releaseTasksIfReleasable`
  - `healBlockedTasks`, called by `POST /api/tasks/unblock-sweep` (`app/api/tasks/unblock-sweep/route.ts:15-27`)
  - `areBlockersSatisfied`, used on create and connect (`app/api/tasks/route.ts:417`, `task-patch.ts:668`)
- `Task.needs_review Boolean @default(false)` exists, opt-in since the 2026-11-18 ruling (schema comment at ~1259).

**Copies of the rule that must change too:**
- `lib/bast-chat/worker-reach.ts:435-441` (`citadelBlockerState`), fed by `BLOCKER_SELECT` and `blockerRef` in `lib/bast-chat/actions.ts:743-750` and ~820
- `lib/engagement/snapshot.ts:110` and `:175`
- `lib/services/needs-attention-digest.ts:79-86`
- Help text in `components/domain/projects/project-form.tsx:361`

**Machine side:** `spawn-gate.py:350-363` already treats done or abandoned as satisfied ("order, not approval"). It needs no change.

## 2. Work packages

**Rules for every builder (put these in every agent prompt):**
- Never edit `/home/mike/.openclaw/workspace/citadel` (the live folder).
- Use absolute paths. Never `cd` in a command that deletes. Never `rm` a relative glob.
- No production writes except the deploy steps in section 3.
- No em or en dashes. Never the words "priority" or "overdue" in screen text, prompts or reasons. `copy-guard.test.ts` covers `lib/home`, `lib/work` and `components/domain/home`.

**Setup:**
- Citadel worktree:
  - `git -C /home/mike/.openclaw/workspace/citadel fetch origin`
  - `git -C /home/mike/.openclaw/workspace/citadel worktree add /home/mike/.openclaw/workspace/citadel-fyi-wt -b feat/fyi-mail origin/main`
  - `npm --prefix /home/mike/.openclaw/workspace/citadel-fyi-wt/app ci`
  - Below, `A=/home/mike/.openclaw/workspace/citadel-fyi-wt/app`.
- Save this plan as `/home/mike/.openclaw/workspace/citadel-fyi-wt/implementation/plans/fyi-mail-and-client-mail.md` (repo CLAUDE.md requires it).
- Record the baseline before any change: `cd $A && npx vitest run 2>&1 | tail -40`. That lists any test files already failing on main, so the gate means "no new failures".

**Scratch Postgres** (container `citadel-home-mig-check`, `localhost:55433`, user and password `citadel`, running now). Each integration file runs alone on its own new database:
1. `docker exec citadel-home-mig-check psql -U citadel -d postgres -c 'CREATE DATABASE fyi_<file>_int'` (use a new name for any rerun)
2. `cd $A && DATABASE_URL=postgresql://citadel:citadel@localhost:55433/fyi_<file>_int npx prisma migrate deploy`
3. `cd $A && DATABASE_URL=postgresql://citadel:citadel@localhost:55433/fyi_<file>_int npx vitest run <that one file>`

Files skip unless `DATABASE_URL` names `localhost:55433`, and `vitest.config.ts` turns file parallelism off for scratch.

**Fresh-database drift check:**
- Create `fyi_mig` and run `migrate deploy` as above.
- Then `cd $A && npx prisma migrate diff --from-url postgresql://citadel:citadel@localhost:55433/fyi_mig --to-schema-datamodel prisma/schema.prisma --exit-code`. Exit 0 means no drift.

---

### WP1: Citadel schema, decision rules and routes (branch `feat/fyi-mail`, first commit)

**Model tier:** Sonnet medium. Registry text and the migration files can be done on Haiku low.

**Files and behaviour:**

1. **`app/prisma/schema.prisma`** (EmailAsk, after `decided_by` at ~3370): add `addressed_to String? @db.VarChar(120) // fyi only: who the message is written to, first names, never an address`. Update the comment at 3367 to list `fyi`.

2. **New `app/prisma/migrations/20261126090000_email_ask_fyi/migration.sql`.** Rename it at rebase if main has a later folder; the latest today is `20261125090000_client_questions_block_cards`.
   ```sql
   -- FYI mail (Mike, 2026-11-20). disposition is VARCHAR(20), so the new value needs no DDL. One nullable column.
   ALTER TABLE "email_asks" ADD COLUMN IF NOT EXISTS "addressed_to" VARCHAR(120);
   ```

3. **`app/lib/work/decision.ts`:**
   - **`DISPOSITIONS`:** append `'fyi'` (keep the existing order).
   - **`applyFloors` (line 196):** add a block for `fyi`. It is refused to reply_mike when `is_urgent` (`fyi_refused_urgent`), when intent is `admin` (`fyi_refused_admin`), or when intent is `sales` (`fyi_refused_sales`). Floors only raise.
   - **`ownerFor` (line 210):** add `case 'fyi': return 'mike';`. tsc fails without it.
   - **`birthState`:** no change (default open).
   - **`planSync` and `decideReplay`:** no change. `fyi` behaves like `meeting`: stored on a new row or an undecided row, never changes a decided row.
   - **New exported `cleanAddressee(v)`:** split on commas, drop any token that contains `@`, replace en and em dashes with a comma, collapse spaces, trim, max 120 characters, null when empty.
   - **Doc comment:** add `fyi` to the top comment.
   - **`PROVIDER_RECEIPT_RULES` (line 74):** add the WPMU entry:
     ```ts
     { domains: ['wpmudev.com'], sub: false, senders: ['contact@wpmudev.com'], subjects: [/^you received payment from .{1,120}? for invoice inv-\d+\s*$/i] },
     ```

4. **`app/lib/work/owed.ts`:**
   - Add `export function askShowsAsFyi(ask, taskById) { return ask.disposition === 'fyi' && askIsMine(ask, taskById); }`.
   - In the `askIsOwed` doc, state that `fyi` is never owed.

5. **`app/app/api/oracle/email-sync/route.ts`:**
   - Schema (after line 55): `addressed_to: z.string().max(400).optional().nullable()`.
   - In the upsert (both create and update, next to `phase6Fields`, lines ~236-245): store it absent-safe, `...(ask.addressed_to !== undefined && { addressed_to: cleanAddressee(ask.addressed_to) })`. A legacy payload must leave the key out of the Prisma calls; the "byte-compatible" tests check this.

6. **Registry** (Haiku):
   - `lib/api/registry/oracle.ts` ~100-118: the disposition list gets `fyi`. Add the fyi floors (urgent, admin or sales gives reply_mike) and `addressed_to?` (string, cleaned, addresses dropped, absent leaves it untouched).
   - `lib/api/registry/clarity.ts` 498 and 502 (apply-decisions): add `fyi` to the list and to the description ("stored without closing, like meeting").
   - `lib/api/registry/bast-chat.ts` 905 (decision-replay): add `fyi` to the list.
   - Do **not** add `addressed_to` to `formatEmailAskResponse` (`lib/api/formatters.ts` ~1223). The classifier's shape test pins that key list (`test_email_classifier_server_shapes.py` `FORMAT_KEYS`).

**Existing tests to update:**
- `lib/work/__tests__/decision.test.ts`:
  - `it.each(DISPOSITIONS)('%s stands on an ordinary ask')` now also runs `fyi` with `{is_urgent:false,intent:null}`; it should stand.
  - Line 50 (`birthState` loop): add `'fyi'` to the open list.
  - Any test listing exact `PROVIDER_RECEIPT_RULES` domains (grep `wpmudev|PROVIDER_RECEIPT_RULES` in the file) gets the new entry.
- `lib/work/__tests__/owed.test.ts:74`: add `'fyi'` to the not-owed list.
- Expected unchanged; run to confirm:
  - `app/api/oracle/email-sync/__tests__/route.test.ts`, the legacy byte-compatible tests at ~225 and ~445. They pass only if `addressed_to` is absent-safe.
  - `app/api/work/apply-decisions/__tests__/route.test.ts:36-46`: `'ignore'` is still a 400.

**New tests:**
- `decision.test.ts`:
  - `applyFloors('fyi', …)` gives reply_mike for urgent, admin and sales, with each `adjusted` word.
  - `ownerFor('fyi') === 'mike'`.
  - `planSync(null, {disposition:'fyi'})` gives an open row with decided_by intake.
  - `planSync(existing with reply_mike, fyi)` changes nothing.
  - `decideReplay` on an undecided open ask with fyi gives verdict `set`.
  - `cleanAddressee` drops addresses and dashes and caps the length.
  - `isVerifiedProviderReceipt`:
    - true for the WPMU subject from `contact@wpmudev.com` with intent admin
    - false from `no-reply@wpmudev.com`
    - false from `contact@wpmudev.com.evil.example`
    - false with a veto word in the subject
    - false when urgent
- `owed.test.ts`:
  - `askShowsAsFyi` is true for an unlinked fyi ask and false when a live task carries it.
  - `askIsOwed` is false for fyi.
- email-sync `route.test.ts`:
  - a posted `fyi` with `addressed_to:"Lisa, lisa@nl-creative.com"` stores `addressed_to:'Lisa'`
  - `fyi` with intent admin is stored reply_mike and reported in `adjusted`
  - a payload without `addressed_to` leaves the key out of create and update

**Backfill (second commit, data only):** new `app/prisma/migrations/20261126091000_email_ask_fyi_backfill/migration.sql`. Ids come from `/tmp/claude-1001/-home-mike/8c7e99e2-16c4-48a9-8742-7ed620820382/scratchpad/review/result_C.json` `fyi_not_addressed_to_mike`.
```sql
-- Mike, 2026-11-20 ("Yes" to the FYI row): the five open asks written to someone else with Mike copied. Compare-and-set, idempotent;
-- never touches a row Mike decided, an urgent row, or one that moved on. A fresh database has none of these ids, so it is a no-op there.
UPDATE "email_asks" SET
  "disposition" = 'fyi',
  "disposition_reason" = 'Written to someone else about their own work. You were copied.',
  "decided_by" = 'bast',
  "addressed_to" = CASE "id"
    WHEN '60f3227f-5501-402b-938d-c3749edc3f0f' THEN 'Dan'
    WHEN '70aadb1c-d7d4-4083-a70b-38fe8f874044' THEN 'Lisa'
    WHEN '687d834a-2fa3-4429-a5f2-31853b2c7749' THEN 'Dan'
    WHEN '25976c82-f3f4-480f-8e42-27405906e6c4' THEN 'Lisa'
    WHEN 'd871a70f-9048-4813-b32f-f9a39db4850c' THEN 'Lisa' END,
  "updated_at" = NOW()
WHERE "id" IN ('60f3227f-5501-402b-938d-c3749edc3f0f','70aadb1c-d7d4-4083-a70b-38fe8f874044','687d834a-2fa3-4429-a5f2-31853b2c7749',
               '25976c82-f3f4-480f-8e42-27405906e6c4','d871a70f-9048-4813-b32f-f9a39db4850c')
  AND "state" = 'open' AND "disposition" = 'reply_mike' AND "is_urgent" = false
  AND ("decided_by" IS NULL OR "decided_by" <> 'mike');
```
`decided_by='bast'` is in `MACHINE_DECIDERS`, so the record says a machine made the change.

To test it, on a scratch database after `migrate deploy`:
1. Insert five `email_asks` rows with those ids (reply_mike, open), plus one with `decided_by='mike'`.
2. Run the SQL twice: `docker exec -i citadel-home-mig-check psql -U citadel -d fyi_bf < $A/prisma/migrations/20261126091000_email_ask_fyi_backfill/migration.sql`.
3. Confirm the five become fyi, the mike row is untouched, and the second run changes 0 rows.

**Gate (all must exit 0):**
- `cd $A && npx tsc --noEmit`
- `cd $A && npx vitest run lib/work/__tests__/decision.test.ts lib/work/__tests__/owed.test.ts app/api/oracle/email-sync/__tests__/route.test.ts app/api/work/apply-decisions/__tests__/route.test.ts app/api/bast-chat/worker/decision-replay/__tests__/route.test.ts lib/home/__tests__/copy-guard.test.ts`
- The fresh-database drift check above.
- Integration, each alone on a new database:
  - `lib/work/__tests__/stage-b.integration.test.ts`
  - `lib/work/__tests__/stage-a.integration.test.ts`
  - `lib/work/__tests__/work-callers.integration.test.ts`

---

### WP2: Citadel home screen (same branch, after WP1)

**Model tier:** Sonnet medium.

**Files and behaviour:**

1. **`lib/home/types.ts`:**
   - `RawEmailAsk` (line 1371): add `addressed_to?: string | null`, and add `fyi` to the disposition doc at ~1396.
   - `HomeItem` (line 293): add `/** An FYI thread: shown, never owed, never counted as waiting. */ fyi?: boolean`.

2. **`lib/home/load.ts`:**
   - Add `addressed_to: true` to `ASK_SELECT` (~878) and to `toRawAsk` (~908).
   - In `loadThreads` line 927: `if (!askIsOwed(r, taskFacts) && !askShowsAsMeeting(r, taskFacts) && !askShowsAsFyi(r, taskFacts)) continue;`, and update the comment at 919.

3. **`lib/home/select.ts`:**
   - **`threadStatus` (342-359).** Compute `const client = thread.asks.some((a) => a.client !== null)` and change line 357 to `if (!lead && !client && !opts.woke && businessDaysElapsed(...) < THREAD_MIN_AGE_BUSINESS_DAYS) return 'young';`. Update the doc comment (338-341): "a client thread shows at once; a thread known only by his own draft waits one business day".
   - **New `function threadIsFyi(th: RawThread): boolean { return th.asks.length > 0 && th.asks.every((a) => a.disposition === 'fyi'); }`** next to `newestIsMeeting` (969). This is what makes a later message addressed to Mike turn the thread back into an ordinary owed thread, with no state change: that ask is reply_mike, so the thread is no longer all fyi. It also covers threads joined across inboxes, because it reads the merged `th.asks`.
   - **`buildThread` (826-966).** `const fyi = threadIsFyi(th);` then:
     - `owed = fyi || newestIsMeeting(th) ? undefined : owedRow`
     - `lead = !fyi && !meeting && …`
     - `woke` and `cameBack` false when fyi
     - `dueLine`, `waitLine` and `clockDue` false when fyi
     - `owedLine = fyi ? FYI_MAIL.line : meeting ? …`
     - `why_now = fyi ? FYI_MAIL.why(addressee) : …`
     - `owedIfIgnored: null` when fyi
     - `personWaiting: !fyi`
     - `minutes = 2`
     - `item.fyi = true`
     - The title, cut at `THREAD_TITLE_MAX`:
       - `FYI: ${firstName(person)} and ${addressee}, ${stripSubjectPrefix(subject)}` when the newest ask has `addressed_to`
       - else `FYI: ${person}, ${subject}`
       - Example: "FYI: Dan and Lisa, newsletter email".
     - The `who` line: `${person} to ${addressee}` (plus client as now).
     - Pass `fyi: true` in `ctx` (add `fyi?: boolean` to `Draft['ctx']` at ~505).
   - **Candidate (~197).** Add `fyi?: boolean` and set it from the draft.
   - **`peopleCompare` (325).** First line: `if (!!a.fyi !== !!b.fyi) return a.fyi ? 1 : -1;`. FYI rows sort after every owed row, so they only fill empty slots under `CAPS.mail` (3) and never push out owed mail. Overflow goes to `waiting_turn` as today (check text "Shows when a row frees up").
   - **Placement (1555-1595).** FYI threads take the existing `mail` branch (1582-1585), never `leads`. Make sure `ctx.lead` is false for fyi.
   - **`reasonFor` (1199).**
     - `case 'mail'`: return `REASON.fyi` when `c.fyi`, `REASON.clientMail` when `c.item.client`, else `REASON.mail`.
     - Also return `REASON.fyi` early for fyi in rest groups, if wanted.
   - **`finalize` (1236).** Pass `fyi: ctx.fyi` inside `owedThread`.
   - **Header comment at line 20:** mention FYI rows.

4. **`lib/home/actions-for.ts`:**
   - Add `fyi?: boolean` to `owedThread` (~62).
   - In `actionsFor` (212), before `own()`, return early like `hands`: `actions: [open_thread (if threadUrl), button('no_reply_needed', null, FYI_MAIL.clear)]`, `more_actions: []`.
   - The FYI row has one action that changes state, and no Not now, This matters more, snooze, on-day or Add to arc.
   - Do this only when not pinned and not an emergency. A thread is never an emergency, but keep the guard.

5. **`lib/home/owed/queue.ts`:**
   - Line 91: `if (newest.disposition === 'meeting' || thread.asks.every((a) => a.disposition === 'fyi')) continue;`. FYI is never offered to the drafter, a tap included.
   - **Keep the drafter's timing for new client mail.** In the final `else` branch (~152, `reason = lead ? 'lead' : 'oldest'`), add before it: `if (!lead && !woke && businessDaysElapsed(newest.received_at, now) < THREAD_MIN_AGE_BUSINESS_DAYS) continue;`, with `woke` hoisted from line 96.
   - Only automatic first drafts wait the day. A "Draft it now" tap (`request`) is served at once.
   - Import `businessDaysElapsed` and the constant from `../rules`. Update the doc comment at lines 4-6.

6. **`lib/home/today.ts:110-112`.** `todayPool` also excludes `c.fyi`, so an FYI row is never in Quick and never an arc step.

7. **`lib/home/learn/store.ts:57`.** Skip `c.fyi` (copied mail must not teach weights). Low risk; it can be left out if it makes the tests noisy.

8. **Copy:**
   - `lib/work/copy.ts` (after `HANDLED_MAIL`, line 97): new `FYI_MAIL = { line: 'You were copied', why: (to) => to ? \`Written to ${to} about their own work. Nothing is owed.\` : 'Written to someone else. Nothing is owed.', clear: 'Clear' }`.
   - `lib/home/copy.ts` `REASON` (328):
     - add `clientMail: 'A client is waiting on a reply.'`
     - add `fyi: 'You were copied on it, so it is shown, not owed.'`
     - keep `mail` for draft-known threads
   - Plain words, no dashes.

9. **`components/domain/home/home-screen-logic.ts:47`.** `mail: res.sections.mail.filter((i) => !i.fyi).length` (FYI never counts as "client emails waiting").

10. **`lib/home/projects/drawer.ts` `whereOf` (~23-45).** For a mail-section FYI candidate return `'An FYI email'` instead of 'A client email waiting'.

**Existing tests to update:**
- `lib/home/__tests__/select.test.ts`:
  - Line 51: `threadStatus(makeThread({ client: active, received_at: fresh }))` now expects `'show'`. Add `expect(threadStatus(makeThread({ draft_url: draft, received_at: fresh }), NOW)).toBe('young')`.
  - Line 49: rename the test to "a client thread shows at once; a thread known only by his draft waits one business day; a sales thread shows at once".
  - Lines 197-205 (`threads too young to show are counted under New mail`): change `young` to `makeThread({ draft_url: <draft>, received_at: d('2026-11-09T20:00:00Z') })`. The expectations stay the same.
  - Line ~515 (`text('new_mail')` → `[['1 new message', ...]]`): change that fixture's young thread from client to draft-only, so the expectation stays. Read the fixture above line 500 to find it.
  - Any assertion on `REASON.mail` text for a client thread now expects `'A client is waiting on a reply.'` (grep `waiting on a reply, and a business day` across `lib/home/__tests__` and `components/domain/home/__tests__`).
- `lib/home/owed/__tests__/queue.test.ts:22-26` (`a young client thread waits; a young lead does not`) **must still pass unchanged**. It proves the drafter's timing kept. Add a sibling: a young client thread with a `request_kind` row **is** queued.
- `lib/home/__tests__/slice4c-select.test.ts:17-24`: the `young` client thread (2026-11-06) is now shown. Its `owed_line` should still be null and `older` stays first. Run it; update only if the order assertion moves.
- Re-run these and fix any assertion that counted young client threads:
  - `lib/home/__tests__/load.test.ts`
  - `lib/home/__tests__/work-b-select.test.ts`
  - `lib/home/__tests__/actions-for.test.ts`
  - `lib/home/__tests__/today.test.ts`
  - `components/domain/home/__tests__/*` (buildTiles counts)

**New tests** (new file `lib/home/__tests__/fyi-select.test.ts`, modelled on `work-b-select.test.ts`):
- **Row shape.** An all-fyi client thread with `addressed_to:'Lisa'` and from Dan Wargo gives:
  - title starting `FYI: Dan and Lisa, newsletter`
  - `item.fyi === true`
  - `owed_line === 'You were copied'`
  - no `owed_state` draft line
  - `clockDue` false even at 10 business days old, with no "Waiting N days"
  - `default_if_ignored` not the owed "If you do nothing" line
  - actions are exactly `[open_thread, no_reply_needed labelled 'Clear']`
  - `more_actions` empty
- **Section.** It is in `sections.mail`, after an owed client thread of the same age; with 3 owed threads it goes to `waiting_turn`.
- **Mixed thread.** Older ask fyi and newest reply_mike gives an ordinary owed row (no `fyi`, the clock line present).
- **Never in Quick, never an arc step.** `buildToday` (today.test helpers) never includes the FYI key in `quick_item_keys` or `step_item_keys`.
- **Drafter.** `owedQueue` skips an all-fyi thread even with `request_kind` set.
- **Tile count.** `buildTiles` mail count excludes fyi rows.
- **Live task.** `loadThreads` through `askShowsAsFyi`: a fyi ask linked to a live task is not a row (owed.test covers the predicate).
- **Client thread at once.** A client thread received 10 minutes ago is in `sections.mail` with reason `'A client is waiting on a reply.'`. A draft-only thread of the same age is counted in `new_mail`.

**Gate:**
- `cd $A && npx tsc --noEmit`
- `cd $A && npx vitest run lib/home components/domain/home lib/work lib/hooks/__tests__` (whole folders)
- `cd $A && npx vitest run`: no new failing files against the baseline
- `cd $A && NODE_OPTIONS=--max-old-space-size=6144 npx next build`
- Integration, each alone on a new database:
  - `lib/home/__tests__/slice4a.integration.test.ts`
  - `lib/home/__tests__/slice4c.integration.test.ts`
  - `lib/home/__tests__/slice2.integration.test.ts`
  - `lib/work/__tests__/stage-b.integration.test.ts`
  - `lib/work/__tests__/stage-d.integration.test.ts`

---

### WP3: Classifier (machine side; build in a fresh staging copy)

**Model tier:** Sonnet medium for the prompt, floors and tests. Haiku low for the swap script.

**Staging:**
- `~/.claude/tools/oracle/clarity-next` is **stale** (Nov 12; it differs from live at line 1871). Do not use it.
- Record `sha256sum /home/mike/.claude/tools/oracle/clarity/email-classifier.py`, then `cp -a /home/mike/.claude/tools/oracle/clarity /home/mike/.claude/tools/oracle/clarity-next-fyi`.
- Edit only inside `clarity-next-fyi`.
- Baseline first: `python3 -I -m unittest discover -s /home/mike/.claude/tools/oracle/clarity-next-fyi -p 'test_*.py' 2>&1 | tail -20`.

**File `clarity-next-fyi/email-classifier.py`:**

1. **`_fetch_detail` (868-933):**
   - Add `Cc` to the `--headers` list (line 884).
   - Return `"to": headers.get("to") or _header_value(payload_headers, "To")` and `"cc": headers.get("cc") or _header_value(payload_headers, "Cc")`. The top-level dict carries only fixed keys (comment at 888-891); `_header_value` is at 4786.

2. **`DISPOSITIONS` (1544)** gets `"fyi"`. **`_DISPOSITION_RANK` (1718)** becomes `{"no_action":0,"waiting_them":1,"fyi":2,"work":3,"meeting":4,"reply_mike":5,"emergency":6}`. Tests use the names, not the numbers.

3. **`DISPOSITION_PROMPT` (1546-1560)** adds:
   > fyi: Mike is only copied. The message is plainly written to someone else (the greeting names them, or Mike is only on the Cc line) about that person's own work. It never mentions Mike or anything Mike is responsible for and asks him nothing. Return addressed_to with the first name of the person it is written to, and action_clear true. When unsure, choose reply_mike, never fyi.

   No dashes.

4. **`_build_classify_prompt` items (1594-1610).** Add:
   - `"to"` and `"cc"`: a list of display names and addresses from `detail["to"]` and `detail["cc"]`, max 10 each.
   - `"mike_on"`, computed in code: `only_to` | `to` | `cc` | `none` | `unknown`. `unknown` applies when the detail has no "to" key.
   - The address set for Mike is `MIKE_ADDRESSES` (line 2483) plus the account plus `support@becomeindelible.com`.

5. **`CLASSIFY_JSON_SCHEMA` (1678-1710).** Enum from `DISPOSITIONS`, and add `"addressed_to": {"type": ["string","null"]}`, not required.

6. **New `_fyi_refusal(detail, cls)`.** Returns a floor mark, or None when FYI may stand. All of these fail toward reply_mike:

   | Condition | Mark |
   |---|---|
   | No `"to"` key, or an empty To list | `fyi_no_recipients` |
   | Every To address is ours (Mike the only To) | `fyi_mike_only_to` |
   | support@ or hello@ in To | `fyi_to_our_group` |
   | `\b(mike\|michael\|dion)\b` in the subject or the sender's words (`_disposition_blob` without gratitude stripping) | `fyi_mike_named` |
   | Greeting to all (first line matches `^(hi\|hey\|hello\|dear\|good (morning\|afternoon))?[\s,]*(all\|everyone\|everybody\|team\|folks\|guys\|both\|y'all\|you two)\b`) | `fyi_greeting_all` |
   | `_MONEY_WORDS_RE` in words or subject | `fyi_money` |
   | Security words: `password\|passcode\|2fa\|two[- ]factor\|verification code\|security\|hack\|breach\|malware\|phish\|compromis\|locked out\|login` | `fyi_security` |
   | No `addressed_to` from the model | `fyi_no_addressee` |

   Then a positive signal is required. Either:
   - the greeting's first name (first line, after an optional hi/hey/hello/dear) equals the first token of `addressed_to` (case-insensitive) and appears in a To or Cc display name or local part, or
   - there is no greeting name and `mike_on == "cc"` with at least one other To address.

   Otherwise `fyi_not_plain`.

7. **`_final_disposition` (1948-2004).** Insert after `_client_thanks_only` (~1983) and before `if model is None` (1985):
   ```python
   if model == "fyi":
       why = _fyi_refusal(detail, cls)
       if why:
           return done("reply_mike", "It may involve Mike, so it stays with him.", why)
       return done("fyi", model_reason or "Written to someone else. Mike is copied.", "fyi")
   ```
   The emergency, sales, work, meeting, receipt, unclear and admin checks above it already run first.

8. **The Bast fallback (WP-D item).** Replace the `model is None` line (1985-1986) with:
   ```python
   if model is None:
       if _sender_of(detail) in ASSISTANT_SENDERS:
           if ASSISTANT_FOR_MIKE_SUBJECT_RE.search(subject) or _MONEY_WORDS_RE.search(subject):
               return done("reply_mike", "Bast asks for your call.", "assistant_asks")
           return done("fyi", "Bast's own mail. Nothing is owed.", "assistant_sender")
       return done("reply_mike", "No decision came back, so it stays with Mike.", "no_model_value")
   ```
   - `ASSISTANT_FOR_MIKE_SUBJECT_RE = re.compile(r"needs your (?:call|answer|ok|okay|yes|decision|review)|\bneeds[- ]mike\b|\bnew lead\b", re.I)`.
   - In `_apply_dispositions` (2033-2039), the `no_context` and `error` fallbacks apply the same choice using `ask["from_email"]` and `ask["subject"]` (helper `_assistant_fallback(sender, subject)`).
   - `final_disposition`'s own `except` (1822-1824) may stay reply_mike; it is a crash path.

9. **`_apply_dispositions` (2024-2045).** When the result is `fyi`:
   - set `ask["addressed_to"] = _disposition_text(entry[1].get("addressed_to"))`, with tokens containing `@` removed and max 120 characters
   - for the Bast fallback, use the first non-ours To display name, or omit it

10. **WPMU receipt.** Next to `PROVIDER_RELAY_NOTICES` (~1876), add `PROVIDER_SENDER_RECEIPTS = (("contact@wpmudev.com", re.compile(r"^you received payment from .{1,120}? for invoice inv-\d+\s*$", re.I)),)`. Check it in `provider_receipt_match` (1914-1945) as an exact sender match, with `notice=False` (no boilerplate stripping; the veto applies in full). Comment: "same list as Citadel decision.ts PROVIDER_RECEIPT_RULES; keep them equal".

**Existing tests to update:**
- `test_email_classifier_disposition.py`:
  - Line 82-88 `test_schema_has_the_six_values_and_the_reason`: the expected enum becomes `[..., "emergency", "fyi"]`. Rename it to `..._seven_values_...`.
  - Lines 90-95: the prompt loop over `ec.DISPOSITIONS` now needs "fyi" in the prompt. Satisfied by item 3.
  - Line 394 `MODEL_OUTPUTS`: add `"fyi"`. `test_never_below_the_floor_whatever_the_model_says` must still pass: every corpus item has an ask cue and no To/Cc in `det()`, so it refuses with `fyi_no_recipients`.
  - Line 1053 `NewStringsAreClean`: add the new reasons to `samples`.
  - Lines 849-856 `test_unknown_subject_from_bast_is_not_swallowed`: unchanged; its model value is `"reply_mike"`, not None.
  - Any test in the folder asserting reply_mike for a `bast@becomeindelible.com` sender with **no** model value now expects `fyi`, unless the subject has a marker. Grep `bast@becomeindelible.com` across `test_*.py`.
- `test_email_classifier_server_shapes.py`:
  - Line 47 `SERVER_DISPOSITIONS`: add `"fyi"`.
  - `FakeCitadel.post_email_sync` (~264-295): mirror the server's fyi floors (urgent, admin or sales gives reply_mike with `fyi_refused_*`).
  - `SERVER_RECEIPT_RULES` (52-61): add a sender-exact WPMU rule. Extend the tuple shape with an optional senders list and `server_verifies_receipt` to check it.
  - Leave `FORMAT_KEYS` and `ShapesCopiedFromTheServer` alone.

**New tests** (new file `test_email_classifier_fyi.py`, run as `python3 -I -m unittest test_email_classifier_fyi`):
- **The Dan and Lisa shape.** Detail from `Dan Wargo <dan@vcdp.org>`:
  - `to="Lisa Gleeson <lisa@nl-creative.com>"`, `cc="Mike Dion <mike@becomeindelible.com>"`
  - snippet "Lisa, the newsletter can go out Tuesday. Which list should we use?"
  - model `fyi` with `addressed_to "Lisa"` gives `fyi`
- **Each refusal mark gives reply_mike:**
  - Mike the only To
  - "Hi Mike," greeting
  - "Mike" in the body
  - "Hi all"
  - a price word
  - "verification code"
  - no addressee
  - an addressee not on To/Cc
  - no greeting with Mike on To
  - a detail without "to" (old fixtures)
- **Order of floors.** Emergency wording beats fyi. Sales intent beats fyi. Admin intent beats fyi. A client `action_clear:false` prefix gives reply_mike.
- **`_fetch_detail`** with faked gog output returns `"cc"` from payload headers.
- **The prompt** includes `to`, `cc` and `mike_on` per item, and the input stays marked as data.
- **The `addressed_to` sync key** is present only for fyi, carries no `@`, and is at most 120 characters.
- **Bast fallback:**
  - with no model value, a plain subject gives `fyi` with mark `assistant_sender`
  - "needs your call", "NEW LEAD" and an invoice subject give reply_mike `assistant_asks`
  - an own-notice subject is still no_action
  - security wording is still emergency
  - no other sender gets the rule (reuse the lookalike list at 859-860)
- **WPMU** (add to `SystemMailRules` in the disposition test):
  - the subject from `contact@wpmudev.com` with intent admin gives no_action with the `provider_receipt` mark and `floor_exempt` set by `_apply_dispositions`
  - `no-reply@wpmudev.com`, the lookalike domain and a "failed" subject do not match
  - existing line 908-909 cases unchanged

**Gate:** `python3 -I -m unittest discover -s /home/mike/.claude/tools/oracle/clarity-next-fyi -p 'test_*.py'` shows no new failures against the baseline, and `/usr/bin/python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" /home/mike/.claude/tools/oracle/clarity-next-fyi/email-classifier.py` exits 0. Also grep the new prompt and reason strings for `—|–|[Pp]riorit|[Oo]verdue`; expect no hits.

**Swap script** (`<scratchpad>/swap-fyi.sh`, modelled on `/tmp/claude-1001/-home-mike/b38de42b-f868-4ea0-97a5-a6b2fac8c580/scratchpad/swap-d9.sh`):
1. Wait up to 5 minutes for no running `oracle/clarity/email-classifier.py` process.
2. Check the live sha256 equals the recorded one (print `LIVE CHANGED` and stop if not).
3. Run `ast.parse` on the staged file.
4. `cp -p` live to `email-classifier.py.bak-20261120-fyi` if it is absent.
5. Copy the staged `email-classifier.py` and the changed or new test files into `/home/mike/.claude/tools/oracle/clarity/`.
6. Run `cmp` and `ast.parse` again.

---

### WP4: Dependency rule (separate worktree `/home/mike/.openclaw/workspace/citadel-depreview-wt`, branch `fix/done-satisfies-dependency`, from origin/main)

**Model tier:** Sonnet medium.

**Behaviour.** A blocker is satisfied when `status === 'done'` and one of these holds:
- its project is ordering-only, or
- `needs_review !== true`, or
- `approved === true`.

So a done blocker satisfies the dependency unless that blocker has `needs_review` true and is not approved.

**Files:**
- **`lib/services/dependencies.ts`:**
  - `BlockerSatisfactionShape` adds `needs_review: boolean` (required, so tsc finds every place that builds it).
  - `isBlockerSatisfied`: `if (blocker.status !== 'done') return false; if (blocker.project?.dependencies_ordering_only) return true; return blocker.needs_review === true ? blocker.approved === true : true;`
  - `BLOCKER_SATISFACTION_SELECT.select` adds `needs_review: true`.
  - Rewrite the top doc comment (3-21), citing Mike 2026-11-18: "Demanding that a task needs a review should be a decision".
- **`lib/engagement/snapshot.ts`:** line 110 select adds `needs_review: true`; line 175 passes `needs_review: b.needs_review`.
- **`lib/services/needs-attention-digest.ts`:** the select at ~79-86 adds `needs_review: true`.
- **`lib/bast-chat/actions.ts`:**
  - `BLOCKER_SELECT` (743-750) adds `needs_review: true`.
  - `BlockerRow` type (785) adds it.
  - `blockerRef` (~820) maps `needs_review`.
- **`lib/bast-chat/worker-reach.ts`:**
  - `BlockerRef` (~73) adds `needs_review?: boolean`.
  - `citadelBlockerState` (435-441): after `ordering_only === true || approved === true` returns satisfied, add `if (b.needs_review === false) return 'satisfied';`, and treat `needs_review === undefined` as part of `unknown`.
  - The line-reference comments at 34-36 and 434 change.
- **Copy and registry:**
  - `components/domain/projects/project-form.tsx:361` becomes "Off (default): a dependent task waits until its blocker is done, and approved when that blocker needs review."
  - The `dependencies_ordering_only` text in `lib/api/registry/projects.ts`, and the unblock-sweep entry in `lib/api/registry/tasks.ts`, say the same.

**Existing tests to update:**
- `lib/services/__tests__/dependencies.test.ts`:
  - The `blocker()` helper (31-38) adds a `needsReview` parameter.
  - The three approval-gated cases (51-59) pass `needsReview=true` to keep their meaning.
  - The exact select shapes at 72-79, 174-181 and 237-241 add `needs_review: true`.
- `app/api/tasks/[id]/__tests__/dependency-propagation.test.ts`:
  - `blocker()` (107-113) and `UNBLOCK_QUERY` (116-133) add `needs_review`.
  - The "done but NOT yet approved" case (~238-247) sets `needs_review: true` on the blocker row.
- `app/api/tasks/__tests__/route.test.ts:1265-1266` and `app/api/tasks/[id]/__tests__/blocked-by-ids.test.ts:110-111` `blockerRow`: add `needs_review`. Any "done but unapproved stays blocked" case passes `true`.
- `lib/services/__tests__/needs-attention-digest.test.ts:42-46` `blocker()`: add `needs_review` (default `true` keeps current expectations).
- `lib/bast-chat/__tests__/worker-reach.test.ts:150` (`approved:false, ordering_only:false` → `'parked'`): add `needs_review: true`.
- `lib/engagement` snapshot tests: grep `isBlockerSatisfied|satisfied:` and add the field.

**New tests:**
- `isBlockerSatisfied`:
  - done, unapproved, `needs_review:false`, approval-gated project → **true**
  - done, unapproved, `needs_review:true` → false
  - done, approved, `needs_review:true` → true
  - not done with `needs_review:false` → false
  - no project with `needs_review:false` → true
- `healBlockedTasks` releases a dependent whose done blocker has `needs_review:false`, and does not release one whose blocker has `needs_review:true` and is unapproved (mocked prisma).
- worker-reach: a done blocker with `needs_review:false` → `'eligible'`; one with `needs_review:true` and unapproved → `'parked'`.

**Gate:**
- `npx tsc --noEmit` and `npx vitest run lib/services app/api/tasks lib/bast-chat lib/engagement`, all run in `/home/mike/.openclaw/workspace/citadel-depreview-wt/app`.
- The full `npx vitest run`: no new failures.
- Integration, each alone on a new database:
  - `lib/tasks/__tests__/triage.integration.test.ts`
  - `lib/tasks/__tests__/client-questions-block.integration.test.ts`
  - `lib/bast-chat/__tests__/tap-race.integration.test.ts`
  - `lib/bast-chat/__tests__/tap-pool.integration.test.ts`
  - `lib/dox/__tests__/dox.integration.test.ts`

## 3. Deploy and swap-in order

**How Citadel deploys:**
- A push to `main` on `git@github.com:tonalqualityx/citadel.git` runs `.github/workflows/deploy.yml`.
- Steps: CI build, scp `.next`, `app/prisma/` and package files to EC2, then `npm ci --production`, `prisma generate`, **`prisma migrate deploy`**, `pm2 restart citadel`.
- A failed migration fails the deploy, and the workflow files a Citadel task.
- Precedent from `DECISIONS.md`: rebase on origin/main, re-run the gates, fast-forward push, watch the run.

**Watching a deploy:** `gh run list --repo tonalqualityx/citadel --workflow deploy.yml --limit 1`, then `gh run watch <id> --repo tonalqualityx/citadel --exit-status`.

### Step 1: Citadel deploy 1 (WP1 and WP2 together, backfill commit not included)

**Push:** `git -C /home/mike/.openclaw/workspace/citadel-fyi-wt fetch origin && git -C … rebase origin/main`, re-run the WP1 and WP2 gates, then `git -C … push origin HEAD:main`.

**Verify:**
- The run is green.
- **Probe (dry, writes nothing):**
  ```
  curl -s -X POST https://citadel.becomeindelible.com/api/work/apply-decisions -H "Authorization: Bearer $(cat ~/.citadel-token)" -H 'Content-Type: application/json' -d '{"dry":true,"items":[{"ask_id":"00000000-0000-4000-8000-000000000000","disposition":"fyi"}]}'
  ```
  - Expect HTTP 200 with `rows[0].verdict` `refused` and `why` `ask_not_found`. Before the deploy this is a 400.
  - Never print the token.
- `GET /api/docs?group=oracle` mentions `fyi` and `addressed_to`.
- Home check: Mike's /dashboard still loads, and a client email that arrived today now appears under client emails.

**Rollback:**
- If the classifier has been swapped, roll it back **first** (step 3).
- Then `git revert` the two commits, push, and watch the run. The nullable column stays; that is harmless.
- If any `fyi` rows exist, add a data-only migration in the same revert push: `UPDATE "email_asks" SET "disposition"='reply_mike' WHERE "disposition"='fyi' AND "state"='open' AND ("decided_by" IS NULL OR "decided_by"<>'mike');`. Old code would otherwise hide them.

### Step 2: Citadel deploy 2 (the backfill migration commit)

**Before the push, read-only:**
- `curl -s 'https://citadel.becomeindelible.com/api/email-asks?state=open&subject=newsletter' -H "Authorization: Bearer $(cat ~/.citadel-token)"`, and the same with `subject=monthly%20stats`.
- Confirm the five ids are open reply_mike.
- Note any **other** open reply_mike ask on the same threads. If one exists, that thread will correctly stay an owed thread; report it rather than widening the backfill.

**Push and verify:**
- The run is green.
- The same GETs show `disposition: fyi` on all five, or fewer where the compare-and-set skipped a row Mike decided.
- On /dashboard the newsletter thread reads "FYI: Dan and Lisa, newsletter email" with no clock and one Clear button. It does not count in "client emails waiting".

**Rollback:** a data-only migration that sets these five ids back to `reply_mike` and `decided_by='intake'`, with `addressed_to` NULL, `WHERE "disposition"='fyi' AND "decided_by"='bast'`.

### Step 3: Classifier swap (WP3)

**Run** `bash <scratchpad>/swap-fyi.sh`.

**Verify:**
- After the next 15-minute pass, `/home/mike/.oracle-email-classifier.log` shows the pass finished with no `email-sync` 400 or error line.
- New lines in `~/.local/state/work-b/decisions.jsonl` parse.
- `GET /api/email-asks?state=open&limit=20` shows new asks with a disposition.
- **WPMU replay** (optional, dry by default, no model calls with `--max-asks 0`): `/usr/bin/python3 /home/mike/.claude/tools/oracle/clarity/email-classifier.py --decide-replay --redecide-receipts --max-asks 0 --days 120`. It should list the WPMU receipts stored as reply_mike. Add `--apply` to close them through the server's own check (Undo for 72 hours, 30-day list).

**Rollback:** wait for no running pass, `cp -p /home/mike/.claude/tools/oracle/clarity/email-classifier.py.bak-20261120-fyi /home/mike/.claude/tools/oracle/clarity/email-classifier.py`, and restore the two test files from their `.bak` copies. Citadel can stay; it accepts both old and new payloads.

### Step 4: Dependency rule deploy (independent; any time after its gate)

**Before the push, read-only:** save the current blocked list to the scratchpad, `GET /api/tasks?status=blocked&limit=500` (or the paginated equivalent). The first unblock sweep after deploy releases every blocked task whose blockers are done, not approved and have `needs_review` false. Bast's worker calls the sweep every tick, so that happens within minutes.

**Push** from the depreview worktree as in step 1.

**Verify:**
- The run is green.
- After the next worker tick, compare the blocked list against the saved one and report which tasks were released, with links.
- `POST /api/tasks/unblock-sweep` is a write; do not call it by hand.

**Rollback:**
- `git revert` and push.
- Released tasks do not re-block on their own. Re-block them from the saved list with a reviewed one-off PATCH (`status: blocked`) for exactly those ids.

## 4. Model tier per package

| Package | Builder | Mechanical sub-steps |
|---|---|---|
| WP1 Citadel schema and route | Sonnet medium | Registry text and the two migration files: Haiku low |
| WP2 Citadel home screen | Sonnet medium | Copy strings: Haiku low |
| WP3 Classifier | Sonnet medium | Swap script and test-file edits that mirror the server lists: Haiku low |
| WP4 Dependency rule | Sonnet medium | None |

Run one verification pass per Citadel push and one for the classifier swap, on Opus or Sonnet at high effort, on top of the executed gates.

## 5. Risks and what I could not determine

1. **Production checks I could not run** (no read of the production database in this read-only pass):
   - whether the newsletter and Deborah threads hold other open reply_mike asks
   - whether Lisa is a ClientContact
   - how many blocked tasks WP4 will release

   Step 2 and step 4 do these reads first.
2. **Two backfill rows the future rules would refuse.**
   - `d871a70f` (Deborah) is summarised as "thanking Mike". The new `fyi_mike_named` floor would keep a message like it with Mike.
   - `687d834a` (Lisa asking for verification codes) would trip `fyi_security`.

   The backfill applies the reviewer's call on all five, but Mike may want those two left as owed.
3. **FYI between people who are not clients shows nowhere on home.** `threadStatus` returns 'no' for unknown people, the same as reply_mike mail from them today. Nothing gets worse, but it is not "shown".
4. **Not included, flagged only:**
   - Bast's "needs your call" forwards never reach the home screen, because bast@ is an own address (`rules.ts:67-73`). They depend on a needs-mike task existing.
   - `spawn-gate.py` treats an abandoned blocker as satisfied; Citadel does not.
   - The classifier's shape test reads a stale worktree (`citadel-workr-wt`), so it would not catch drift on main.
5. **Greeting detection is approximate.** It relies on the snippet (500 characters) for senders who are not clients. Formal greetings ("Good morning Lisa and Dan,") are partly covered. When the floor is unsure it keeps the message with Mike.
6. **Showing client mail at once exposes short-lived states.**
   - A minted message can show for one pass before its task link lands.
   - A client who writes and then answers themselves within the hour now appears briefly.
   - The drafter still waits a business day for automatic drafts, so cost does not change.
7. **Migration names must sort after main's latest at rebase.** Main's latest today is `20261125090000`.