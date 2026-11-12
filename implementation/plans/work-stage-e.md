# Work stage E: sessions, Citadel side (as-built notes)

Plan: specs/work-integration-plan.md (system-review-2026-11), STAGE E. Built on feat/work-stage-e from origin/main eb74843. The machine side (hooks, scripts, settings) is another builder's.

## As built
- Migration `20261117060000_work_e`: `oracle_sessions.work_checked_at`, `close_pass_at`; `work_evidence.session_id` (nullable, indexed); `work_finished_item.run_key` widened 40 to 80 (a session key is `session:<id>`); new table `work_stale_ask_clear` (the ledger). No ALTER TYPE, nothing closed or deleted.
- Routes (oracle lane and the owner session): GET /api/oracle/work-index; POST /api/oracle/sessions/:id/links, /evidence, /close-task, /track; POST /api/oracle/sessions/stale-asks (addition: the server side of the clear and its restore).
- Code: lib/work/sessions.ts (pure), sessions-store.ts, session-track.ts, stale-asks.ts, session-copy.ts.
- Proof rule: strong = commit subject names the task short id (first 8 of its id), or a delivered file the task text names; medium = title overlap 0.5 or more. Strong makes one looks-done row per (session, task) in the Stage G table (run key `session:<id>`), shown as one card per session; medium writes only an internal note; none writes nothing. close-task needs STRONG proof recorded for that task in that session, the session linked to the task or its project, no unticked item, and never a security task.
- A session card waits 2 hours for an in-session answer while its session is running, waiting or idle; an ended or unknown session shows at once.
- workState: an attached running or waiting session gives `with_mike_session` (replaces cockpit-owned).

## Seams
- Stage C: none used. Stage F: Track it takes no time estimate yet (TODO(stage-f) in session-track.ts).
- Machine: the manifest.py clear of manifests, session_close clearing a parked ask on proof or link, and the sweep backstop are machine side. "Attended" is not known server side; running or waiting is used.
