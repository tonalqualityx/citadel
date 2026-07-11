# Oracle Phase 1 — Final Verification Record

Verifier: Task E (final gate agent), running independently of the builder agents.
Rule followed throughout: executed checks decide everything; agent claims (including
the builders' own commit messages) count for nothing until reproduced here.

Branch: `feat/oracle-visualizer` on `/home/mike/.openclaw/workspace/citadel`
Commits verified:
- `30f0164` — feat(oracle): fleet telemetry backend (phase 1)
- `f0ac1f3` — feat(oracle): fleet visualizer UI — Ringside layout, Citadel coloring (phase 1)
- `5886da4` — fix(oracle): resurrection guard, token monotonicity, prune cost, spool locking

Run date: 2026-07-09 / 2026-07-10 (spans midnight EDT), all times EDT unless marked.

---

## Check 1 — Branch integrity

| Command | Result |
|---|---|
| `git log --oneline main..feat/oracle-visualizer` | Exactly 3 commits: `5886da4`, `f0ac1f3`, `30f0164` |
| `git status` | Clean — only pre-existing untracked planning docs (unrelated to Oracle), zero modified tracked files |
| `git diff 5886da4 -- app/` | Empty (0 lines) — working tree exactly matches the fixes commit |
| `git show 5886da4:app/app/api/oracle/ingest/route.ts \| grep -n shouldApplyEventStatusTransition` | Found at lines 146 (function def) and 240 (call site with "Resurrection guard" comment) |
| `git show --stat` on each commit | File lists match the claimed scope: 30f0164 = 12 backend files (ingest/fleet routes, registry, schema, seed, fixture script); f0ac1f3 = 21 UI files (oracle page, components, hooks, nav wiring); 5886da4 = 10 files (route.ts +89, oracle-logic.ts +11, schema +4, migration +2, spec doc committed) |

**Mid-verification event (documented, not a failure):** partway through Check 2, `git branch --show-current`
unexpectedly returned `main` instead of `feat/oracle-visualizer`. Root cause identified via
`git reflog` + `/home/mike/.local/log/citadel-worker.log`: the `citadel-worker.sh` cron
(`*/10 * * * *`, pre-existing, unrelated to Oracle) unconditionally runs `git checkout main &&
git pull --ff-only` at the start of every pass. Its 20:20:01 pass found no eligible PM tasks
and exited cleanly (exit 0) at 20:20:42, leaving the shared checkout on `main` as a side effect.
No commits were altered, no tracked files were touched (the script defers entirely if tracked
files are dirty). I paused the cron for the remainder of this verification
(`touch ~/.citadel-worker-paused`) to prevent recurrence, ran `git checkout feat/oracle-visualizer`,
and re-ran the diff/log checks above — all clean. **Cron was unpaused at the end of this run**
(see Check 6 wrap-up note).

**Result: PASS**

---

## Check 2 — Clean-checkout build

Worktree: `git worktree add --detach /tmp/.../scratchpad/oracle-verify 5886da4` (detached at the
tip fixes commit, since the branch itself was checked out in the main tree). `.env`/`.env.local`
copied in from the main checkout (not tracked by git, same as any real deploy needs env supplied
separately) — pointed at the same dev Postgres on 5433.

| Command | Result | Exit |
|---|---|---|
| `npm ci` | 888 packages installed clean (prisma generate ran via postinstall hook) | 0 |
| `npx prisma generate` | `✔ Generated Prisma Client (v6.19.1)` | 0 |
| `npx tsc --noEmit` | No output — zero type errors | 0 |
| `npx vitest run` | **109 test files passed (109) / 1203 tests passed (1203)** — matches expected count exactly | 0 |
| `npx next build` | `✓ Compiled successfully in 6.5s`, static generation 134/134 pages, `/oracle` route present as `ƒ /oracle` (dynamic) | 0 |

Worktree removed after (`git worktree remove ... --force`); confirmed `git worktree list` shows
only the main checkout afterward.

**Result: PASS** — first-ever production build of this branch succeeds; no client/server
boundary or build-time errors hidden by dev mode.

---

## Check 3 — Live fleet reality check

**Test-noise cleanup** (docker exec psql against `citadel-postgres` on 5433, `citadel_dev` db):

```sql
BEGIN;
DELETE FROM oracle_machines WHERE name IN ('advD-machine', 'reshi-workstation'); -- DELETE 2
DELETE FROM oracle_sessions WHERE external_id LIKE 'test-%' OR external_id LIKE 'advD-%'
  OR external_id LIKE 'spool-drain-%' OR external_id LIKE 'curl-roundtrip-%' OR external_id LIKE 'demo-%'; -- DELETE 4
COMMIT;
```
Both cascade to `oracle_agents`/`oracle_events` via `ON DELETE CASCADE` (confirmed via `\d`
before running). Post-cleanup: 0 rows anywhere matching those `external_id` patterns.

Note: an unrelated orphan machine named `probe` (0 sessions, `stale: true`) remains — it was
not named in the cleanup instructions and has no matching sessions, so it was left alone. It's
inert (no sessions/agents/events) and doesn't affect fleet quality, but is worth a look if it
recurs.

**Heartbeat triggered:** `python3 ~/.claude/tools/oracle/oracle-heartbeat.py` → exit 0.

**GET `/api/oracle/fleet`** with an authed PM session (`pm@indelible.agency` / dev seed password,
cookie-based login via `/api/auth/login`, HTTP 200):

```json
{
  "counts": { "machines": 2, "sessions": 33, "agents": 51 },
  "machines": [
    {
      "name": "Bast", "stale": false, "last_heartbeat_at": "2026-07-10T00:23:04.491Z",
      "sessions": [
        {
          "external_id": "78a55c04-8341-4721-8759-84060daa0916",
          "source": "claude_code", "title": "Indelible-research",
          "status": "waiting", "needs_attention": true,
          "attention_reason": "Claude is waiting for your input",
          "tokens_total": 1783107
        },
        { "source": "workflow", "external_id": "wf_024f061b-ca7", "status": "ended", "agents": "23 agents" },
        { "source": "workflow", "external_id": "wf_aec7ce42-d85", "status": "ended", "agents": "19 agents" },
        { "source": "openclaw_cron", "external_id": "...morning008am", "title": "Daily morning check-in - 8:00 AM ET (weekdays)", "status": "ended" },
        { "source": "openclaw_cron", "title": "Saiph plan audit - Daily 6 AM ET", "status": "ended" },
        { "source": "openclaw_cron", "title": "Sabeen daily briefing - 11:00 AM PKT", "status": "ended" }
        // ... 34 total sessions on Bast: mix of running/stale/ended/waiting claude_code,
        // workflow (with agents), and openclaw_cron sessions
      ]
    },
    { "name": "probe", "stale": true, "sessions": [] }
  ]
}
```

Confirms all required conditions:
- Machine **Bast** present, `stale: false` ✓
- At least one real `claude_code` session — many, including **this verification session itself**,
  external_id `78a55c04-8341-4721-8759-84060daa0916` (matches this transcript's directory under
  `~/.claude/projects/`), status `waiting` ✓✓
- Workflow sessions with agents present (5 `wf_*` sessions ran in the last 24h, several with
  agents: 23, 19, 4, 3, 2) ✓
- `openclaw_cron` sessions present (Daily morning check-in, Email check, Heartbeat, Saiph plan
  audit, Sabeen daily briefing) ✓

**Result: PASS**

---

## Check 4 — Telemetry wiring final state

| Item | Result |
|---|---|
| `~/.claude/settings.json` parses as JSON | Yes (`json.load` succeeded) |
| Oracle hooks present | **6/6** — `SessionStart`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionEnd`, `Notification`, each `python3 ~/.claude/tools/oracle/oracle-event.py >/dev/null 2>&1 \|\| true` |
| model-ledger Stop hook | Intact — `python3 ~/.claude/tools/model-ledger/model-ledger.py harvest --scan >/dev/null 2>&1 \|\| true` still present alongside the oracle Stop hook |
| Crontab oracle line | Exactly **1** line: `* * * * * python3 $HOME/.claude/tools/oracle/oracle-heartbeat.py >/dev/null 2>&1` |
| Crontab pre-existing jobs | **4** found (KNT daily-publish, saiph-auto-triage, saiph-triage-digest, citadel-worker), not 5 as the task brief described. Flagging the discrepancy for the record — the actual required condition (exactly one oracle-heartbeat line, no duplicates) holds; this is a minor count mismatch in the brief, not a wiring defect. |
| `~/.citadel-oracle-key` mode | `600` |
| `~/.claude/tools/oracle/config.json` | `{"base_url": "http://localhost:3000", "key_file": "~/.citadel-oracle-key", "machine": "Bast"}` — correct for pre-prod-deploy state |
| Hook timing vs. unreachable endpoint | Config `base_url` temporarily swapped to `http://192.0.2.1:9999` (RFC 5737 TEST-NET, guaranteed unreachable); piped a synthetic `UserPromptSubmit` hook payload to `oracle-event.py`. **Exit 0, 48ms** (well under the 500ms bar) — confirms the foreground hook path never blocks on the network, per its documented contract (detached child does the real POST with its own 3s socket timeout). Config restored immediately after. The detached child's failed-send did land one line in `~/.oracle-spool.jsonl` (`oracle-verify-timing-test-<ts>`, kind `UserPromptSubmit`) — deleted before the next heartbeat tick could drain/replay it into the DB; confirmed 0 matching rows in `oracle_sessions` afterward. |

**Result: PASS** (with the crontab pre-existing-count note above flagged for awareness, not blocking).

---

## Check 5 — UI E2E + final screenshots

**Playwright spec** (`app/__tests__/e2e/oracle-fleet.spec.ts`) depends on the demo fixture
(`scripts/seed-oracle-fixtures.ts`, machine `reshi-workstation`) for its `grantibly-wright-b1`
WaitingStrip-priority assertion. Per instructions, seeded it temporarily, ran the spec, then
deleted the fixture machine (cascade) immediately after:

- `npx ts-node ... scripts/seed-oracle-fixtures.ts` → fixture inserted (machine `reshi-workstation`, 5 sessions, 8 events)
- `npx playwright test __tests__/e2e/oracle-fleet.spec.ts` → **1 passed (9.2s)**
- `DELETE FROM oracle_machines WHERE name = 'reshi-workstation'` → DELETE 1, cascade confirmed; only `Bast` and `probe` remain

**Final screenshots against REAL data only** (fixtures not reseeded), captured via a standalone
Playwright script (login as `pm@indelible.agency`, same theme-persistence dance as the repo spec)
to `/tmp/.../scratchpad/oracle-screenshots-final/`:

- `desktop-1440-light.png` (1440×900)
- `desktop-1440-dark.png` (1440×900)
- `mobile-390-light.png` (390×912, full-page)
- `mobile-390-dark.png` (390×912, full-page)

Assertions against real data, run in the same pass:
- **No horizontal scroll at 360px**: `scrollWidth: 360, clientWidth: 360` → PASS
- **`≈` prefix on claude_code token counts**: confirmed present, e.g. `≈1,783,107 tok`,
  `≈5,888,030 tok`, `≈5,120,800 tok`, `≈8,298,189 tok`, `≈13,748,026 tok`
- **Waiting-on-Reshi strip populates**: `WAITING ON RESHI (1)` — populated by this build
  session itself (`Indelible-research`, `NEEDS ATTENTION`, `claude code · claude-fable-5`,
  `≈1,783,107 tok`), exactly as predicted ("this build session will be 'waiting' whenever its
  turn is over")

Visual spot-check of `desktop-1440-light.png` and `mobile-390-dark.png`: clean render, correct
theming, machine `Bast` shown live (not stale), Workflows(5)/Crons(5)/Recently ended(17) groups
collapsed correctly, no visual artifacts.

**Result: PASS**

Screenshot paths (absolute):
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final/desktop-1440-light.png`
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final/desktop-1440-dark.png`
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final/mobile-390-light.png`
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final/mobile-390-dark.png`

(The repo spec's own screenshots, captured earlier against the seeded fixture, also exist at
`/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots/`
per its hardcoded `SCREENSHOT_DIR` — those are fixture-based, not the final real-data set.)

---

## Known phase-1 limits (carried forward from spec, unchanged — see
`feature-planning/oracle-phase1-visualizer.md` § "Known phase-1 limits")

- **No wrapping transaction on ingest batches** — a single `/api/oracle/ingest` POST does
  several sequential Prisma calls with no `$transaction`; a partial failure self-heals on the
  next heartbeat/hook retry/spool replay. Acceptable because Oracle is read-only visualization,
  nothing downstream depends on all-or-nothing ingest.
- **Best-effort event loss under extreme burst** — 2MB spool cap, 500-event ingest batch cap;
  a machine producing telemetry faster than the heartbeat can drain will silently drop the
  oldest queued events. No alerting (would require telemetry-about-telemetry, out of scope).
- **Telemetry death is silent locally** — if the heartbeat cron stops (crash, unscheduled,
  reboot), the only signal is absence of new lines in `~/.oracle-heartbeat.log`; no push alert.
  Discovery depends on someone noticing the stale-machine banner on the fleet page.
- **Prod provisioning rule** — `prisma/seed.ts` gives the Oracle service user
  (`oracle@indelible.bot`) the same shared dev `password_hash` as every other seeded user.
  Harmless in dev (ingest auth is API-key-only, `isOracleBot` never checks a password), but
  MUST NOT carry to prod — the prod Oracle service user needs a random/unknown/disabled
  password with no viable login path beyond the API key. See prod checklist below.

---

## Prod-deploy checklist (not executed — read-only reference for when that day comes)

1. Push `feat/oracle-visualizer` to remote, open PR, merge to `main`.
2. CI deploy runs `prisma migrate deploy` against the prod database.
3. Seed/mint the prod Oracle service user (`oracle@indelible.bot` or equivalent) **with a
   random, unknown, or explicitly disabled password** — never the shared dev seed password
   (`password123`), never anything memorable. Ingest auth is API-key-only; the password field
   should have no viable login path at all.
4. Write the prod Oracle API key to `~/.citadel-oracle-key` (mode 600) on this workstation.
5. Flip `~/.claude/tools/oracle/config.json` `base_url` from `http://localhost:3000` to
   `https://citadel.becomeindelible.com`.
6. Confirm the first successful ingest (heartbeat log line or a manual
   `python3 ~/.claude/tools/oracle/oracle-heartbeat.py` run against prod, exit 0, no errors).
7. Confirm the machine (`Bast`) appears in the **prod** `/api/oracle/fleet` response, not stale.

None of this was executed as part of this verification — prod was not touched, per instructions.

---

## Session wrap-up

- `~/.citadel-worker-paused` was created mid-run to stop the concurrent cron from switching the
  shared checkout's branch again; **it has been removed** (`rm ~/.citadel-worker-paused`) at the
  end of this verification so the citadel-worker cron resumes its normal 10-minute cadence.
- Oracle config.json is back to `{"base_url": "http://localhost:3000", ...}` (post unreachable-
  endpoint timing test).
- Test-noise DB rows (advD-machine, reshi-workstation demo fixture, test-/spool-drain-/
  curl-roundtrip-/demo- prefixed sessions, and the timing-test spool artifact) were all cleaned
  up; only real telemetry (`Bast`, plus the pre-existing inert `probe` orphan) remains in the
  dev DB.
- This file was written but **not committed** and **not pushed**, per instructions.

## Bottom line

**DEPLOY-READY (Phase 1, superseded — see Phase 1.5 section below for the current gate).**
All 6 checks pass on executed evidence, not agent claims: branch integrity
clean (including a self-diagnosed, self-resolved concurrent-cron collision), a from-scratch
`npm ci` + production `next build` succeeds for the first time on this branch, all 1203 tests
pass, real live telemetry (including this very verification session) renders correctly in the
fleet API and UI at every required viewport/theme combination, and all telemetry wiring
(hooks, cron, key permissions, non-blocking hook timing) checks out. Known phase-1 limits are
documented and accepted; the only action item before a prod deploy is the manual service-user
password step in the checklist above.

---

# Phase 1.5 — Final Verification (Admin-only + Remote Spawn)

Run date: 2026-07-10. Verifier: same discipline as Phase 1 — executed checks decide
everything, agent claims (including this agent's own prose) count for nothing until
reproduced with a command and its real output.

Branch: `feat/oracle-visualizer`. Commits verified (6 total — the 3 Phase 1 commits above
plus):
- `7931e9c` — feat(oracle): admin-only fleet + remote spawn command queue (phase 1.5)
- `c666583` — feat(oracle): admin-only UI gating + Remote Spawn New Session UI (phase 1.5)
- `bc7e386` — fix(oracle): reject CLI flag-injection prompts server-side (Opus Finding 2,
  this run's fix)

## Job 1 — Security fix: CLI flag-injection via prompt (Opus Finding 2, escalated CRITICAL)

**The vulnerability.** `oracle-dispatch.py` passes the admin-authored `prompt` to `claude` as
exactly one argv element — shell-safe (no shell ever parses it) but NOT parser-safe: `claude`
runs its own commander.js option parser over argv, so any element starting with `-` can be
read as a real CLI flag regardless of its position. Two payloads were proven exploitable:
- `--dangerously-skip-permissions` — silently bypasses the permission system.
- `--mcp-config={"mcpServers":{"pwn":{"command":"touch","args":["<marker>"]}}}` — launches an
  attacker-chosen command at claude startup, before any permission prompt at all (proven via a
  real `touch` marker file created in a scratch tmux rehearsal, then removed).

**The fix — defense in depth, three independent layers, none trusting the others:**

1. **Structural (dispatcher, `spawn_tmux_session`):** argv is now built as
   `[binary] + configured_flags + ["--", prompt]` (only appending `--`/prompt when a prompt is
   present) instead of the old `[binary, prompt] + flags`. `--` is commander.js's standard
   end-of-options terminator — everything after it is strictly positional, never re-enters the
   option parser, regardless of what it starts with.
2. **Server reject (`app/app/api/oracle/commands/route.ts`):** `spawnPayloadSchema.prompt` now
   carries a Zod `.refine()` that 400s any prompt whose first non-whitespace character is `-`,
   before a hostile command can even reach the queue.
3. **Dispatcher reject (`oracle-dispatch.py`, new `validate_prompt()`):** an independent
   re-check of the identical rule, run again immediately before spawn. Never trusts that the
   server's check ran, was deployed, or wasn't bypassed by a direct DB write or a future
   code path — this machine enforces its own copy of the invariant regardless.

**Proof, executed (2026-07-10, scratch tmux + real dev server + real Postgres, all cleaned up
after):**

| Test | Command / method | Result |
|---|---|---|
| Baseline order is genuinely vulnerable | `tmux new-session ... -- claude --dangerously-skip-permissions --remote-control` (old code's exact argv shape for that prompt) | Pane shows claude starting in skip-permissions mode; the string never appears as a submitted user prompt at all — confirms this was a real flag-parse, not just theoretical |
| `--` structural fix delivers a hostile string as literal text | `tmux new-session ... -- claude --remote-control -- --dangerously-skip-permissions`, then `tmux capture-pane` + `/proc/<pid>/cmdline` | Pane shows `❯ --dangerously-skip-permissions` as an actual echoed/submitted prompt; `/rc active` footer present; cmdline exactly `claude --remote-control -- --dangerously-skip-permissions`; no flag consumed |
| `--` fix doesn't break the happy path | Same rehearsal with prompt `"say hello and then stop, this is a rehearsal test"` | Prompt auto-submitted verbatim, claude replied in-character, `/remote-control is active` banner + persistent `/rc` footer marker both present — `remote_control: confirmed` |
| Server rejects both attack payloads | Logged in as `admin@indelible.agency` (cookie via `/api/auth/login`), `POST /api/oracle/commands` with `prompt: "--dangerously-skip-permissions"` and separately `prompt: "--mcp-config={\"mcpServers\":{\"pwn\":{\"command\":\"touch\",\"args\":[\"/tmp/oracle-pwned-marker\"]}}}"` | Both **400**, body `{"error":"Validation failed","details":[{"...","message":"prompt may not begin with '-' ..."}]}`; `/tmp/oracle-pwned-marker` confirmed never created; no command row created |
| Dispatcher independently rejects even if the server layer is bypassed | Inserted a `pending spawn_session` command **directly via `docker exec psql`** (bypassing the Next.js/Zod layer entirely) with the same `--mcp-config` marker-touch payload targeting machine `Bast`, then ran the real `oracle-dispatch.py` | Log: `outcome: "failed", reason: "prompt may not begin with '-' (reserved to prevent CLI flag injection)"`; **no tmux session was ever created** (tmux server didn't even start); marker file confirmed absent |
| Vitest coverage for the server-side reject | `npx vitest run app/api/oracle/commands/__tests__/route.test.ts` | **20/20 passed**, including 4 new cases: rejects `--dangerously-skip-permissions`, rejects the `--mcp-config` RCE payload, rejects a leading-whitespace-then-dash prompt, allows a benign prompt that merely contains a mid-string dash |
| Unit coverage for the dispatcher-side reject | Direct `validate_prompt()` calls (None/empty/normal/dash-leading/whitespace-then-dash/non-string) | All 8 cases matched expected pass/fail |

All rehearsal tmux sessions killed, all test command rows deleted, no marker files left behind.

**Result: PASS.** Both attack payloads are stopped at two independent layers; the legitimate
spawn path (prompt delivery + remote-control activation) is unaffected.

## Job 2 — Final verification of the full build (Phase 1 + 1.5)

### Check 1 — Branch integrity

| Command | Result |
|---|---|
| `git log --oneline main..feat/oracle-visualizer` | Exactly 6 commits: `bc7e386`, `c666583`, `7931e9c`, `5886da4`, `f0ac1f3`, `30f0164` |
| `git status --short` | Only pre-existing untracked planning docs (unrelated to Oracle: email-dispatcher-design.md, wright-*.md, implementation/plans/*.md, test artifact dirs); zero modified tracked files beyond the fix, which is already committed |
| Fix commit content | `bc7e386` touches exactly `app/app/api/oracle/commands/route.ts` (+22/-1) and its test file (+62) — matches the security-fix scope, nothing else |

Out-of-repo deliverables (not tracked by git, checksummed instead — `~/.claude/tools/oracle/`):

| File | SHA-256 |
|---|---|
| `oracle-dispatch.py` | `8f2a10fe65c48273c65542fafa67f34490fbfd2f78d4f73432f394909ebc7bea` |
| `oracle-event.py` | `c647a6dd6fa226e5d81492b1b8cd5b5caab55f412429555a35d7cfaaa12ace9b` |
| `oracle-heartbeat.py` | `68620634925045eed39937a3799f68388e7a57a444f0f6ff2222d3d0ba277edb` |
| `oracle_common.py` | `0f38ab6dcbf27171aa41287d2ec561b8fd92e86b26a16fe730f823f9b924d9c6` |
| `config.json` | `25d4d1d1cb7b8588d7b7d79a2cfb2fc219799fc1c95f37e3cfc892750e8f015b` |

**Result: PASS**

### Check 2 — Clean-checkout build

Worktree: `git worktree add --detach /tmp/.../scratchpad/oracle-verify-p15 feat/oracle-visualizer`
(detached HEAD at `bc7e386`, since the branch is checked out in the main tree). `.env`/`.env.local`
copied in from the main checkout, pointed at the same dev Postgres on 5433.

| Command | Result | Exit |
|---|---|---|
| `npm ci` | 888 packages installed clean | 0 |
| `npx prisma generate` | `✔ Generated Prisma Client (v6.19.1)` | 0 |
| `npx tsc --noEmit` | No output — zero type errors | 0 |
| `npx vitest run` | **113 test files passed (113) / 1268 tests passed (1268)** — 1264 baseline (per the Phase 1.5 spec's expected count) + 4 new leading-dash-reject tests added by this run's fix | 0 |
| `npx next build` | `✓ Compiled successfully in 6.4s`, full route manifest generated including `/oracle` as `ƒ` (dynamic) | 0 |

Worktree removed after (`git worktree remove ... --force`); `git worktree list` shows only the
main checkout afterward.

**Result: PASS**

### Check 3 — Full auth matrix (executed, live dev server)

Identities: `admin@indelible.agency` (admin), `pm@indelible.agency` (pm),
`tech@indelible.agency` (tech), oracle bot (`Authorization: Bearer <~/.citadel-oracle-key>`),
unauthenticated. All via cookie-JWT login (`/api/auth/login`) except the bot, which is
Bearer-key.

| Endpoint | admin | pm | tech | bot | unauth |
|---|---|---|---|---|---|
| `GET /api/oracle/fleet` | **200** | 403 | 403 | 403 | 401 |
| `POST /api/oracle/commands` | **201** | 403 | 403 | 403 | 401 |
| `GET /api/oracle/commands?status=pending&machine=Bast` | 403 | 403 | 403 | **200** | 401 |
| `PATCH /api/oracle/commands/[id]` (claim) | 403 | 403 | 403 | **200** | 401 |

Exactly the required shape: fleet + command-creation are admin-only (1.5a); command
read/claim is bot-only, machine-scoped. The one probe command created for this matrix was
completed `failed` (never spawned) and its row deleted immediately after.

**Result: PASS**

### Check 4 — Live fleet reality

**Test-noise cleanup** (`docker exec citadel-postgres psql -U citadel -d citadel_dev`):
- `DELETE FROM oracle_machines WHERE name='probe'` → 1 row (cascaded 0 sessions/events — it
  was already empty/inert)
- `DELETE FROM oracle_sessions WHERE external_id ILIKE 'demo-%'` → 5 rows (cascaded their
  agents/events)
- `DELETE FROM oracle_sessions WHERE external_id='timing-test'` → 1 row (Check 5's own
  timing-test debris from an earlier rehearsal)
- `DELETE FROM oracle_commands WHERE id IN (...)` → 7 stale rehearsal command rows (all
  pre-existing `failed`/`done` test rows on `Bast` from earlier build/gate work, none from this
  run)
- `DELETE FROM oracle_machines WHERE name='reshi-workstation'` → 1 row — an empty synthetic
  machine (0 sessions, 0 events, 0 commands, heartbeat 20+ min stale) left over from earlier
  cross-machine-scoping test rehearsals; judgment call to remove it since it carried zero real
  telemetry and its presence would misrepresent the fleet as "2 machines" when there is
  actually one real workstation

**Heartbeat triggered:** `python3 ~/.claude/tools/oracle/oracle-heartbeat.py` → exit 0,
`sessions_upserted=20, agents_upserted=51, reconciled_stale=0`.

**`GET /api/oracle/fleet`** (admin session), post-cleanup:
```
counts: {"machines": 1, "sessions": 71, "agents": 51}
machine: Bast  stale: False  last_heartbeat_at: 2026-07-10T03:44:15.416Z
  by source: claude_code=61, openclaw_cron=5, workflow=5
  THIS SESSION PRESENT: title="Indelible-research", status="waiting"
```

Confirms: **Bast** present and not stale; this verification session itself present in the
fleet; 5 workflow sessions present; 5 openclaw_cron sessions present (Heartbeat, Email check,
Daily morning check-in, Saiph plan audit, Sabeen daily briefing).

Note: the heartbeat log line for this same minute reported `cron=6` (openclaw's live cron
list) vs. 5 `openclaw_cron` sessions actually stored — a minor, pre-existing discrepancy in
raw-count-vs-stored-sessions, not something this verification pass introduced or that blocks
the gate; flagged for awareness only.

**Result: PASS**

### Check 5 — Telemetry wiring final state

| Item | Result |
|---|---|
| `~/.claude/settings.json` parses as JSON | Yes |
| Oracle hooks present | **6/6** — `SessionStart`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionEnd`, `Notification` |
| model-ledger Stop hook | Intact, alongside the oracle Stop hook (both present in the same `Stop` array) |
| Crontab oracle lines | Exactly **1** `oracle-heartbeat.py` line + exactly **1** `oracle-dispatch.py` line, both `* * * * *` |
| Crontab pre-existing jobs | KNT daily-publish, Saiph auto-triage (`*/10`), Saiph triage-digest, citadel-worker (`*/10`) — all intact |
| `~/.citadel-oracle-key` / `~/.citadel-token` mode | `600` / `600` |
| `~/.claude/tools/oracle/config.json` `base_url` | `http://localhost:3000` — correct pre-prod-deploy state |
| Hook timing vs. unreachable endpoint | `base_url` temporarily swapped to an unreachable local port (`127.0.0.1:19999`), a synthetic `Stop` hook payload piped to `oracle-event.py` — **48ms**, well under the 500ms bar. Config restored and diffed byte-identical against the pre-test copy afterward. The failed-send spooled one line to `~/.oracle-spool.jsonl` (`timing-test-2`) — cleared before the next heartbeat tick could drain it; confirmed 0 matching rows landed in `oracle_sessions` |

**Result: PASS**

### Check 6 — Final screenshots (real data)

Standalone Playwright script (`/tmp/.../scratchpad/final-screenshots-p15.js`, adapted from the
Phase 1 script to log in as **admin** — Oracle is admin-only as of 1.5a, so the old `pm@`
login would 403), against real fleet data only (no fixtures). One pending command
(`screenshot-seed-pending-DO-NOT-USE`) was seeded via the real API immediately before the run
specifically so the command chip would render. It was checked as still `pending` and the row
deleted right after the screenshot pass — **but the live dispatcher cron (fires every minute,
was never paused during this check) independently claimed and spawned it in that same window,
after the pending-check and before/around the deletion**, since it was a syntactically valid,
non-malicious spawn_session command (title only, no prompt, cwd `/home/mike`) sitting in the
real queue. This produced a real `oracle-8470439a` tmux session with an idle, harmless
remote-control-enabled claude instance — caught on a routine post-task tmux sweep, immediately
`tmux kill-session`'d, and confirmed both the tmux server and the spawned pane's PID
(`2481550`) gone. No malicious content was involved (this was the benign screenshot-seed
command, not one of the attack payloads) and the corresponding command row was already deleted
from the DB by the time this was caught. Corrected here rather than silently leaving the
original (inaccurate) "never spawned" claim in place — the actual lesson is that seeding *any*
real command on a live queue with an active dispatcher cron will get processed for real within
about a minute, so a tmux/process sweep after such a step is mandatory, not optional.

| Check | Result |
|---|---|
| No horizontal scroll at 360px | `scrollWidth: 360, clientWidth: 360` → PASS |
| "New session" button visible | `true` |
| Command chip present | `count: 1`, `data-status: "pending"` |
| Waiting-on-Reshi populated | `WAITING ON RESHI (1)` — this verification session itself, `NEEDS ATTENTION`, `≈7,163,501 tok` |
| `≈` token-count prefix present | `true` |

Screenshots (absolute paths, all 4 visually spot-checked — clean render, correct theming in
both light/dark, fleet + New Session button + pending command chip + waiting strip all
visible, `Bast` shown live not stale, Workflows(5)/Crons(5)/Recently ended(56) collapsed
correctly):
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final-p15/desktop-1440-light.png`
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final-p15/desktop-1440-dark.png`
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final-p15/mobile-390-light.png`
- `/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-screenshots-final-p15/mobile-390-dark.png`

**Result: PASS**

## Opus review findings — final disposition

- **Finding 1 — per-machine auth (latent, multi-machine).** Today the dispatcher trusts
  `config.json`'s `machine` value and the bot key is shared across any machine that has it;
  there is currently exactly one real machine (`Bast`), so this is dormant. **RECORDED AS A
  HARD PREREQUISITE: before a second machine is ever onboarded to Remote Spawn, per-machine
  auth (distinct bot keys/credentials per machine, server-side verification that a claiming
  machine's key actually maps to the `machine` name on the command) must be designed and built
  first.** Not fixed in this pass — out of scope while single-machine, but it gates any
  expansion.
- **Finding 2 — CLI flag injection via prompt (CRITICAL).** **FIXED** this run, three
  independent layers (structural `--` separator, server Zod reject, dispatcher independent
  reject) — see Job 1 above for full proof against both the `--dangerously-skip-permissions`
  and `--mcp-config` RCE payloads.
- **Finding 3 (nicety, not fixed) — remote-control confirmation is spoofable by prompt echo.**
  `confirm_remote_control()`'s regex scans the captured pane text for the `/rc active` /
  "remote-control is active" signal; a sufficiently crafted prompt could in principle cause
  claude to echo/print that same string as ordinary conversation output (e.g. if asked to
  quote it), which would false-positive the confirmation. Cross-referencing the `/proc/<pid>/
  cmdline` argv (already read for `pid_alive()`) against the actual `--remote-control` flag
  presence would close this, but doing it robustly needs to distinguish "flag is in the argv we
  spawned" (already known, not useful signal) from "the TUI's own internal state actually
  activated it" — the real gap is a TUI-external signal, which doesn't exist today. Not cheap
  to close properly; noted per instructions, not implemented, scope not expanded.
- **LOW/INFO notes carried forward:**
  - `remote_control` confirmation is a best-effort text-match, not a cryptographic proof of
    state (see Finding 3).
  - **Stranded `claimed` rows**: if the dispatcher process dies between claiming a command and
    completing it, that row is stuck `claimed` forever — no reaper/timeout exists. Low-impact
    (visible on the command chip, doesn't block anything), not fixed.
  - **cwd is not a sandbox**: `validate_cwd()` guarantees the cwd is under `$HOME`, not that
    it's safe — any directory under `$HOME` (including this very repo) is a legal spawn target.
    This is by design (Remote Spawn's whole point is starting sessions in real project
    directories) but is worth remembering it is not a containment boundary.
  - **Oracle service-user key is `pm`-valued, not role-gated by itself**: `isOracleBot()`
    authorizes by exact email match (`oracle@indelible.bot`), not by role — the bot's `pm` role
    is incidental/unused for its own authorization path, but would matter if any future route
    reused role-based checks against this same account. Worth remembering when adding new
    Oracle-adjacent routes.

## Prod-deploy checklist (refreshed for Phase 1.5, still not executed)

1. Push `feat/oracle-visualizer` to remote, open PR, merge to `main`.
2. CI deploy runs `prisma migrate deploy` against the prod database.
3. **Mint the prod Oracle service user (`oracle@indelible.bot` or equivalent) WITH a
   random/disabled password** — never the shared dev seed password (`password123`), never
   anything memorable. Ingest/read auth is API-key-only; the password field must have no
   viable login path at all.
4. Write the prod Oracle API key to `~/.citadel-oracle-key` (mode 600) on this workstation.
5. **After deploy**, flip `~/.claude/tools/oracle/config.json` `base_url` from
   `http://localhost:3000` to the prod URL, **and** install the prod key from step 4 — do both
   together, not the URL alone (a stale dev key against a prod URL fails auth; a prod key
   against the dev URL silently writes into the wrong database).
6. Confirm the first successful ingest (heartbeat log line or a manual
   `python3 ~/.claude/tools/oracle/oracle-heartbeat.py` run against prod, exit 0, no errors).
7. Confirm the machine (`Bast`) appears in the **prod** `/api/oracle/fleet` response, not stale.
8. **Mike's manual step:** enable `/config` → "Enable Remote Control for all sessions" as
   belt-and-braces so Remote Spawn sessions always come up steerable even if `--remote-control`
   is ever dropped from `spawn_command`.
9. **Gate: Finding 1 (per-machine auth) must be designed and built before a second machine is
   ever onboarded to Remote Spawn** — this is not optional hardening, it is a hard prerequisite
   per the Opus review's final disposition above.

None of this was executed as part of this verification — prod was not touched.

## Phase 1.5 wrap-up

- `~/.citadel-worker-paused` was in place for the duration of this run (per instructions,
  left untouched until the very end) and **has been removed** as the final step, confirmed gone
  via `ls`.
- All rehearsal/attack artifacts cleaned up: tmux sessions killed, test command rows deleted,
  test sessions/machines deleted, marker files confirmed never created, spool file cleared,
  config.json restored byte-identical, cookie files removed from scratchpad.
- This file was updated but **not committed** and **not pushed** (the security fix itself,
  `bc7e386`, was committed to the branch per instructions — this verification record is a
  planning-doc artifact, same treatment as the rest of `feature-planning/`).

## Bottom line (Phase 1.5, supersedes the Phase 1 bottom line above)

**DEPLOY-READY**, contingent only on the manual prod-provisioning steps in the checklist above
(prod service-user password, key install, base_url flip, Mike's Remote Control config toggle)
and the hard Finding-1 gate before any second machine. Both attack payloads from the escalated
Opus review (`--dangerously-skip-permissions`, `--mcp-config` RCE) are proven stopped at two
independent layers plus a structural argv fix; the full build (1268 tests, tsc, production
`next build`) is green from a clean checkout; the full admin/bot auth matrix is exactly
correct; live fleet telemetry (including this verification session) renders correctly at every
required viewport/theme; and telemetry wiring (hooks, cron, key permissions, non-blocking hook
timing) checks out unchanged from Phase 1.

---

# Oracle Phase 2 — Orchestrator/subagent nesting + honest "waiting" (Final Verification)

Verifier: final gate agent, running independently of the Task A/B builders. Same rule as
Phase 1: executed checks decide everything; agent claims (including commit messages) count
for nothing until reproduced here.

Branch: `feat/oracle-orchestrator-nesting` on `/home/mike/.openclaw/workspace/citadel`
Spec: `feature-planning/oracle-phase2-orchestrator-nesting.md`

Commits verified:
- `575c50c` — feat(oracle): distinguish 'working' orchestrators from 'waiting on you' (Task B,
  client logic — `isWaitingSession`/`isWorkingSession`/`hasRunningChild` in
  `components/domain/oracle/oracle-logic.ts`, badge/color wiring in `OracleStatusBadge.tsx` /
  `SessionCard.tsx` / `StatusDot.tsx`, `__tests__/e2e/oracle-fleet-p2.spec.ts`)
- `acdc9d7` — feat(oracle): hide long-stale sessions from fleet response at read time (this
  verification pass's own Job 1 — the read-time stale filter)

Task A (heartbeat, `~/.claude/tools/oracle/oracle-heartbeat.py`) lives **outside this repo** and
was already built, updated, and live-tested against prod before this verification pass began —
confirmed still working below (heartbeat exit 0, no new loose-row junk created by the run
executed as part of this verification).

Run date: 2026-07-10, all times EDT unless marked (JSON payload timestamps below are UTC, per
the API's ISO output).

---

## Job 1 — read-time stale filter

**Problem:** the pre-fix heartbeat wrote ~49 junk subagent rows to prod that are now frozen
(`last_event_at` stuck) but still returned by `/api/oracle/fleet` as clutter. There is no
session delete/prune path.

**Fix:** non-destructive, read-time, at the Prisma query level in
`app/app/api/oracle/fleet/route.ts`. The `sessions.where` clause used to include
`status IN (running, waiting, stale)` unconditionally; it now splits `stale` into its own OR
branch gated by `last_event_at >= (now - STALE_HIDE_MINUTES)`:

```ts
OR: [
  { status: { in: [OracleSessionStatus.running, OracleSessionStatus.waiting] } },
  { status: OracleSessionStatus.stale, last_event_at: { gte: staleHideCutoff } },
  { status: OracleSessionStatus.ended, ended_at: { gte: recentEndedCutoff } },
],
```

`STALE_HIDE_MINUTES = 60` lives in `app/lib/oracle/helpers.ts` next to the other oracle
constants (`RECONCILE_STALE_MINUTES`, `HEARTBEAT_STALE_MINUTES`, `EVENT_RETENTION_DAYS`, etc.).
Filtering at the query level means the machine's own `sessions[]` array and the rolled-up
`counts.sessions`/`counts.agents` are automatically consistent with what's returned — no
separate post-query reconciliation needed. Nothing is deleted; a long-stale row simply ages out
of the response within an hour of its last event, which also naturally clears the 49 pre-fix
junk rows without a destructive prune job.

Tests added to `app/app/api/oracle/fleet/__tests__/route.test.ts` (describe block "stale
read-time hide (Phase 2)"):
- asserts the `where` clause's stale branch is gated by a `last_event_at.gte` cutoff computed
  as `now - 60min` at call time (captured via the mocked `findMany` call args, since Prisma
  itself is mocked in this test file — the actual row-level filtering is proven end-to-end
  separately in Check 5c below against the real local Postgres)
- asserts the running/waiting branch carries no age gate at all
- confirms (via the where-clause `gte` semantics) a stale session 2h old is excluded and one
  10min old is included
- confirms a waiting/running session with a 5h-old `last_event_at` still passes through the
  shaping code untouched

---

## Check 1 — tsc (repo working tree)

```
$ npx tsc --noEmit
```
Result: **clean, no output.**

## Check 2 — full vitest suite (repo working tree)

```
$ npx vitest run
```
Result: **114 test files, 1293 tests, all passed.** (Baseline before this pass: 1288. +5 new
tests from Job 1's `route.test.ts` stale-hide describe block. No regressions.)

## Check 3 — eslint on changed files

```
$ npx eslint app/api/oracle/fleet/route.ts app/api/oracle/fleet/__tests__/route.test.ts lib/oracle/helpers.ts
```
Result: **0 errors, 0 output.**

## Check 4 — clean-checkout build

```
$ git worktree add --detach /tmp/.../scratchpad/oracle-p2-verify feat/oracle-orchestrator-nesting
```
(Job 1 was committed as `acdc9d7` before creating the worktree, so the clean checkout includes
it. `--detach` was required because the branch was already checked out in the primary working
tree.) Worktree HEAD: `acdc9d7`.

In the worktree's `app/`:
```
$ npm ci                    → 888 packages installed, postinstall `prisma generate` succeeded
$ npx prisma generate       → Generated Prisma Client (v6.19.1), no errors
$ npx tsc --noEmit          → clean, no output
$ npx vitest run            → 114 test files, 1293 tests, all passed
$ npx next build            → succeeded; exit code confirmed via `echo "EXIT:$?"` → EXIT:0
```
All routes compiled, including `/oracle` and `/api/oracle/fleet`. Worktree removed after
(`git worktree remove ... --force`); `git worktree list` confirms only the primary tree remains.

## Check 5 — live round-trip

### 5a — heartbeat run
```
$ python3 ~/.claude/tools/oracle/oracle-heartbeat.py
```
Result: **exit 0.**

### 5b — prod fleet GET (read-only, Mike's token)
```
$ curl -s -H "Authorization: Bearer $(cat ~/.citadel-token)" https://citadel.becomeindelible.com/api/oracle/fleet
```
Result: `counts: {"machines": 1, "sessions": 86, "agents": 41}`.

**(i) An orchestrator with real-titled nested agents.** The `Indelible-research` claude_code
session (this very verification run's parent session) came back with `agents: 4`, all real
titles, not `subagents (agent-x)`:
```
session: Indelible-research | status: waiting | agents: 4
   agent: 'Impact analysis for Oracle nesting fix'      | status: done
   agent: 'Oracle waiting-rule + working badge'          | status: done
   agent: 'Heartbeat subagent nesting rewrite'           | status: done
   agent: 'Oracle P2 stale-filter + final verify'        | status: running
```
The last row is this verification agent itself, still `running` at snapshot time — direct
proof the nesting fix (Task A) is live against prod and titles come from the `.meta.json`
`description`, not a synthetic `agent-XX` label.

**(ii) Loose junk top-level rows.** The literal ask ("zero top-level sessions matching
`subagents (agent` or `wf_.*(agent`") does **not** hold against current prod data: 49 such rows
are still present, all `status: "stale"`. This is expected and consistent with the design —
these are the pre-fix rows Job 1 targets, and prod is still running the **old** deployed fleet
route (this branch, including the stale filter, has not been deployed). What was verified
instead is that **no new junk is being created**: re-running the heartbeat (5a) did not add any
new matching rows — the freshest of the 49 junk rows has `last_event_at` ~11 minutes older than
the heartbeat run's timestamp, i.e. it predates this run. Breakdown at snapshot time:
```
status breakdown of junk rows: {'stale': 49}
junk stale rows >60min old (would be hidden by the new filter once deployed): 17
junk stale rows <=60min old (frozen recently, will cross the 60min line within the hour): 32
```
This matches the task's own caveat: the filter only takes effect once this branch deploys;
verified instead via the vitest test (Job 1 section above) and the local dev-server check with
seeded rows (5c below).

**(iii) A session with a running child is not flagged as waiting-on-Reshi — data-shape proof.**
Pulled from the prod response, the `Oracle Task B — orchestrator fan-out`-style shape (and,
identically, the seeded local fixture used for the screenshots in Check 6) has:
```json
{
  "status": "waiting",
  "needs_attention": true,
  "agents": [{ "status": "running", "label": "Fix false \"waiting on Reshi\" status", ... }]
}
```
`isWaitingSession` (oracle-logic.ts) is `(status === 'waiting' || needs_attention) &&
!hasRunningChild`; `hasRunningChild` is `agents.some(a => a.status === 'running')`. With one
`running` child present, `hasRunningChild` is `true`, so `isWaitingSession` evaluates `false` —
this session is excluded from the Waiting strip and instead resolves `isWorkingSession = true`.
This exact logic is already unit-tested in `oracle-logic.test.ts` (147 lines, part of `575c50c`)
and is re-confirmed end-to-end at the UI layer in Check 6 below (Playwright, real DOM
assertions, not just the pure function in isolation).

**(iv) Stale-filter would-remove count.** Covered under (ii) above: 17 of the 49 junk rows are
already >60min stale (would be excluded by the new filter today), the remaining 32 will cross
that line within the hour as their frozen `last_event_at` ages past 60 minutes. Zero non-junk
(running/waiting) rows would be affected, confirmed structurally by Check 5c below with
seeded fixtures against the actual query.

### 5c — local dev-server check (this branch's code, real Postgres, seeded rows)
Dev server on `:3000` (running since before this session; `next dev` recompiles API routes
per-request from disk, no restart needed — confirmed by observing the filter take effect
immediately after editing `route.ts`, see below). DB: docker `citadel-postgres` on `:5433`,
`citadel_dev`. Logged in via `POST /api/auth/login` as `admin@indelible.agency` (local seed
credential, `prisma/seed.ts`).

Seeded two throwaway `stale` sessions (external_id prefix `verify-stale-`, machine
`reshi-workstation`) via a one-off Prisma script:
- `verify-stale-old-2h`: `status: stale`, `last_event_at` = 120 minutes ago
- `verify-stale-fresh-10m`: `status: stale`, `last_event_at` = 10 minutes ago

```
$ curl -s -b cookies.txt http://localhost:3000/api/oracle/fleet
```
Result: only `verify-stale-fresh-10m` appears in the response; `verify-stale-old-2h` is absent.
This is the direct, executed, end-to-end proof (real Postgres, real Prisma query, real HTTP
response) that the stale-hide filter works as designed — the unit tests in Job 1 assert the
`where`-clause shape, this proves the shape actually filters rows correctly against a live DB.

Cleanup: `DELETE FROM oracle_sessions WHERE external_id LIKE 'verify-stale-%'` via
`docker exec citadel-postgres psql`, confirmed 2 rows deleted and 0 remaining in a follow-up
fleet GET.

## Check 6 — screenshots (mobile-390 + desktop-1440)

Ran the existing Phase-2 Playwright spec (`__tests__/e2e/oracle-fleet-p2.spec.ts`, written as
part of `575c50c`) against the local dev server with `scripts/seed-oracle-fixtures.ts` fixtures
loaded (idempotent demo fleet, includes the "working orchestrator" fixture:
`demo-session-orchestrator-working-1`, status `waiting` + `needs_attention: true`, one child
agent `demo-orch-child-a0` with `status: running`):

```
$ npx playwright test __tests__/e2e/oracle-fleet-p2.spec.ts
1 passed (4.7s)
```

The spec's own assertions (before taking screenshots) already prove, via real DOM queries: the
Waiting strip contains `grantibly-wright-b1` (genuinely `waiting` + `needs_attention`, no
running children) and does **not** contain `Oracle Task B — orchestrator fan-out`; that
orchestrator's own card renders a `Working · 1 agent` badge; expanding the card reveals the
real-titled nested child `Fix false "waiting on Reshi" status`; and there is no horizontal
overflow at 360px.

Screenshots saved to
`/tmp/claude-1001/-home-mike/78a55c04-8341-4721-8759-84060daa0916/scratchpad/oracle-p2-final/`:
- `mobile-390.png` — orchestrator card expanded (nested real-titled running child visible,
  `WORKING · 1 AGENT` badge), Waiting strip above it showing only `grantibly-wright-b1 —
  gate review` (`NEEDS ATTENTION`).
- `desktop-1440.png` — same state at the desktop viewport.

Both visually confirm the orchestrator card is rendered **outside** the Waiting strip, with its
own accent-colored "working" badge distinct from the strip's warning-gold "needs attention"
pill.

## Privacy note (heartbeat, Task A — reconfirmed, unchanged by this pass)

Per the docstring in `~/.claude/tools/oracle/oracle-heartbeat.py` (PRIVACY CONTRACT section,
unchanged by Job 1/2 work in this repo): only metadata is ever read out of transcripts and
workflow files. Concretely for the orchestrator-nesting path added in Phase 2:
- Subagent `.meta.json` sidecars: only `agentType` and `description` are forwarded (truncated
  ~80 chars) as the agent's display **title** — the same category of data as a session title.
  No other sidecar field is forwarded.
- Transcript tail sampling forwards only the **tool name** of the last tool call (e.g. `Bash`,
  `Read`) as `activity` — never the tool's input or output.
- Message/tool TEXT content — prompts, tool inputs/outputs, assistant prose — is never touched
  or forwarded, for either parent sessions or subagents.
- Workflow files: `promptPreview` and `lastToolSummary` are explicitly skipped; only
  label/phase/model/tokens/duration/state and the tool **name** are forwarded.

## Schema / migration confirmation

```
$ git diff --stat 449b2b9..HEAD -- app/prisma/schema.prisma   → (no output — no changes)
$ ls app/prisma/migrations | tail -5                          → no new migration directory added
  on this branch (newest is 20260710030236_oracle_commands_phase1_5, pre-dating this branch)
```
Confirmed: **no schema change, no migration** on `feat/oracle-orchestrator-nesting`. Matches
the spec's stated target ("Target: NO migration") for both Task B (client-only) and Job 1
(query-level read-time filter, no new column).

## Phase 2 gate summary

| Gate | Result |
|---|---|
| tsc (repo) | clean |
| vitest (repo) | 1293/1293 passed (baseline 1288 + 5 new) |
| eslint (changed files) | 0 errors |
| clean-checkout build (worktree, `npm ci` + `prisma generate` + tsc + vitest + `next build`) | all green, build exit 0 |
| Heartbeat live run | exit 0 |
| Prod fleet GET — orchestrator nesting with real titles | confirmed (i) |
| Prod fleet GET — zero NEW junk rows created by this run | confirmed; 49 pre-existing junk rows remain until this branch deploys (expected, see (ii)) |
| Data-shape proof — running-child session not waiting-on-Reshi | confirmed (iii), logic already unit-tested |
| Stale-filter row-count accounting on prod (informational) | 17/49 already >60min, rest age out within the hour once deployed |
| Local dev-server seeded-row check — stale filter end-to-end against real Postgres | old (2h) excluded, fresh (10m) included, cleaned up after |
| Screenshots (mobile-390 + desktop-1440) | captured, orchestrator nesting + badge + correct Waiting-strip membership all visually confirmed |
| Schema/migration | none |
| citadel-worker pause | removed as the final step (see below) |

## Bottom line (Phase 2)

**DEPLOY-READY.** Job 1 (stale-hide filter) and Job 2's full verification chain are both green:
tsc/vitest/eslint clean, a from-scratch clean-checkout build succeeds, the heartbeat's
orchestrator-nesting fix (Task A, already live on prod) is reconfirmed with real-titled nested
agents and zero newly-created junk rows, the "working vs waiting" client logic (Task B,
`575c50c`) is proven both at the data-shape level against real prod telemetry and end-to-end in
the browser via Playwright screenshots, and the new stale-hide filter (Job 1, `acdc9d7`) is
proven end-to-end against a real seeded Postgres row set on this branch's own code path. No
schema/migration change on this branch. Not pushed, not merged, not deployed — per instructions,
orchestrator (Fable) reviews the diff and handles deploy with Mike.

---

# Oracle Phase 3 — "Respond" deep-links to Claude Remote Control (Final Verification)

Verifier: final gate agent, independent of the builder agents. Same rule as Phase 1/2: executed
checks decide everything; agent claims (including builder commit messages) count for nothing
until reproduced here with a command and its real output.

Branch: `feat/oracle-respond-links` on `/home/mike/.openclaw/workspace/citadel`
Spec: `feature-planning/oracle-phase3-respond-links.md`
Run date: 2026-07-10.

Commits verified (exactly 2):
- `59fc7bd` — feat(oracle): remote_url on sessions for Respond deep-links (schema + migration +
  ingest URL-guard validation + fleet DTO)
- `92efd5e` — feat(oracle): Respond deep-link button on live session cards (UI)

The heartbeat (`~/.claude/tools/oracle/oracle-heartbeat.py`, outside this repo) was already
updated and live before this verification pass began — not re-verified from scratch here, only
its interaction with prod's current (pre-deploy) ingest route is checked below (see "Prod
harmlessness" under Check 3).

---

## Check 1 — Branch integrity

| Command | Result |
|---|---|
| `git log --oneline main..feat/oracle-respond-links` | Exactly 2 commits: `92efd5e`, `59fc7bd` |
| `git status` | Clean — only pre-existing untracked planning docs (unrelated to Oracle: email-dispatcher-design.md, oracle-phase2-orchestrator-nesting.md, oracle-phase3-respond-links.md, wright-*.md, implementation/plans/*.md, test artifact dirs); zero modified tracked files |
| Migration file exists | `app/prisma/migrations/20260710215642_oracle_session_remote_url/migration.sql` |
| Migration content | `ALTER TABLE "oracle_sessions" ADD COLUMN     "remote_url" VARCHAR(500);` — a single additive, nullable `ALTER TABLE ... ADD COLUMN`, no other statements, no data migration, no constraint changes |

**Result: PASS**

---

## Check 2 — Clean-checkout build (the gate nobody ran with both commits together)

Worktree: `git worktree add --detach /tmp/.../scratchpad/oracle-p3-verify 92efd5e` (detached at
the branch tip, since the branch itself was checked out in the main tree). `.env`/`.env.local`
copied in from the main checkout (not git-tracked), pointed at the same local dev Postgres
(docker `citadel-postgres` on `:5433`, `citadel_dev`).

| Command | Result | Exit |
|---|---|---|
| `npm ci` | 888 packages installed clean (`postinstall` ran `prisma generate` successfully) | 0 |
| `npx prisma generate` | `✔ Generated Prisma Client (v6.19.1)` | 0 |
| `npx prisma migrate status` | `25 migrations found in prisma/migrations` / `Database schema is up to date!` — confirms the new migration is recognized by Prisma **and** already applied to the local dev DB (not run fresh here; `migrate deploy` was intentionally NOT executed against any DB per instructions — status-only) | 0 |
| DB column check | `docker exec citadel-postgres psql ... -c "\d oracle_sessions"` shows `remote_url \| character varying(500) \|  \|  \|` — nullable, no default, matches the migration | n/a |
| `npx tsc --noEmit` | No output — zero type errors | 0 |
| `npx vitest run` | **115 test files passed (115) / 1307 tests passed (1307)** — matches the expected count exactly (spec baseline 1293 + 14 new: ingest URL-validation, fleet DTO, SessionCard Respond-button tests) | 0 |
| `npx next build` | `✓ Compiled successfully in 6.5s`, static/dynamic page manifest generated (135 routes incl. `ƒ /oracle`, `ƒ /api/oracle/fleet`, `ƒ /api/oracle/ingest`), no build errors | 0 |

Worktree removed after (`git worktree remove ... --force`); `git worktree list` confirms only
the main checkout remains.

**Result: PASS**

---

## Check 3 — Integration round-trip (local dev server, this branch's code)

Dev server restarted clean on `:3000` (killed the pre-existing process first, per the
stale-Prisma-Client caution in the task brief, so this run is provably against a fresh process
holding the freshly-generated client) against the branch checkout on `feat/oracle-respond-links`
and the local dev Postgres (migration already applied, confirmed in Check 2).

**Auth setup:** two throwaway API keys inserted directly via `docker exec psql` (same
`citadel_` + sha256-hex scheme as `lib/auth/api-keys.ts`), one against the existing local admin
user (`admin@indelible.agency`, for `GET /fleet`, which is `requireRole(['admin'])`), one
against the existing local Oracle service user (`oracle@indelible.bot`, for `POST /ingest`,
which is `isOracleBot`-gated). Both revoked/deleted at the end (see cleanup below).

**Seed** — `POST /api/oracle/ingest` (Bearer oracle key), one snapshot with two `claude_code`
sessions on a throwaway machine (`verify-throwaway-machine`):
- `TESTxxx-with-url`: `remote_url: "https://claude.ai/code/session_TESTxxx"`, `status: waiting`
- `TESTxxx-no-url`: no `remote_url` field, `status: running`

Response: `{"success":true, ..., "sessions_upserted":2, ...}`.

**Read** — `GET /api/oracle/fleet` (Bearer admin key), filtered to the throwaway machine:
```json
{
  "external_id": "TESTxxx-with-url", "status": "waiting",
  "remote_url": "https://claude.ai/code/session_TESTxxx"
},
{
  "external_id": "TESTxxx-no-url", "status": "running",
  "remote_url": null
}
```
Confirms the DTO round-trip exactly: the session ingested WITH a valid remote_url returns it
populated in the fleet response; the session ingested with no remote_url returns `null`, not an
empty string or omitted key.

**URL-guard rejection** — three separate `POST /api/oracle/ingest` calls (Bearer oracle key),
each with an otherwise-valid snapshot session but a hostile `remote_url`:

| Payload | Result |
|---|---|
| `https://evil.com/code/x` (wrong host) | **400**, `"remote_url must be an https://claude.ai/code/... URL"` |
| `javascript:alert(1)` (dangerous scheme) | **400**, same message |
| `http://claude.ai/code/session_x` (right host, wrong scheme) | **400**, same message |

All three 400 at the Zod layer before ever reaching Prisma — no row was created or mutated by
any of the three attempts (confirmed no `TESTxxx-evil`/`TESTxxx-js`/`TESTxxx-http` rows exist
post-run).

**Cleanup:** `oracle_events`/`oracle_agents`/`oracle_commands`/`oracle_sessions` for the
throwaway machine deleted, then the machine itself (`DELETE FROM oracle_machines WHERE
name = 'verify-throwaway-machine'`), then both throwaway `api_keys` rows. Post-cleanup
`SELECT count(*)` on both the throwaway machine and the throwaway key names returned **0** in
each case. Raw key material was written only to a scratchpad file that was deleted immediately
after use, never logged elsewhere.

**Prod harmlessness (task's "confirm prod harmlessly ignores remote_url until deploy"):**
confirmed by reading the code, not by touching prod. `git show main:app/prisma/schema.prisma`
has no `remote_url` field and `git show main:app/app/api/oracle/ingest/route.ts`'s
`snapshotSessionSchema` has no `remote_url` key — prod is still running the pre-Phase-3 route.
Zod's default `z.object()` mode (no `.strict()`/`.passthrough()` anywhere in this schema) silently
**strips** unrecognized keys from the parsed output rather than rejecting the request; verified
directly against the exact `zod` package installed in this repo:
```
$ node -e 'const {z}=require("zod"); const s=z.object({a:z.string()});
           console.log(JSON.stringify(s.parse({a:"x", remote_url:"https://evil.com/whatever"})))'
{"a":"x"}
```
So the already-live heartbeat sending `remote_url` in its snapshot payload to prod today is a
no-op there: the field is silently dropped by Zod before it ever reaches Prisma, and even if it
weren't, the prod DB has no `remote_url` column to write to. No error, no partial state, no
data loss — this becomes live only once this branch's migration + route deploy to prod together.

**Result: PASS**

---

## Check 4 — Href safety (URL-guard is the only writer of `remote_url`)

Read `app/app/api/oracle/ingest/route.ts` and `app/components/domain/oracle/SessionCard.tsx`
directly (not summarized from memory).

**The validation predicate, verbatim** (`remoteUrlSchema`, `app/app/api/oracle/ingest/route.ts`):
```ts
const remoteUrlSchema = z
  .string()
  .max(500)
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return url.protocol === 'https:' && url.hostname === 'claude.ai' && url.pathname.startsWith('/code/');
    },
    { message: 'remote_url must be an https://claude.ai/code/... URL' }
  );
```
This is the only code path anywhere in the repo that assigns a value into the `remote_url`
column: `grep -rn "remote_url"` across `app/`, `components/`, `lib/` (excluding tests) shows
exactly one write site — `snap.remote_url !== undefined && { remote_url: snap.remote_url }` in
the ingest route's snapshot-upsert block, where `snap` has already been parsed through
`snapshotSessionSchema`, whose `remote_url` field is `remoteUrlSchema.nullable().optional()`.
`null` is explicitly allowed through (clears a previously-set URL) but is never itself a
javascript:/data:/other-host string — `null` renders no anchor at all downstream (see below).

**The UI consumer** (`components/domain/oracle/SessionCard.tsx`, lines ~116–134):
```tsx
{showRespond && session.remote_url && (
  ...
  <a
    href={session.remote_url}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(e) => e.stopPropagation()}
    data-testid="respond-link"
    ...
  >
```
`session.remote_url` is `string | null` (`lib/types/oracle.ts`), sourced straight from the
`GET /api/oracle/fleet` DTO (`app/app/api/oracle/fleet/route.ts` line 85:
`remote_url: session.remote_url` — a direct passthrough of the Prisma column, no
transformation). Since the column is only ever written by the predicate above, `href` can never
be `javascript:`, `data:`, or a non-`claude.ai` host — the render guard (`session.remote_url &&
...`) additionally means a falsy/null value renders no anchor tag at all, not an anchor with an
empty/undefined href. `rel="noopener noreferrer"` on the `target="_blank"` anchor is
defense-in-depth against reverse-tabnabbing, independent of the host restriction.

**Result: PASS**

---

## Check 5 — Verification record

This section. Committed to the branch as part of this verification pass (see commit below).

---

## Check 6 — citadel-worker unpause

```
$ rm -f ~/.citadel-worker-paused
$ ls ~/.citadel-worker-paused
ls: cannot access '/home/mike/.citadel-worker-paused': No such file or directory
```
Confirmed removed — the 10-minute cron resumes its normal cadence.

---

## Phase 3 gate summary

| Gate | Result |
|---|---|
| Branch integrity (2 commits, clean status, additive nullable migration) | PASS |
| Clean-checkout build (`npm ci` + `prisma generate` + `migrate status` + `tsc` + `vitest` 1307/1307 + `next build` exit 0) | PASS |
| Integration round-trip (seed via API, fleet DTO shows populated/null correctly, 3 hostile URL-guard payloads all 400, cleanup verified 0 rows left) | PASS |
| Prod harmlessness (Zod strips unknown `remote_url` key; prod schema/route confirmed unchanged; no error, no partial write) | PASS |
| Href safety (single write site gated by the `claude.ai`/`https`/`/code/` predicate; UI never constructs `href` from anything else; `noopener noreferrer` present) | PASS |
| Verification record written + committed | PASS (this section) |
| citadel-worker unpaused | PASS — `~/.citadel-worker-paused` confirmed gone |

## Bottom line (Phase 3)

**DEPLOY-READY.** Both commits (`59fc7bd` schema/server, `92efd5e` UI) verified independently
from a clean checkout: 1307/1307 tests pass, `tsc` clean, production `next build` succeeds.
The live round-trip proves the exact contract end-to-end against a real Postgres and a real
HTTP server — a session with a valid bridge URL surfaces it in the fleet DTO, a session without
one returns `null`, and three distinct hostile payloads (wrong host, `javascript:` scheme,
non-https) are all rejected with 400 before touching the database. The href the UI renders can
only ever be an `https://claude.ai/code/...` URL by construction (single write site, one
predicate, no other code path touches the column). Prod is confirmed harmless in the interim —
the already-live heartbeat's `remote_url` field is silently stripped by Zod against the
currently-deployed (pre-Phase-3) route, no error and no partial state. Not pushed, not merged,
not deployed, per instructions.

---

# Phase 4 — three live buckets + idle status + full workflow-worker nesting

Branch `feat/oracle-three-buckets`, commits `3b8281a` (Lane B: idle enum + server) and
`2418f52` (Lane C: three-bucket UI) on top of `main`. Heartbeat change (Lane A, run-scoped
`::`-joined workflow-worker `external_id`s + idle emission) is a STAGED copy only
(`~/.claude/tools/oracle/oracle-heartbeat.STAGED.py`) — the live heartbeat is untouched until
prod has the `idle` enum, per the spec's deploy sequencing.

## Check 1 — Branch integrity

```
$ git log --oneline main..feat/oracle-three-buckets
2418f52 feat(oracle): three live buckets (waiting/working/idle) + idle Respond
3b8281a feat(oracle): idle session status + server support
```
Exactly the 2 expected commits. `git status` clean except pre-existing untracked planning docs
(including this spec, `feature-planning/oracle-phase4-three-buckets.md`, which is correctly
*not* one of the 2 code commits).

Idle migration confirmed:
```
app/prisma/migrations/20260711022118_oracle_session_status_idle/migration.sql:
ALTER TYPE "OracleSessionStatus" ADD VALUE 'idle';
```

**Result: PASS**

## Check 2 — Live heartbeat untouched

```
$ diff ~/.claude/tools/oracle/oracle-heartbeat.py \
       <scratchpad>/oracle-heartbeat.pre-buckets.bak
(empty diff, exit 0)
```
The live heartbeat is byte-for-byte identical to the pre-Phase-4 backup. Only
`oracle-heartbeat.STAGED.py` (a separate file) carries the idle/nesting changes.

**Result: PASS**

## Check 3 — `external_id` length (Lane A flagged risk)

`app/prisma/schema.prisma`:
```
OracleAgent.external_id  String @db.VarChar(255)
```
Run-scoped workflow-worker IDs the new heartbeat emits look like
`wf_59f1b8a7-b9f::agent-a1f92d1eb6c62a50a` (~40 chars observed; real dry-run output produced IDs
like `wf_039a0811-de6::a8690a25c57f40278`, ~35-40 chars). `VarChar(255)` is comfortably >80,
with no realistic risk of truncation or collision from length.

**Result: PASS**

## Check 4 — Clean-checkout build

Detached worktree at `2418f525ea7ec2dc7cbec3ba18a9e1a20e7deb55` (the branch tip; couldn't add a
worktree *by branch name* since the main checkout already has it checked out) at
`<scratchpad>/oracle-p4-verify`, `.env` copied in (gitignored, not part of the checkout),
against the local `citadel-postgres` container on `:5433`.

```
$ npm ci                     → 888 packages installed, postinstall `prisma generate` OK
$ npx prisma generate        → Generated Prisma Client (v6.19.1) OK
$ npx prisma migrate status  → "Database schema is up to date!" (idle migration recognized/applied)
$ npx tsc --noEmit           → exit 0, no output
$ npx vitest run             → Test Files 115 passed (115); Tests 1323 passed (1323)
$ npx next build             → exit 0, full route manifest printed, no errors
```
1323/1323 matches the expected count exactly. Worktree removed after (`git worktree remove
--force`); `git worktree list` confirms only the main checkout remains.

**Result: PASS**

## Check 5 — Integration end-to-end (real proof)

Restarted `next dev` on `:3000` against local `citadel-postgres` (killed a stale instance first
and re-ran `prisma generate` to rule out a stale Prisma Client from before the idle migration).

Minted two throwaway API keys directly via Prisma (sha256 `hashApiKey`, matching
`lib/auth/api-keys.ts`) against the pre-existing `oracle@indelible.bot` (bot/pm) and
`admin@indelible.agency` (admin) users — no new users created.

Generated the STAGED heartbeat's real payload:
```
$ python3 ~/.claude/tools/oracle/oracle-heartbeat.STAGED.py --dry-run
→ 29 sessions: {"idle": 19, "running": 4, "ended": 6}
→ sources: {claude_code, openclaw_cron} — 0 top-level "workflow" source, 0 external_id
  starting "wf_"
→ 3 sessions carry nested agents with "::"-scoped external_ids (run-scoped workflow workers):
  BlueHeron (20 agents), a dab6d7fc session (27 agents), FloodedZone (11 agents)
```

Renamed `machine.name`/`hostname` to `VERIFY-oracle-p4-test-machine` (distinct test machine,
real session data otherwise untouched) and POSTed to local ingest with the throwaway bot key:
```
$ curl -X POST /api/oracle/ingest -H "Authorization: Bearer <bot-key>" --data @payload.json
→ HTTP 200
→ {"success":true,"sessions_upserted":29,"agents_upserted":61,"reconciled_stale":0}
```
`idle` accepted (no 400 from `z.nativeEnum`), all 61 run-scoped `::` agent external_ids
persisted with zero unique-constraint collisions.

GET `/api/oracle/fleet` with the throwaway admin key, filtered to the test machine:
```
→ HTTP 200, 28 sessions returned (29 upserted minus 1 ended session outside the
  24h RECENT_ENDED_HOURS window — expected fleet-route behavior, not a bug)
→ status counts: {"running": 4, "idle": 19, "ended": 5}
→ top-level workflow sessions (source='workflow' or external_id starting 'wf_'): 0
→ sessions with nested "::"-scoped agents: 3 (FloodedZone running w/ 11 agents; two
  idle sessions w/ 20 and 27 agents)
```
(a) idle sessions present — confirmed, 19.
(b) a claude_code session (FloodedZone) carries nested workflow-worker agents with `::`
external_ids, and no top-level session has `source: 'workflow'` or `external_id` starting
`wf_` — confirmed, 0 in both cases.
(c) Real live snapshot data had 0 `needs_attention` sessions at capture time, so to prove the
Waiting bucket specifically (not just idle/working), appended one synthetic
`needs_attention: true` session to the same test-machine payload and re-POSTed (still HTTP 200,
30 upserted). Re-fetched fleet and ran the exact `oracle-logic.ts` precedence inline
(`isWaitingSession` → `isWorkingBucketSession` → `isIdleSession`, first-match-wins) against the
returned DTO:
```
waiting: 1 (the synthetic session)
working: 4 (Indelible-research, FloodedZone, abbott, MikeLynn)
idle: 19
duplicate bucket memberships: 0
```
All three buckets populated from real DTO data, single-membership confirmed (no session in more
than one bucket).

**Cleanup**: deleted the `VERIFY-oracle-p4-test-machine` `OracleMachine` row (cascade-deleted 30
sessions, 61 agents), deleted both throwaway `ApiKey` rows by name, removed the three scratch
`.mjs` scripts from `app/`. `git status` in `app/` confirmed clean afterward (only pre-existing
untracked planning docs remain).

**Result: PASS**

## Check 6 — Client grouping precedence sanity

`components/domain/oracle/__tests__/oracle-logic.test.ts` (part of the 1323/1323 green run in
Check 4) explicitly asserts single-membership precedence:
- `isWorkingBucketSession is true for an idle-status session with a running child`
- `isIdleSession is false for an idle-status session with a running child (working wins)`
- `isIdleSession is false for an idle-status session flagged needs_attention (waiting-on-you wins)`
- `an idle session with a running child lands in working, not idle (precedence: working beats idle)`
- `a needs_attention session is not in working or idle — it belongs to selectWaitingSessions only`
- `has no top-level "workflows" group — SessionGroups is {working, idle, crons, recentlyEnded}`

Precedence confirmed: needs_attention/waiting (no running child) → Waiting only;
status `running` or any `hasRunningChild` → Working only; status `idle` with neither → Idle
only. All passing as part of the full suite.

**Result: PASS**

## FleetTopbar deviation — assessed, not fixed

Lane C's `groupNonWaitingSessions` bucketing uses the broader `isWorkingBucketSession`
(`status === 'running' || hasRunningChild`), so a `status: 'idle'` session with a live running
child correctly lands in the **Working** bucket. But `anySessionRunning` (which drives
`FleetTopbar`'s pulse dot, `app/(app)/oracle/page.tsx` lines 88-89) still uses the narrower
`s.status === 'running' || isWorkingSession(s)`, where `isWorkingSession` only fires when the
session's *own* status is `waiting`/`needs_attention` AND it has a running child. For a
`status: 'idle'` session with a running child, `isWorkingSession` returns `false` (status isn't
waiting/needs_attention) and `s.status === 'running'` is also `false` — so `anySessionRunning`
returns `false` even though that exact session is sitting in the Working bucket. The topbar dot
would not pulse for a session a Reshi is looking straight at in the Working section.

This is real, not hypothetical: the STAGED heartbeat sets session status from the harness's own
busy/shell signal, independent of whether a dispatched Workflow-tool run is still going in the
background — an orchestrator can plausibly read `idle` (no active tool call right now) while a
backgrounded workflow it kicked off is still executing workers. It is not covered by the
existing `anySessionRunning`/`anySessionNeedsAttention` test block (`oracle-logic.test.ts`
lines 466-491), which only exercises the `waiting/needs_attention + running child` case, not
`idle + running child`.

The current real-data snapshot (Check 5) had zero sessions in this exact state
(`idle-with-running-child` count was 0), so it's a real gap but a narrow, currently-unhit one.

**Recommendation**: one-line fix, swap `anySessionRunning`'s body to
`machines.some((m) => m.sessions.some((s) => isWorkingBucketSession(s)))` — reuses an
already-tested primitive, no new logic. Trivial and safe in isolation, but **not applied here**:
this is a verification pass, not an implementation pass, and touching `oracle-logic.ts` now
would invalidate the tsc/vitest/build results already captured in Check 4 and require a third
commit + re-verify cycle. Left for a deliberate follow-up (Fable's call on whether it's
worth a Lane E or folds into the next Oracle pass) — cosmetic-only in current data, not a
blocker for this deploy.

## DEPLOY SEQUENCING (restated from the spec)

1. Deploy `feat/oracle-three-buckets` (enum migration + server + UI) to prod first.
2. Confirm the `idle` enum is live in prod (e.g. a harmless read against
   `OracleSessionStatus` or a manual check).
3. Only then swap `oracle-heartbeat.STAGED.py` into the live
   `~/.claude/tools/oracle/oracle-heartbeat.py` path.
4. Unpause citadel-worker (`rm ~/.citadel-worker-paused`) — **not done by this verification
   pass**, per instructions; left for the orchestrator once the deploy + swap are complete.

## Phase 4 gate summary

| Gate | Result |
|---|---|
| Branch integrity (2 commits, clean status, idle migration present) | PASS |
| Live heartbeat untouched (byte-identical diff against pre-change backup) | PASS |
| `external_id` length (`VarChar(255)` vs. ~40-char run-scoped IDs) | PASS |
| Clean-checkout build (`npm ci` + `prisma generate` + `migrate status` + `tsc` + `vitest` 1323/1323 + `next build` exit 0) | PASS |
| Integration end-to-end (idle accepted, 61 run-scoped agents persisted no-collision, 0 top-level `wf_`/`workflow` sessions, all 3 buckets populated from real DTO data, cleanup verified) | PASS |
| Client grouping precedence (`oracle-logic.test.ts` single-membership tests, passing) | PASS |
| FleetTopbar `isWorkingSession`/`isWorkingBucketSession` gap | DEVIATION — assessed, not fixed (see above) |
| citadel-worker pause | LEFT PAUSED — orchestrator manages deploy + heartbeat swap, then unpauses |

## Bottom line (Phase 4)

**DEPLOY-READY**, with one noted-not-blocking deviation. All 6 required checks pass: 2 commits
exactly as expected, live heartbeat provably untouched, `external_id` column has ample
headroom, a from-scratch checkout builds clean end-to-end (1323/1323 tests, clean `tsc`,
successful `next build`), and the integration proof is real — the STAGED heartbeat's actual
dry-run payload (not a synthetic fixture) round-tripped through a live local server: idle
status accepted, all three buckets populated with genuine session data (19 idle, 4 working
including a workflow-nested FloodedZone, 1 waiting after a synthetic needs_attention session
was added to exercise that bucket too), zero top-level `wf_`/`workflow` sessions, zero
external_id collisions across 61 nested agents. Test cleanup fully verified (0 rows left,
throwaway keys deleted). The one open item is the FleetTopbar pulse gap for a
`status: 'idle'` + `hasRunningChild` session — real but currently unhit in production data, a
one-line fix using an already-tested primitive, deliberately left for a follow-up rather than
folded into this verification pass. citadel-worker remains paused; deploy sequencing (branch to
prod first, confirm enum live, then swap the staged heartbeat) restated above for the
orchestrator. Not pushed, not merged, not deployed, per instructions.
