# Clarity Phase 6 — Email Lanes & Calendar Intents (Citadel side)

Mike-approved 2026-07-23. Ships under the standing authorization (Citadel repo, gates green,
independent verification). Machine-side classifier work is Bast's separately, post-deploy.

Hard rules identical to all prior phases. Baselines at last ship: vitest 1827/153, Playwright 33/0
— re-baseline first with real exit codes (floors may have moved if anything merged since 4c).

## Schema (one additive migration `clarity_phase6_email_intents`)

`EmailAskIntent` enum (general | meeting | sales) + `email_asks.intent EmailAskIntent?` (nullable —
null renders as general). Add-to-Calendar fields per the existing quest's design:
`proposed_event_at DateTime?`, `proposed_event_title VarChar(500)?`, `proposed_event_minutes Int?`,
`calendar_requested Boolean @default(false)`, `calendar_event_id VarChar(255)?`. All additive;
IF NOT EXISTS on the enum.

## API

- `/api/oracle/email-sync` accepts the new optional fields (intent, proposed_event_*); absent =
  untouched, legacy payloads byte-compatible (test this).
- `PATCH /api/email-asks/[id]` accepts `calendar_requested` (the button's intent flag) alongside
  existing fields.
- `GET /api/email-asks` gains `?calendar_requested=true` filter (machine-side executor reads it).
- `/api/waiting-on-me`: intake response items include intent + proposed_event_*; intake summary
  gains per-lane counts: `{count, newest_at, lanes: {general, meeting, sales}}`.
- Registry updated for all changes.

## UI (Seeing Stone)

1. **Trigger chip** becomes three quiet counts: `📬 4 · 🤝 1 · 💰 2` (lanes with zero count render
   nothing — exception display; all-zero = the existing quiet zero line). Same header position.
2. **Drawer groups by lane** (Meeting, Sales, General — in that order, skipping empty lanes),
   lane headers quiet. Cards unchanged except:
3. **Meeting cards with a high-confidence parsed date** (proposed_event_at set) show the parsed
   time PROMINENTLY ("📅 Thu 7/24 · 3:30 PM · 45m") + an **Add to calendar** button → PATCH
   calendar_requested=true → button becomes "queued for calendar ⏳" (the machine-side cron
   executes within 15 min and sets calendar_event_id → renders "added ✓"). NO parsed date = NO
   button (never guess — the confidence rule is Mike's explicit requirement).
4. **Sales cards** keep Create / Create+open with lead-flavored copy ("Create lead quest").
5. Mobile: lanes stack, chip counts stay visible.

## Tests + gates

Baseline first; new unit tests (intent lanes grouping, per-lane counts, calendar_requested state
machine, sync field compatibility incl. legacy payloads); tsc; build; FULL Playwright + new e2e
(seed asks across three lanes: chip shows three counts, drawer groups correctly, Add-to-calendar
button appears ONLY on the seeded meeting ask with proposed_event_at, click flips to queued state)
+ screenshots (drawer open with three lanes visible, desktop + mobile). Exit-code discipline.
Commit repo-style incl. this spec + verification record. NO push — Bast verifies independently
then ships under the standing authorization.

## Report

Baselines vs finals, migration evidence, gate counts, screenshot paths, commits, deviations.
Note for Bast's machine-side follow-up: exact field contracts the classifier must emit.
