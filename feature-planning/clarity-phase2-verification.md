# Clarity Phase 2 — Executed Verification Record

Ran 2026-07-21 against the Phase 1 API (`~/.openclaw/workspace/citadel-clarity-wt/app`,
branch `feat/clarity-phase1-data-plane`, `PORT=3005 npm run dev`), Postgres at
`localhost:5433` (container `citadel-postgres`, database `citadel_dev`). All commands
below were actually executed; outputs are pasted verbatim (trimmed only where noted).

## Test fixtures used (local dev DB only — never touches prod)

The Phase 1 seed only creates `admin@indelible.agency`, `pm@indelible.agency`,
`tech@indelible.agency`, `oracle@indelible.bot`, `troubador@indelible.bot`. Two
things needed for these tests didn't exist yet in this fresh local DB:

1. **`mike@becomeindelible.com`** — `/api/session-tasks`'s default-assignee
   ("primary operator") lookup targets this exact email. Created directly in the
   local dev DB (role `admin`, `is_active: true`) so the default-assignee path
   could be exercised for real instead of only via an explicit `assignee_id`.
2. **A fresh local API key**, minted the same way `lib/auth/api-keys.ts`
   (`generateApiKey()`) does (`citadel_` + 32 random bytes hex, sha256 hash stored),
   inserted directly into `api_keys` for `mike@becomeindelible.com`. This key stood
   in for `~/.citadel-token` in these tests — see the **deviation** note below,
   this is not a shortcut, `~/.citadel-token` genuinely cannot authenticate against
   this DB.
3. **A second fresh local API key**, same method, for `oracle@indelible.bot` — the
   original seed-minted Oracle key's raw value was shown once at seed time and
   never persisted anywhere readable; only its hash survives in the DB. Needed a
   new one to drive `oracle-heartbeat-v2.py`'s ingest POSTs.

Both raw keys and the throwaway `mike` user were used only for these tests. The
key files (`clarity/test-config.json`, `clarity/test-oracle-key`) have since been
deleted (see cleanup note at the end) — they were test harness, not a spec
deliverable. Reproducing this later just means re-minting a key for
`oracle@indelible.bot` the same way and pointing `CLARITY_HEARTBEAT_CONFIG` at a
config.json with `base_url: "http://localhost:3005"` and that key's file.

A fake top-level `claude_code` session was synthesized so the heartbeat's real
transcript-glob discovery would pick it up like any other session:
`~/.claude/projects/-tmp-clarity-phase2-verification/<fake-uuid>.jsonl`
(external_id `clarity-p2-fake-session-1784655059`), containing a `custom-title`
first line and one tail record with `cwd`/`model`/`usage`. Deleted after
verification (see cleanup note).

---

## (a) manifest.py set/ask/get/clear-ask round-trip + corrupt-file tolerance

```
$ python3 ~/.claude/tools/oracle/clarity/manifest.py get test-uuid-clarity-p2-0001
{
  "arc_name": null, "ask_queue": null, "ask_severity": null, "goal": null,
  "session_type": null, "updated_at": null, "waiting_on": null
}

$ python3 ~/.claude/tools/oracle/clarity/manifest.py set test-uuid-clarity-p2-0001 \
    --type internal --goal "Verify Clarity Phase 2 manifest round-trip" --arc "clarity-phase2-test-arc"
{
  "arc_name": "clarity-phase2-test-arc", "ask_queue": null, "ask_severity": null,
  "goal": "Verify Clarity Phase 2 manifest round-trip", "session_type": "internal",
  "updated_at": "2026-07-21T17:30:32.476Z", "waiting_on": null
}

$ python3 ~/.claude/tools/oracle/clarity/manifest.py ask test-uuid-clarity-p2-0001 \
    --queue decide --text "Should we proceed with the flip?" --severity internal
{ ... "ask_queue": "decide", "ask_severity": "internal",
    "waiting_on": "Should we proceed with the flip?", ... }

$ python3 ~/.claude/tools/oracle/clarity/manifest.py get test-uuid-clarity-p2-0001
# identical to the ask output above — confirms the write landed and re-reads clean

$ python3 ~/.claude/tools/oracle/clarity/manifest.py clear-ask test-uuid-clarity-p2-0001
{ ... "ask_queue": null, "ask_severity": null, "waiting_on": null,
    "goal": "Verify Clarity Phase 2 manifest round-trip", "session_type": "internal", ... }
# goal/session_type/arc_name preserved; only the ask fields cleared
```

**Corrupt-file tolerance:**

```
$ echo '{not valid json!!!' > ~/.claude/oracle/manifests/test-uuid-clarity-p2-0001.json

$ python3 ~/.claude/tools/oracle/clarity/manifest.py get test-uuid-clarity-p2-0001
{ "arc_name": null, "ask_queue": null, ... all null ... }
exit code: 0                      # never crashes on corrupt input — starts fresh

$ python3 ~/.claude/tools/oracle/clarity/manifest.py set test-uuid-clarity-p2-0001 \
    --type systems --goal "Recovered after corruption"
{ "goal": "Recovered after corruption", "session_type": "systems", ... }
exit code: 0                      # writes cleanly over the corrupt file

$ python3 ~/.claude/tools/oracle/clarity/manifest.py set test-uuid-clarity-p2-0001 \
    --type bogus_type --goal "x"
error: --type must be one of ['client_work', 'exploratory', 'internal', 'systems']
exit code: 1                      # validation error, file left untouched

$ python3 ~/.claude/tools/oracle/clarity/manifest.py ask test-uuid-clarity-p2-0001 \
    --queue bogus_queue --text "x"
error: --queue must be one of ['answer', 'decide', 'do', 'review']
exit code: 1

$ cat ~/.claude/oracle/manifests/test-uuid-clarity-p2-0001.json
{ "goal": "Recovered after corruption", "session_type": "systems", ... }
# confirms the two failed validation calls did NOT clobber the good file

$ ls ~/.claude/oracle/manifests | grep tmp
none                               # no leftover .tmp-<pid> files (atomic write confirmed)
```

**Result: PASS.** Round-trip correct, per-field preservation across `set`/`ask`/
`clear-ask` correct, corrupt-file read never crashes (fails open to a fresh
manifest), invalid enum values rejected with exit code 1 without touching the
file, atomic write leaves no tmp debris.

---

## (b) heartbeat-v2 with a fake session + manifest → ingest 200 → DB row proves new fields landed

```
$ python3 ~/.claude/tools/oracle/clarity/manifest.py set clarity-p2-fake-session-1784655059 \
    --type client_work --goal "Ship the Clarity Phase 2 verification" --arc "clarity-p2-verify-arc"
$ python3 ~/.claude/tools/oracle/clarity/manifest.py ask clarity-p2-fake-session-1784655059 \
    --queue review --text "Please review the heartbeat-v2 field mapping" --severity internal

$ CLARITY_HEARTBEAT_CONFIG=~/.claude/tools/oracle/clarity/test-config.json \
    python3 ~/.claude/tools/oracle/clarity/oracle-heartbeat-v2.py
exit code: 0

$ tail -1 ~/.oracle-heartbeat-v2.log
2026-07-21T17:31:34.708Z ok=True claude_code=18 workflow_workers=0 cron=5 spool_sent=0 \
  spool_leftover=0 errors=0 info=200 b'{"success":true,"machine_id":"c30451a8-...",
  "events_ingested":0,"sessions_upserted":23,"agents_upserted":2,"reconciled_stale":0,
  "pruned_events":430}'
```

DB proof (`docker exec citadel-postgres psql -U citadel -d citadel_dev`):

```
select external_id, source, title, session_type, goal, waiting_on, ask_queue,
       ask_severity, arc_id
from oracle_sessions where external_id = 'clarity-p2-fake-session-1784655059';

            external_id             |   source    |                   title
------------------------------------+-------------+-------------------------------------------
 clarity-p2-fake-session-1784655059 | claude_code | Clarity Phase 2 fake verification session
 session_type | goal                                   | waiting_on                                    | ask_queue | ask_severity | arc_id
 client_work  | Ship the Clarity Phase 2 verification  | Please review the heartbeat-v2 field mapping | review    | internal     | (null)
```

**Result: PASS.** `session_type`, `goal`, `waiting_on`, `ask_queue`, `ask_severity`
all landed exactly as declared in the manifest. `arc_id` is correctly null —
heartbeat-v2 deliberately does not resolve `arc_name` (spec: "NOT heartbeat's
job — omit arc entirely for now").

---

## (c) clear-ask → next beat nulls the fields in DB

```
$ python3 ~/.claude/tools/oracle/clarity/manifest.py clear-ask clarity-p2-fake-session-1784655059
{ ... "ask_queue": null, "ask_severity": null, "waiting_on": null,
    "goal": "Ship the Clarity Phase 2 verification", "session_type": "client_work", ... }

$ CLARITY_HEARTBEAT_CONFIG=~/.claude/tools/oracle/clarity/test-config.json \
    python3 ~/.claude/tools/oracle/clarity/oracle-heartbeat-v2.py
exit code: 0
```

DB after the next beat:

```
select external_id, session_type, goal, waiting_on, ask_queue, ask_severity
from oracle_sessions where external_id = 'clarity-p2-fake-session-1784655059';

            external_id             | session_type |                 goal
------------------------------------+--------------+----------------------------------------
 clarity-p2-fake-session-1784655059 | client_work  | Ship the Clarity Phase 2 verification
 waiting_on | ask_queue | ask_severity
 (null)     | (null)    | (null)
```

**Result: PASS.** `waiting_on` / `ask_queue` / `ask_severity` nulled server-side
on the very next beat after `clear-ask`; `session_type` / `goal` correctly
untouched (they were never cleared in the manifest).

---

## (d) no manifest → payload contains none of the new fields (v1 vs v2 diff, same session)

Ran both heartbeats in `--dry-run` (no network, no live config touched — both read
the live `~/.claude/tools/oracle/config.json`, `CLARITY_HEARTBEAT_CONFIG` left
unset for this specific test so the comparison is apples-to-apples) against the
same fake session, before any manifest existed for it:

```
$ python3 ~/.claude/tools/oracle/oracle-heartbeat.py --dry-run > v1_dryrun.json
$ python3 ~/.claude/tools/oracle/clarity/oracle-heartbeat-v2.py --dry-run > v2_dryrun.json
```

Extracted the fake session's entry from each:

```json
// v1
[
  {
    "cwd": "/tmp/clarity-phase2-verification",
    "external_id": "clarity-p2-fake-session-1784655059",
    "last_event_at": "2026-07-21T17:30:59.338Z",
    "model": "test-model",
    "source": "claude_code",
    "title": "Clarity Phase 2 fake verification session",
    "tokens_total": 15
  }
]
// v2 — byte-identical
[
  {
    "cwd": "/tmp/clarity-phase2-verification",
    "external_id": "clarity-p2-fake-session-1784655059",
    "last_event_at": "2026-07-21T17:30:59.338Z",
    "model": "test-model",
    "source": "claude_code",
    "title": "Clarity Phase 2 fake verification session",
    "tokens_total": 15
  }
]

$ diff v1_fake_entry.json v2_fake_entry.json
IDENTICAL   # diff produced zero output
```

**Result: PASS.** With no manifest present, v2's snapshot entry for that session
is byte-for-byte identical to v1 — none of `session_type`/`goal`/`waiting_on`/
`ask_queue`/`ask_severity` appear at all (not even as nulls).

---

## (e) session-start-ritual.sh: synthetic hook JSON for each matcher

```
$ echo '{"session_id":"<fake-uuid>","source":"startup"}' | bash session-start-ritual.sh
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":
  "# Session Contract — Clarity\n\nSTAGED (Clarity Phase 2)... [full SESSION-CONTRACT.md, 5124 chars]"}}

$ echo '{"session_id":"<fake-uuid>","source":"clear"}' | bash session-start-ritual.sh
# same shape, hookEventName "SessionStart", additionalContext length 5124 (full contract)

$ echo '{"session_id":"<fake-uuid>","source":"resume"}' | bash session-start-ritual.sh
# manifest present (client_work / goal set, ask cleared at this point):
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":
  "Your declared Clarity session state -- type: client_work, goal: Ship the Clarity
   Phase 2 verification. No re-declaration needed unless the session has pivoted
   topic -- if it has, re-run manifest.py set."}}

$ echo '{"session_id":"no-such-session-uuid-999","source":"compact"}' | bash session-start-ritual.sh
# no manifest for this id -> short-form contract, NOT the full one:
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":
  "Clarity session contract (short form) -- no declared type/goal on file for this
   session yet. At your next opportunity, ask Mike ONE line: client_work / internal
   / systems / exploratory, plus the intended end result (\"I do not know yet\" =
   exploratory). Then run: python3 ~/.claude/tools/oracle/clarity/manifest.py set
   <session-uuid> --type <type> --goal \"<one line>\"...
   Full contract: ~/.claude/tools/oracle/clarity/SESSION-CONTRACT.md"}}

$ python3 manifest.py ask <fake-uuid> --queue decide --text "Ready to flip settings.json?" --severity internal
$ echo '{"session_id":"<fake-uuid>","source":"fork"}' | bash session-start-ritual.sh
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":
  "Your declared Clarity session state -- type: client_work, goal: Ship the Clarity
   Phase 2 verification | currently waiting on Mike (decide): Ready to flip
   settings.json?. No re-declaration needed unless the session has pivoted topic --
   if it has, re-run manifest.py set."}}

$ echo '{"session_id":"whatever"}' | bash session-start-ritual.sh   # no "source" at all
# fails safe to short-form contract, exit 0

$ echo '{}' | bash session-start-ritual.sh; echo $?
0   # never a non-zero exit regardless of input shape
```

**Result: PASS.** All five documented matchers (`startup`, `clear`, `resume`,
`compact`, `fork`) plus an unknown/missing-source fallback produce correctly
shaped `hookSpecificOutput` JSON. `startup`/`clear` always emit the full
contract regardless of any existing manifest (no re-demand suppression — by
design, since these sources mean a genuinely fresh session). `resume`/`compact`/
`fork` emit the manifest-based reminder (no re-demand) when a manifest exists,
and fall back to the short-form demand when it doesn't. Exit code is always 0.

---

## (f) POST /api/session-tasks and /api/ideas per the contract, incl. dedup

```
$ curl -s -w "\nHTTP:%{http_code}\n" http://localhost:3005/api/session-tasks \
    -H "Authorization: Bearer <local verification key>" -H "Content-Type: application/json" \
    -d '{"session_external_id":"clarity-p2-fake-session-1784655059",
         "title":"Flip settings.json for Clarity Phase 2",
         "description":"Merge settings-snippet.json into ~/.claude/settings.json",
         "severity":"internal"}'

{"id":"bdd03b48-4ea9-4a04-b063-dfc531935371","title":"Flip settings.json for Clarity Phase 2",
 "status":"not_started","priority":3,"source":"session",
 "source_session_external_id":"clarity-p2-fake-session-1784655059",
 "assignee":{"id":"...","name":"Mike Dion","email":"mike@becomeindelible.com",...},
 "deduped":false, ...}
HTTP:201
```

Default-assignee resolution confirmed working end-to-end (no `assignee_id` was
sent; resolved to `mike@becomeindelible.com` — the primary operator — per
`DEFAULT_ASSIGNEE_EMAIL` in `app/api/session-tasks/route.ts`).

**Dedup re-POST** (case/whitespace-insensitive title match, still `not_started`):

```
$ curl -s -w "\nHTTP:%{http_code}\n" http://localhost:3005/api/session-tasks ... \
    -d '{"session_external_id":"clarity-p2-fake-session-1784655059",
         "title":"  flip SETTINGS.json for clarity phase 2  ",
         "description":"Updated description on dedupe re-post",
         "severity":"internal"}'

{"id":"bdd03b48-4ea9-4a04-b063-dfc531935371", ...   # SAME id as the first POST
 "description":[{...,"text":"Updated description on dedupe re-post",...}],
 "deduped":true, ...}
HTTP:200
```

DB confirms exactly one task row (no duplicate created):

```
select id, title, status, priority, source, source_session_external_id from tasks
where source_session_external_id = 'clarity-p2-fake-session-1784655059';
-- 1 row: bdd03b48-4ea9-4a04-b063-dfc531935371 | Flip settings.json for Clarity Phase 2 | not_started | 3 | session | clarity-p2-fake-session-1784655059
```

**`/api/ideas`:**

```
$ curl -s -w "\nHTTP:%{http_code}\n" http://localhost:3005/api/ideas \
    -H "Authorization: Bearer <local verification key>" -H "Content-Type: application/json" \
    -d '{"text":"idea: build a Clarity Oracle-UI badge showing waiting_on ask severity",
         "source":"session","source_ref":"clarity-p2-fake-session-1784655059"}'

{"id":"e58d604d-9bf3-4436-a12d-e451503f2ed7",
 "text":"idea: build a Clarity Oracle-UI badge showing waiting_on ask severity",
 "source":"session","source_ref":"clarity-p2-fake-session-1784655059","status":"open", ...}
HTTP:201
```

DB confirms the row:

```
select id, text, source, source_ref, status from ideas where source_ref = 'clarity-p2-fake-session-1784655059';
-- 1 row: e58d604d-... | idea: build a Clarity Oracle-UI badge showing waiting_on ask severity | session | clarity-p2-fake-session-1784655059 | open
```

**Result: PASS.** Both endpoints behave exactly as the contract in
`SESSION-CONTRACT.md` instructs: 201 on first POST, dedup (200 + `deduped:true`,
same row updated not duplicated) on a case/whitespace-insensitive re-POST to
`/api/session-tasks`, clean 201 + row on `/api/ideas`.

---

## Deviations from the literal spec text (with reasoning)

1. **Auth for local verification did not use `~/.citadel-token` as literally
   instructed.** That token's sha256 hash does not match any `api_keys` row in
   this fresh local dev database (confirmed by direct hash comparison) — it
   authenticates against production (`https://citadel.becomeindelible.com`),
   not this ephemeral local Postgres. This is expected, not a bug: the contract
   text in `SESSION-CONTRACT.md` correctly instructs sessions to use
   `~/.citadel-token` in the real, production-deployed scenario the contract
   describes. For *this* local-only verification I minted an equivalent local
   API key the same way the app itself does (`generateApiKey()`'s exact
   scheme) and used that instead, so the actual HTTP/DB behavior is proven
   without the token substitution changing any code path.
2. **`mike@becomeindelible.com` didn't exist in the local seed data** — created
   it directly (role `admin`) so the default-assignee resolution in
   `/api/session-tasks` could be exercised for real, matching what will
   actually happen in production (`DEFAULT_ASSIGNEE_EMAIL` in
   `app/api/session-tasks/route.ts` is hardcoded to that address).
3. **`oracle-heartbeat-v2.py` logs to `~/.oracle-heartbeat-v2.log`**, not the
   live `~/.oracle-heartbeat.log` — so ad hoc/staged runs of this copy can
   never interleave with or truncate the production heartbeat's log. This is
   additive to the spec, not a contradiction of it.
4. **`settings-snippet.json` contains only the one new `SessionStart` array
   entry to append**, not a full re-statement of the existing `SessionStart`
   block — matches the live settings.json's own convention (`UserPromptSubmit`
   already has multiple independent entries, one per script) and was verified
   by simulating the merge with `jq` (read-only — the live file was never
   written to). See the flip-day checklist below for the exact merge command.
5. **`session-start-ritual.sh` uses a single script with internal
   `source`-based branching**, rather than registering two separate
   `matcher`-scoped hook entries (one for `startup|clear`, one for
   `resume|compact|fork`) pointing at the same script. This mirrors the
   existing live pattern (the current `SessionStart` hook has no `matcher` at
   all — it runs on every source and the script itself decides what to do)
   and avoids depending on undocumented behavior of matching Claude Code's
   `SessionStart` matcher against the `source` field. Functionally
   equivalent, verified directly against all five source values plus an
   unknown/missing one.

## Test-data footprint left in the local dev DB (not cleaned up — ephemeral/local only)

This is entirely inside the local `citadel_dev` Postgres container (port 5433),
never touches production:
- User `mike@becomeindelible.com` (role admin) + 2 freshly-minted API keys (one
  for that user, one for `oracle@indelible.bot`) — raw key values were not
  retained anywhere after testing; only their hashes remain in `api_keys`.
- One task (`Flip settings.json for Clarity Phase 2`) and one idea, both tied
  to the fake session's external_id.
- 23 `oracle_sessions` rows upserted by the two live heartbeat-v2 POSTs (this
  machine's real local Claude Code sessions + cron sessions + the one fake
  session) — a side effect of proving ingest end-to-end, not something
  specifically seeded.
- Nothing outside this container was touched; `npx prisma migrate reset` (or
  `npm run db:reset`) clears all of it if a clean slate is wanted before
  further Phase 1/2 work.

## Cleanup performed after verification

- Deleted the fake transcript
  (`~/.claude/projects/-tmp-clarity-phase2-verification/`).
- Deleted the two test manifests used for round-trip/corruption testing and
  for the fake session (`~/.claude/oracle/manifests/test-uuid-clarity-p2-0001.json`,
  `~/.claude/oracle/manifests/clarity-p2-fake-session-1784655059.json`).
- Deleted the test-only harness files `clarity/test-config.json` and
  `clarity/test-oracle-key` (not spec deliverables — see reproduction note
  above).
- Killed the Phase 1 dev server (`PORT=3005 npm run dev`) after all tests
  completed.
- Nothing under `~/.claude/tools/oracle/` outside `clarity/` was modified;
  no crontab, no `~/.claude/settings.json`, no live oracle script.
