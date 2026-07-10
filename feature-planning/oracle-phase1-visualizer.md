# Oracle — Phase 1: Fleet Visualizer (spec)

Date: 2026-07-09. Author: Bast (planning pass, Fable high). Status: APPROVED by Mike
2026-07-09 (with ruling: Ringer layout, Citadel coloring, theme-reactive). Building.

## Goal

A new top-level Citadel section, **Oracle**, that visualizes every agent running on the
workstation: Claude Code sessions, Workflow fan-out swarms (with per-worker detail), and
openclaw crons. Read-only in Phase 1. Zero LLM tokens spent on telemetry: everything is
shell + HTTP pushing structured events; no model ever summarizes state.

Explicitly OUT of scope for Phase 1 (agreed with Mike 2026-07-09):
- No reply/steer channel (Claude Code Remote Control covers per-session steering).
- No spawn-from-Citadel (candidate Phase 2, pending Remote Control server-mode test).
- No prod deploy without Mike's explicit approval. Build lands on a feature branch,
  verified against local dev DB.

## Visual direction (Mike's ruling 2026-07-09: Ringer LAYOUT, Citadel COLORING)

Reference for layout/structure: Ringside mission control, vendored at
`feature-planning/reference/ringside-dashboard.html` (+ `ringside-run-detail.png`).
Original: dashboard/dashboard.html in github.com/NateBJones-Projects/ringer.

**Layout to match (desktop):** topbar (status dot + headline + subtitle + "N sessions ·
M agents" counts + live clock), toolbar (filter input, collapse-all), main grid of run
cards. Each run card: header (status dot, name, identity, elapsed, token burn) + task
rows (name, status, activity line, elapsed, tokens, child count) + click-to-open drawer
showing recent event log. Density: compact, mono numerics, hairline borders.

**Coloring: Citadel's existing theme system, NOT Ringside's palette.** Use the house
CSS-variable tokens (`bg-surface`, `text-text-main`, `border-border-warm`, `--accent`,
`--success-subtle` etc. per globals.css) so Oracle is light in light theme, dim in dim,
dark in dark — exactly like every other section. Do not hardcode Ringside hex values.
Ringside's cyan/amber/green/red status trio maps onto Citadel semantics:
running = accent (desaturated blue), waiting / needs_attention = warning (muted gold —
house rule: warning is never red), done/ended = success (muted green), failed = error
(muted red), stale = muted gray. Status colors must come from the theme variables so
they stay correct across all three themes. Mono numerics via the ui-monospace stack is
a layout/typography choice and carries over; base text stays Inter.

**Mobile (primary optimization target):** same visual language, different layout.
Single-column card stack. Pinned **"Waiting on Reshi"** section at top (sessions with
status `waiting` or `needs_attention`, ordered by wait time desc), then Running, then
collapsed groups for Workflows / Crons / Recently ended. Tap a card to expand its
detail drawer inline (no navigation). Tap targets >= 44px. No horizontal scroll at
360px width.

## Data model (Prisma — follow house conventions exactly: uuid @db.Uuid PKs,
snake_case columns, @@map plural snake tables, created_at/updated_at, is_deleted
where user-facing)

```
OracleMachine  @@map("oracle_machines")
  id, name (unique, e.g. "reshi-workstation"), hostname,
  last_heartbeat_at DateTime?, created_at, updated_at

OracleSession  @@map("oracle_sessions")
  id, machine_id FK, external_id String (harness session uuid / wf run id / cron id),
  source  OracleSource (claude_code | workflow | openclaw_cron)
  title String?           // best-available: harness session title, else cwd basename + short id
  cwd String?
  model String?
  status OracleSessionStatus (running | waiting | ended | stale)
  needs_attention Boolean @default(false)   // Notification hook fired
  attention_reason String?
  started_at, last_event_at, ended_at DateTime?
  tokens_total Int @default(0)              // MINUTES convention does not apply; raw token count
  meta Json?
  @@unique([machine_id, source, external_id])

OracleAgent  @@map("oracle_agents")        // workflow workers / subagents under a session
  id, session_id FK, external_id String (agent id / label),
  label, phase String?, model String?, status String (running|done|failed|queued),
  activity String?, tokens Int @default(0), duration_ms Int?,
  started_at, ended_at DateTime?, created_at, updated_at
  @@unique([session_id, external_id])

OracleEvent  @@map("oracle_events")        // append-only audit/debug tail, powers the drawer
  id, session_id FK?, machine_id FK, kind String, payload Json, ts DateTime, created_at
  index on (machine_id, ts); prune > 7 days opportunistically inside ingest handler
```

## API (all routes follow requireAuth -> requireRole -> Zod -> handleApiError;
registry entries in NEW lib/api/registry/oracle.ts wired into registry/index.ts —
hard requirement per instructions/api-routes.md)

- `POST /api/oracle/ingest` — machine client only. Auth: Bearer ApiKey of a seeded
  service user `oracle@indelible.bot` (mirror TROUBADOR_SERVICE_EMAIL + isTroubadorBot
  helper: `ORACLE_SERVICE_EMAIL`, `isOracleBot(auth)`); reject non-bot callers.
  Body: `{ machine, sent_at, events?: OracleEventIn[], snapshot?: Snapshot }`.
  - `events[]`: `{ kind, external_id, source, ts, session fields..., payload }` from hooks.
  - `snapshot`: heartbeat's authoritative state: running claude processes + active
    transcripts, workflow wf_*.json progress (per-agent label/phase/model/tokens/
    duration/status), openclaw cron list. Server upserts sessions/agents from snapshot
    and RECONCILES: any session it previously had as running/waiting that is absent
    from the snapshot and older than 5 min -> `stale`; heartbeat gap > 3 min -> whole
    machine banner "telemetry stale since HH:MM" (derived at read time from
    last_heartbeat_at, not a status write).
  - Zod-validate deeply; cap events per call (e.g. 500) and payload sizes; unknown
    kinds accepted into OracleEvent but never crash ingest.
- `GET /api/oracle/fleet` — session auth (PM/Admin). Returns machines + sessions
  (with agents) grouped for the page, plus derived staleness. Single call, shaped for
  the UI; no N+1 from the client.
- Status semantics (server-derived, honest and cheap):
  - `running`: UserPromptSubmit seen after last Stop.
  - `waiting`: Stop fired (turn ended, ball in Reshi's court). `needs_attention` set
    by Notification hook events (cleared on next UserPromptSubmit).
  - `ended`: SessionEnd. `stale`: reconciliation above.

## Local telemetry (this machine, ~/.claude/tools/oracle/)

1. `oracle-event.py` — hook handler. Reads Claude Code hook JSON on stdin
   (session_id, cwd, hook_event_name...), maps to an ingest event, POSTs with a 3s
   timeout, ALWAYS exits 0, never blocks a turn (fire-and-forget; on failure append to
   a small local spool `~/.oracle-spool.jsonl`, which heartbeat drains). Wire into
   ~/.claude/settings.json hooks: SessionStart, UserPromptSubmit, Stop, SubagentStop,
   SessionEnd, Notification. PRESERVE the existing model-ledger Stop hook (append to
   the array, do not replace).
2. `oracle-heartbeat.py` — cron every minute (crontab entry). Gathers: running
   `claude` processes; transcripts under ~/.claude/projects/ modified in last 10 min
   (title from harness session index if available, else cwd basename); in-flight +
   recently-finished `workflows/wf_*.json` (reuse the model-ledger read pattern:
   workflowProgress[] carries label/phase/model/tokens/durationMs per agent);
   `openclaw cron list --json`. Drains the spool. POSTs one snapshot. Cheap, silent,
   exits 0 always; log errors to ~/.oracle-heartbeat.log (rotate/truncate at 1MB).
3. Key: `~/.citadel-oracle-key` (created when the service user is seeded; local dev
   key first, prod key minted at deploy time WITH Mike). Never committed anywhere.

Token cost of all of the above: zero. It is python + curl-equivalent HTTP.

## UI build notes

- Routes: `app/app/(app)/oracle/page.tsx` (fleet view only in Phase 1; drawer instead
  of detail pages).
- Nav: add literal `oracleSection` (emoji 🔮, gated `isPmOrAdmin`) to BOTH
  `components/layout/Sidebar.tsx` and `components/layout/MobileNav.tsx` (they duplicate
  nav literals; update in lockstep).
- Data: TanStack Query, `refetchInterval: 30_000`, `refetchIntervalInBackground: false`
  (house precedent: use-dashboard.ts). This is the presence gating: hidden tab = no
  polling.
- Components under `components/domain/oracle/`: `FleetTopbar`, `SessionCard`,
  `AgentRow`, `StatusDot`/`OracleStatusBadge` (StageBadge-style status->color lookup
  using theme variables: running=accent pulse, waiting=warning, needs_attention=
  warning+ring, done/ended=success, failed=error, stale=muted), `EventDrawer`,
  `WaitingStrip`.
- Numbers in mono; elapsed tickers computed client-side from timestamps (no per-second
  refetch).
- Empty state: "no agents running" in muted mono, Ringside-style.

## Build plan — right-agent-for-the-job assignments

Orchestrator: Bast on Fable (this session) — dispatch, review synthesis, gate keeping.

| # | Task | Model | Effort | Notes |
|---|------|-------|--------|-------|
| A | Backend: schema + migration + ingest/fleet routes + registry + service-user seed + route tests + Haiku-grade fixtures folded in | Sonnet | high | Auth surface; follows troubador precedent files |
| B | UI: oracle section, nav (both files), Ringside-match desktop + mobile stack, fixture-driven | Sonnet | high | Visual fidelity to vendored reference |
| C | Telemetry: hook script + heartbeat + settings.json wiring + shellcheck/py sanity + executed dry-run against local dev | Sonnet | medium | Outside citadel repo; parallel with B |
| D | Adversarial review: ingest auth, Zod strictness, reconciliation correctness, no-blocking-hooks guarantee | Opus | high | Never cheap out on verification |
| E | E2E verify driver: full suite + tsc + lint + live round-trip (real events from this machine -> local Citadel -> page renders) + responsive sweep + screenshots for Mike | Sonnet | high | Executed gates decide pass, not agent claims |

Sequencing: A first (schema is the contract) -> B and C in parallel -> D and E.
All citadel work on branch `feat/oracle-visualizer`. No push, no deploy, no prod key
until Mike approves the verified result.

## Gates (execute, don't trust)

- A: `npx prisma migrate dev` applies clean on local DB; `npx tsc --noEmit`; route
  tests pass; executed curl round-trip of ingest fixture -> rows in DB.
- B: tsc; existing test suite still green; page renders seeded fixtures (Playwright
  smoke); no horizontal scroll at 360px; nav appears in both sidebar and drawer.
- C: heartbeat + hook script run against local dev and events land (SQL-verified);
  a deliberately unreachable endpoint does NOT slow a hook (timed).
- E: everything above re-run from clean checkout of the branch + screenshots.
- One retry with real failure output injected, then escalate to Mike.

## Known phase-1 limits (reviewed 2026-07-09)

An adversarial review after the initial A/B/C build found and this fix pass
closed: a session-resurrection bug (stale spool replays could flip an `ended`
session back to `running`), token-count regression on claude_code sessions
(a smaller later sample could overwrite a larger stored count), an unindexed
table-wide prune running on every single POST instead of only the heartbeat,
a spool-append race that could drop concurrent hook writes, and a UI gap that
couldn't distinguish "no machine has ever reported" from "healthy and quiet."
Those are fixed. What's left, accepted as reasonable for phase 1:

- **No wrapping transaction on ingest batches.** A single `/api/oracle/ingest`
  POST does several sequential Prisma calls (session upsert, event inserts,
  agent upserts, reconciliation, prune) with no surrounding `$transaction`. If
  the request dies partway through, some rows land and others don't. This
  self-heals: the same event/snapshot data reappears on the next heartbeat or
  hook retry (or via spool replay), and `OracleEvent` rows are keyed loosely
  enough that a duplicate insert on replay is just an extra append-only row,
  bounded by the 7-day prune. Acceptable because Oracle is a read-only fleet
  *visualizer* — nothing downstream depends on ingest being all-or-nothing.
- **Best-effort event loss under extreme burst.** The spool has a 2MB cap and
  the ingest batch cap is 500 events per call; a machine producing telemetry
  faster than the heartbeat can drain, for long enough, will silently drop the
  oldest queued events. No alerting on this — it would need telemetry about
  the telemetry, which is explicitly out of scope for phase 1.
- **Telemetry death is silent locally.** If the heartbeat cron itself stops
  running (crashes, gets unscheduled, the machine reboots without re-arming
  it), the only local signal is the absence of new lines in
  `~/.oracle-heartbeat.log`. There's no push alert; discovering this depends
  on someone looking at the Oracle fleet page and noticing the stale-machine
  banner (or, before this fix, not even that — see the dead-telemetry UI fix
  above).
- **Prod provisioning rule (review finding — read before ANY prod deploy):**
  `prisma/seed.ts` only runs against local/CI databases and gives the Oracle
  service user (`oracle@indelible.bot`) the same shared dev `password_hash`
  as every other seeded user. Ingest auth is API-key-only (`isOracleBot`
  checks the Bearer key's owner, never a password login) so this is harmless
  in dev. It must NOT carry over to prod: whoever provisions the prod Oracle
  service user must give it a random, unknown, or explicitly disabled
  password (never the shared dev password, never a memorable one) so the
  account has no viable login path at all beyond the API key. This is a
  manual provisioning step outside seed.ts — flag it explicitly in the prod
  deploy checklist when that day comes.

## Phase 1.5 — Admin-only visibility + Remote Spawn (Mike, 2026-07-09 evening)

### 1.5a Admin-only
Oracle becomes admin-only everywhere it is currently pm-or-admin: fleet route
`requireRole(['admin'])`, registry roles, page-level gate, nav gating in BOTH
Sidebar.tsx and MobileNav.tsx (isAdmin, not isPmOrAdmin). Update tests. The oracle
service bot (role pm) is unaffected: ingest authorizes via isOracleBot, not role.

### 1.5b Remote Spawn — the inbound command path (previously deferred, now approved)
Mike can create a "spawn session" command from the Oracle screen; the machine picks it
up within ~1 cron minute and starts a NEW Claude Code session with remote control on,
inside tmux, so it is steerable from the phone (claude.ai Remote Control) and
attachable at the desk.

SECURITY INVARIANTS (non-negotiable, both sides enforce):
- Verb allowlist: ONLY `spawn_session`. Server: Zod literal. Machine: dispatcher
  ignores/fails anything else. No arbitrary shell, ever.
- No shell string interpolation anywhere: subprocess argv arrays only; prompt passed
  as a single argv element to `claude`, never through a shell or send-keys.
- cwd validation machine-side: os.path.realpath must exist, be a directory, and be
  under $HOME.
- Only admins can create commands (server); dispatcher only claims commands for its
  own machine name; bot key required to read/claim.
- Full audit: the command row (creator, timestamps, payload, result/error) +
  an OracleEvent kind=command_executed.

Schema: OracleCommand @@map("oracle_commands"): id, machine_id FK, verb String,
payload Json ({cwd, prompt?, title?} — prompt <= 10KB), status
(pending|claimed|done|failed), created_by_id FK -> User, claimed_at?, completed_at?,
result Json?, error String?, created_at, updated_at. Index (machine_id, status).

API:
- POST /api/oracle/commands — admin only. Creates pending spawn_session command.
- GET  /api/oracle/commands?status=pending — bot only, machine-scoped.
- PATCH /api/oracle/commands/[id] — bot only. Claim MUST be atomic
  (updateMany where status=pending -> claimed; 409 if already claimed), then
  done/failed with result/error.
- Fleet response gains recent commands (last 24h) for UI status display.

Local dispatcher: ~/.claude/tools/oracle/oracle-dispatch.py, own crontab line
(every minute, same cadence as heartbeat). Claims pending commands; for
spawn_session: validate cwd per invariants, then
`tmux new-session -d -s oracle-<shortid> -c <cwd> -- <spawn_argv...>` where
spawn_argv comes from config.json `spawn_command` (default
["claude", "--remote-control"]) + the prompt appended as one final argv element if
present. PATCH done with {tmux_session} or failed with the real error. Always exit 0;
same logging/locking discipline as the heartbeat. NOTE: remote control needs the
claude.ai-authed CLI (v2.1.51+); tmux provides the tty. If Mike enables the /config
"Enable Remote Control for all sessions" default, spawn_command can drop the flag —
config, not code.

UI (admin): "New Session" button in the Oracle toolbar -> modal: cwd (input +
datalist of distinct cwds from current fleet), optional title, optional prompt
textarea. Command status strip (pending/claimed/done/failed chips, last 24h);
spawned session then appears in the fleet organically via its own hooks/heartbeat.
Mobile: button remains reachable; modal is a full-screen sheet at small widths.

Gates (executed): all existing suites stay green from clean checkout; atomic-claim
test (two concurrent claims -> one winner); REAL spawn rehearsal: command created via
API -> dispatcher run -> tmux session exists with claude alive in the right cwd ->
session appears in fleet -> command row done with result; failure paths (cwd outside
$HOME -> failed + error, unknown verb -> failed, double-claim -> 409); dispatcher
timing/exit-0 discipline. Phone-side Remote Control attach is Mike's manual checklist
item (needs his phone).

Opus adversarial review of the entire command path REQUIRED before presenting
(this is remote code execution by design; the allowlist and argv discipline are the
whole defense).

ADDENDUM (Mike, 2026-07-09): remote control on the spawned session is THE point —
phone access between sessions. Therefore:
- The dispatcher must CONFIRM remote-control registration after spawn (empirically
  find the reliable signal: tmux capture-pane for the remote-control confirmation in
  the TUI, process args check as fallback) and report it in the command result
  (remote_control: confirmed | unconfirmed). UI shows this state on the command chip;
  unconfirmed renders as a warning, not success.
- The spawn rehearsal gate FAILS unless remote_control=confirmed.
- Recommend to Mike enabling /config "Enable Remote Control for all sessions" as
  belt-and-braces (his action, not ours).
