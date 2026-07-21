# Clarity Phase 3b — Real Calendar Durations + Red Meeting Blocks (delta)

Delta on the completed Phase 3 (see clarity-phase3-oracle-face.md + the built code on this branch). Mike-approved changes: (1) the time-shape must use REAL meeting durations from his Google calendar, killing the 30-minute assumption; (2) meeting blocks render in the red family, not gray.

Hard rules identical to Phase 3 (worktree only, additive migration, baseline `npm run test:run` first — current floor 1514 tests / 128 files, all gates executed, registry updated, no push, never touch live crons/settings/main tree).

## 1. Calendar data plane

**Migration `clarity_phase3b_calendar_events`** — model CalendarEvent (`@@map("calendar_events")`): id uuid PK; `event_id VarChar(255) @unique` (Google event id); `title VarChar(500)`; `starts_at DateTime`; `ends_at DateTime`; `all_day Boolean @default(false)`; `source VarChar(50) @default("google")`; created_at/updated_at; `@@index([starts_at])`.

**POST `/api/oracle/calendar-sync`** — bearer auth (same util as `/api/session-tasks`). Body `{ window_start, window_end, events: [{event_id, title, starts_at, ends_at, all_day?}] }`, zod-validated, max 500 events. Upsert by event_id; then DELETE rows with `starts_at` inside the window whose event_id is not in the payload (cancelled meetings vanish); rows outside the window untouched. Register in the api registry.

**`/api/today/calendar`** — read calendar_events for the date instead of the Meeting model (delete that read path and the 30-min assumption). Timed events → existing blocks shape with real starts_at/ends_at; all-day events excluded from the track, returned in a separate `allDay: []` array. Week capacity endpoint switches to the same table. Keep response shapes otherwise stable; update TimeShape/capacity tests to real-duration fixtures.

**Machine-side sync (staged, NOT wired)** — `~/.claude/tools/oracle/clarity/calendar-sync.py`, python3 stdlib: call `gog calendar events mike@becomeindelible.com --account bast@becomeindelible.com --from <now-2h> --to <now+7d> --json --no-input` (the exact working pattern lives in `~/.local/bin/citadel-meeting-sync.sh`'s pre-check — read it first), map to the endpoint payload (skip status=cancelled; date-only start/end = all_day true), POST with bearer `~/.citadel-token`, env `CLARITY_CALENDAR_CONFIG` overrides base_url for testing (mirror how clarity/oracle-heartbeat-v2.py does config override). Do NOT touch any crontab — Bast wires the schedule after verification.

## 2. Meeting blocks go red-family

TimeShape meeting blocks switch from neutral to error-family tokens: error-subtle background, error border, error-ink text (same treatment pattern as the client-blocking severity chip), direct labels kept. Focus blocks stay accent-family. Add a component comment noting the research "no red" rule targets overdue/aging displays, not fixed calendar commitments — Mike explicitly chose red/orange for meetings.

## Executed verification (record in clarity-phase3b-verification.md, committed)

(a) migration applied (psql evidence); (b) run calendar-sync.py FOR REAL against the local dev server (PORT=3005, DB :5433) — Bast's gog auth works on this machine; show POST 200, SELECT rows, and a real event's true duration flowing through GET /api/today/calendar; (c) full suite green (≥1514 + new); (d) build clean; (e) e2e re-run with regenerated screenshots showing red-family meeting blocks (seed a fixture calendar event so the screenshot has one even if today is empty).

## Report

Baseline vs final counts, migration evidence, sync-run evidence (real event count synced), gate results, screenshot paths, commits, deviations with reasoning.
