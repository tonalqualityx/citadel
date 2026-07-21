# Clarity Phase 2 — Producers (birth ritual, manifests, heartbeat v2) — ALL STAGED

Spec author: Bast. Builder: implementation agent. Depends on Phase 1 (branch `feat/clarity-phase1-data-plane`, this worktree). System context: Bast memory `clarity-cockpit-system`.

## Purpose

Make sessions produce meaning: declare type+goal at birth, maintain a "waiting on Mike" ask, file DO-work as quests, capture ideas. Everything ships **STAGED** — no live behavior on this machine changes until Mike flips the switch.

## ABSOLUTE rules

1. NEVER modify: `~/.claude/tools/oracle/oracle-heartbeat.py`, `oracle-event.py`, `oracle_common.py`, `config.json`, `~/.claude/settings.json`, any crontab, the main citadel tree. These are LIVE (1-minute prod telemetry + all session hooks). Read them as much as you like.
2. All new machine-side files live under `~/.claude/tools/oracle/clarity/` (create it). Repo-side, only this spec + verification record get committed.
3. Verification is EXECUTED against the Phase 1 API: run the worktree dev server (`PORT=3005 npm run dev` in `~/.openclaw/workspace/citadel-clarity-wt/app`, DB already on localhost:5433) and prove each flow end-to-end with real HTTP + real DB rows. Kill the dev server when done.

## Deliverables

### 1. `manifest.py` — sidecar helper CLI
`~/.claude/tools/oracle/clarity/manifest.py`. Manifests at `~/.claude/oracle/manifests/<session-uuid>.json`:
`{ session_type, goal, arc_name?, waiting_on?, ask_queue?, ask_severity?, updated_at }`.
Commands: `set <session-uuid> --type X --goal "..." [--arc "..."]`, `ask <session-uuid> --queue decide|answer|review|do --text "..." [--severity ...]`, `clear-ask <session-uuid>`, `get <session-uuid>`. Atomic writes (tmp+rename), tolerant reads (corrupt file = start fresh, never crash). Python3 stdlib only, match the code style of the existing oracle tools.

### 2. `session-start-ritual.sh` — SessionStart hook script (staged, not wired)
Reads hook JSON on stdin (fields: session_id, source). Emits `additionalContext` per matcher:
- `startup` / `clear`: the birth-ritual contract (below) instructing the session to demand type+goal.
- `resume` / `compact` / `fork`: if a manifest exists for session_id, emit it as context ("your declared type/goal/ask is...") with NO re-demand; else emit the short form of the contract.
Also produce `settings-snippet.json` in the same dir: the exact hooks block Mike-flip-day will merge into `~/.claude/settings.json` (verify shape against the hooks documentation and the existing hook entries in settings.json — read-only).

### 3. `SESSION-CONTRACT.md` — the injected contract text
Same dir. Concise, imperative, written for a Claude session to obey:
- At session start: ask Mike for type (client_work/internal/systems/exploratory) + intended end result, ONE line, "I don't know yet" ⇒ exploratory. Then run `manifest.py set`. For exploratory: infer and propose a type/goal once the session takes shape, re-run set on acceptance. If the session pivots topic, re-declare (same command).
- Whenever ending a turn having parked a question/action on Mike: classify it decide/answer/review/do and run `manifest.py ask`. When it resolves: `clear-ask`.
- DO-work (execution only Mike can perform) additionally becomes a quest: POST `/api/session-tasks` (base_url + bearer token from `~/.citadel-token`; fields per the API registry). Decisions/answers/reviews do NOT become quests.
- "idea:" from Mike ⇒ POST `/api/ideas` (source=session, source_ref=session uuid), confirm in half a line, return to work.

### 4. `oracle-heartbeat-v2.py` — staged heartbeat
Copy of the live heartbeat plus: for each top-level claude_code session, read its manifest and add to the ingest payload: `session_type, goal, waiting_on, ask_queue, ask_severity` (+ pass `arc_name` resolution: NOT heartbeat's job — omit arc entirely for now; sessions attach arcs via session-tasks, the UI joins later). Null-clear semantics: manifest present with no `waiting_on` ⇒ send explicit `waiting_on: null` (+ null queue/severity); NO manifest ⇒ send none of the new fields (legacy behavior, byte-identical payload to v1). Config override via `CLARITY_HEARTBEAT_CONFIG` env var pointing at an alternate config.json (for testing against localhost:3005 without touching the live config).

### 5. Executed verification (record results in `feature-planning/clarity-phase2-verification.md`, committed)
With dev server up: (a) `manifest.py` set/ask/get/clear-ask round-trip incl. corrupt-file tolerance; (b) heartbeat-v2 with a fake session + manifest → ingest 200 → SELECT the oracle_sessions row, prove the new fields landed; (c) clear-ask → next beat nulls the fields in DB; (d) no manifest → payload contains none of the new fields (diff v1 vs v2 payload for the same session, must be identical); (e) session-start-ritual.sh: feed it synthetic hook JSON for each matcher, show emitted context; (f) POST /api/session-tasks and /api/ideas exactly as the contract instructs (bearer ~/.citadel-token against localhost:3005) → 201s, rows exist, dedup re-POST returns deduped:true.

## Report back
Files created (full paths), each verification item's actual executed result, the settings-snippet contents, deviations with reasoning, and the exact flip-day checklist (what Mike/Bast must do to go live, in order, including that ingest fields only work after Phase 1 deploys to prod).
