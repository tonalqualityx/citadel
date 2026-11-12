# Work stage F: the two clocks, Citadel side (as-built notes)

Plan: specs/work-integration-plan.md (system-review-2026-11), STAGE F. Built on feat/work-stage-f from origin/main 869d9ea. The machine side
(`active.py`, `bast_time.py`, `post.py`, `clocks_run.py`) is staged in `~/.claude/tools/work-clock-next/` with its own INSTALL.md.

## As built
- Migration `20261117070000_work_f`: one new table `work_clock` (no foreign keys, unique `dedupe_key`, three indexes). Nothing else touched.
- Kinds: `mike_estimate` (his active time, inferred by the machine from timestamps and folders) and `bast_run` (Bast's measured time). Stored apart from `time_entries`.
- `POST /api/oracle/clocks` (oracle lane, its unlaned service key through `requireWorkCaller`, and the bast-chat lane): at most 200 rows, each judged alone, upsert by `dedupe_key`; writes `work_clock` only.
- `GET /api/work/:key/clocks`: his browser session only (`requireHomeUser`): the two lines on the project drawer and the task card's more panel.
- `POST /api/home/reconcile {action: log_clock, target_key, minutes, billable?}`: his tap. One time entry, stamps the estimate rows it answered, Bast rows never touched. Undo (24 hours) soft deletes the entry and un-stamps.
- Track it (`POST /api/oracle/sessions/:id/track`) takes `estimated_minutes` and `estimate_basis` and stores one `mike_estimate` row (source `track`) on the new work; Undo removes it unless a tap used it. The Stage E TODO is gone.
- Guard: `lib/work/__tests__/clock-guard.test.ts` fails if portal, client report, retainer, billing or Steward code names the table, model, lib, hook or routes, and pins the exact list of files that touch the clocks.

## Seams
- Stage C: none used by F. The older `TODO(stage-c)` markers (evidence-writers.ts, evidence.ts, email-outbox sent route) are untouched.
- Not built (plan: later, on his choice): a per-client choice to count Bast's time in a retainer report.
