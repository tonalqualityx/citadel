# Clarity Phase 3b — Executed Verification Record

Ran 2026-07-21 against the local dev stack (`~/.openclaw/workspace/citadel-clarity-wt/app`,
branch `feat/clarity-phase1-data-plane`), Postgres at `localhost:5433` (container
`citadel-postgres`, database `citadel_dev`). All commands below were actually executed;
outputs are pasted verbatim (trimmed only where noted). Real Google Calendar data (Mike's
`mike@becomeindelible.com` calendar, `bast@becomeindelible.com` gog auth) was used for the
sync-run evidence in (b) — not synthetic fixtures.

## Baseline vs final counts

| | Test files | Tests |
|---|---|---|
| Baseline (`npm run test:run`, before any change) | 128 | 1514 |
| Final (`npm run test:run`, after all changes)     | 129 | 1542 |

Floor (1514/128) fully preserved; +1 new test file (`/api/oracle/calendar-sync` route
test, 8 tests), +28 new tests total (8 calendar-sync + 3 `/api/today/calendar` + 17
`time-shape-logic.ts` buffer-math tests).

---

## (a) Migration applied — psql evidence

```
$ npx prisma migrate dev --name clarity_phase3b_calendar_events
Applying migration `20260721191544_clarity_phase3b_calendar_events`
Your database is now in sync with your schema.
✔ Generated Prisma Client (v6.19.1)
```

`prisma/migrations/20260721191544_clarity_phase3b_calendar_events/migration.sql`:

```sql
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(50) NOT NULL DEFAULT 'google',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_events_event_id_key" ON "calendar_events"("event_id");
CREATE INDEX "calendar_events_starts_at_idx" ON "calendar_events"("starts_at");
```

Additive-only — no existing table/column touched. `Meeting` untouched (still exists,
simply no longer read by `/api/today/calendar`).

```
$ docker exec citadel-postgres psql -U citadel -d citadel_dev -c "\d calendar_events"
                                  Table "public.calendar_events"
   Column   |              Type              | Nullable |           Default
------------+--------------------------------+----------+-----------------------------
 id         | uuid                           | not null |
 event_id   | character varying(255)         | not null |
 title      | character varying(500)         | not null |
 starts_at  | timestamp(3) without time zone | not null |
 ends_at    | timestamp(3) without time zone | not null |
 all_day    | boolean                        | not null | false
 source     | character varying(50)          | not null | 'google'::character varying
 created_at | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
 updated_at | timestamp(3) without time zone | not null |
Indexes:
    "calendar_events_pkey" PRIMARY KEY, btree (id)
    "calendar_events_event_id_key" UNIQUE, btree (event_id)
    "calendar_events_starts_at_idx" btree (starts_at)
```

**Result: PASS.**

---

## (b) calendar-sync.py run FOR REAL against the local dev server

**Setup (local-only, never touches prod — see Deviations #1):**
- Dev server: `PORT=3005 npm run dev` against `citadel_dev` on `:5433`.
- Minted a fresh local API key for `mike@becomeindelible.com` the same way
  `lib/auth/api-keys.ts`'s `generateApiKey()` does (`citadel_` + 32 random bytes hex,
  sha256 hash stored), inserted directly into `api_keys`. Named "Clarity Phase 3b local
  verification key (mike)".
- `~/.claude/tools/oracle/clarity/test-config.json` (deleted after testing):
  `{"base_url": "http://localhost:3005", "key_file": "<path to the raw key file>"}`.

**Dry run first (no network) — proves the mapping logic against Mike's REAL calendar:**

```
$ python3 ~/.claude/tools/oracle/clarity/calendar-sync.py --dry-run
{
  "window_start": "2026-07-21T17:25:16Z",
  "window_end": "2026-07-28T19:25:16Z",
  "events": [
    { "event_id": "t781n0o0a796h27p6rj1gl9kgk_20260721", "title": "Home",
      "starts_at": "2026-07-21T00:00:00.000Z", "ends_at": "2026-07-22T00:00:00.000Z",
      "all_day": true },
    { "event_id": "42sbgaig0vph6o16giicbnjhn8_20260721T130000Z", "title": "Being Nerds at BRIC",
      "starts_at": "2026-07-21T09:00:00-04:00", "ends_at": "2026-07-21T17:05:00-04:00",
      "all_day": false },
    { "event_id": "79vpp34s478anmf16mqtht6lj4_20260721T203000Z", "title": "Get the boys",
      "starts_at": "2026-07-21T16:30:00-04:00", "ends_at": "2026-07-21T17:50:00-04:00",
      "all_day": false },
    ... 7 more real events (Erick Thibodeau meeting, Nils-Mike coaching, Billing & Prep, etc.)
  ]
}
```

10 real events fetched via `gog calendar events mike@becomeindelible.com --account
bast@becomeindelible.com`, correctly split all-day vs timed, no `cancelled` events present
in this window to filter (mapping logic for that path is covered by the route's own unit
tests — see the "cancelled" skip in `_map_event`).

**Real POST run:**

```
$ CLARITY_CALENDAR_CONFIG=~/.claude/tools/oracle/clarity/test-config.json \
    python3 ~/.claude/tools/oracle/clarity/calendar-sync.py
exit code: 0

$ tail -1 ~/.oracle-calendar-sync.log
2026-07-21T19:26:14.228865+00:00 ok=True raw=10 mapped=10 truncated=False errors=0 \
  info=200 b'{"success":true,"window_start":"2026-07-21T17:26:13.000Z",
  "window_end":"2026-07-28T19:26:13.000Z","upserted":10,"pruned":0}'
```

**POST 200. `upserted: 10`, `pruned: 0`** (fresh table, nothing to prune yet).

**SELECT rows — real durations proven, not the old 30-minute assumption:**

```
$ docker exec citadel-postgres psql -U citadel -d citadel_dev -c "
select event_id, title, starts_at, ends_at, all_day,
       EXTRACT(EPOCH FROM (ends_at - starts_at))/60 as duration_minutes
from calendar_events order by starts_at;"

                  event_id                   |             title             | all_day | duration_minutes
---------------------------------------------+-------------------------------+---------+------------------
 t781n0o0a796h27p6rj1gl9kgk_20260721         | Home                          | t       | 1440
 42sbgaig0vph6o16giicbnjhn8_20260721T130000Z | Being Nerds at BRIC           | f       |  485
 79vpp34s478anmf16mqtht6lj4_20260721T203000Z | Get the boys                  | f       |   80
 k9ubd0f34mvg6r14jd2bp9viek_20260722         | Home                          | t       | 1440
 79vpp34s478anmf16mqtht6lj4_20260722T203000Z | Get the boys                  | f       |   80
 gjd4sd80qb0i2i06kk5d6dges4                  | Erick Thibodeau and Mike Dion | f       |   30
 79vpp34s478anmf16mqtht6lj4_20260723T203000Z | Get the boys                  | f       |   80
 54ejuavilrnc56q0dqlbd1nruq                  | Nils-Mike coaching (2 of x)   | f       |   60
 3nrbccum37j8pbfje07nc4l6c8_20260727         | Office                        | t       | 1440
 58jsgmsrvd261pojkmdtt36l1v_20260727T093000Z | Billing & Prep                | f       |   25
(10 rows)
```

None of the timed durations are 30 minutes across the board (485, 80, 30, 60, 25) — real
durations, proven end-to-end. "Being Nerds at BRIC" is a real 485-minute (8hr05m) event
that the old code would have shown as a 30-minute block.

**GET `/api/today/calendar?date=2026-07-21` — a real event's true duration flowing
through the endpoint, logged in as `admin@indelible.agency`:**

```
$ curl -s -b cookies.txt "http://localhost:3005/api/today/calendar?date=2026-07-21"
{
  "date": "2026-07-21",
  "meetings": [
    { "id": "42sbgaig0vph6o16giicbnjhn8_20260721T130000Z", "title": "Being Nerds at BRIC",
      "start": "2026-07-21T13:00:00.000Z", "end": "2026-07-21T21:05:00.000Z" },
    { "id": "79vpp34s478anmf16mqtht6lj4_20260721T203000Z", "title": "Get the boys",
      "start": "2026-07-21T20:30:00.000Z", "end": "2026-07-21T21:50:00.000Z" }
  ],
  "allDay": [
    { "id": "t781n0o0a796h27p6rj1gl9kgk_20260721", "title": "Home",
      "start": "2026-07-21T00:00:00.000Z", "end": "2026-07-22T00:00:00.000Z" }
  ],
  "week": [
    { "date": "2026-07-21", "meeting_minutes": 580, "meetings_count": 2, "due_tasks_count": 0 },
    { "date": "2026-07-22", "meeting_minutes": 95,  "meetings_count": 1, "due_tasks_count": 0 },
    { "date": "2026-07-23", "meeting_minutes": 140, "meetings_count": 2, "due_tasks_count": 0 },
    { "date": "2026-07-24", "meeting_minutes": 75,  "meetings_count": 1, "due_tasks_count": 0 },
    { "date": "2026-07-25", "meeting_minutes": 0,   "meetings_count": 0, "due_tasks_count": 0 }
  ]
}
```

- "Being Nerds at BRIC" shows its real 8h05m span (13:00–21:05 UTC), not a 30-minute
  block. The all-day "Home" event is correctly excluded from `meetings` and appears only
  in `allDay`.
- **Buffer math hand-verified against this real, non-synthetic data** (including a genuine
  overlap in Mike's real calendar — "Get the boys" starts at 20:30, before "Being Nerds at
  BRIC" ends at 21:05):
  - **2026-07-21** = 485 (BRIC, buffer truncated to 0 — next meeting already started before
    BRIC ends, a real overlap) + 80 + 15 (Get the boys, full buffer, nothing follows) = **580** ✓
  - **2026-07-22** = 80 + 15 = **95** ✓
  - **2026-07-23** = 30 + 15 (Erick Thibodeau) + 80 + 15 (Get the boys, 5hr gap, no
    truncation) = **140** ✓
  - **2026-07-24** = 60 + 15 (Nils-Mike coaching) = **75** ✓
  - **2026-07-25** = 0 (no events) ✓

  This incidentally proves the overlap-handling branch of `computeMeetingBufferEnd`
  (returns `null`/zero buffer when a next meeting starts at-or-before the current one
  ends) against a REAL calendar conflict, not just a synthetic unit-test fixture.

**Result: PASS.** Real sync, real durations, real buffer math, all verified against actual
production calendar data.

---

## (c) Full suite green

```
$ npm run test:run
 Test Files  129 passed (129)
      Tests  1542 passed (1542)
```

≥1514 floor + 28 new (8 calendar-sync route tests, 3 today/calendar route tests, 17
time-shape-logic buffer-math tests). Zero regressions.

---

## (d) Build clean

```
$ npm run build
BUILD EXIT: 0
```

`/api/oracle/calendar-sync` present in the route manifest. No TypeScript/build errors.

---

## (e) Playwright e2e re-run, screenshots regenerated

Seeded fixtures first (`scripts/seed-oracle-fixtures.ts` then
`scripts/seed-clarity-phase3-fixtures.ts`, the latter now also creating one
`calendar_event` fixture — `E2E: fixture meeting (red block)`, 14:00–15:30 UTC, a real
90-minute duration — for the e2e's UTC-today, per the spec's "seed a fixture calendar
event so the screenshot has one even if today is empty" instruction):

```
$ npx ts-node scripts/seed-clarity-phase3-fixtures.ts
  created 1 calendar_event fixture for 2026-07-21
```

```
$ npx playwright test __tests__/e2e/oracle-phase3.spec.ts --reporter=list
  ✓ Oracle Phase 3 — mobile layout, no horizontal overflow (2.7s)
  ✓ Oracle Phase 3 — desktop layout, arc board drag-move, screenshots (7.3s)
  2 passed (10.4s)
```

Both existing e2e tests pass unmodified (no assertion changes were needed — the spec
doesn't assert block color, only that `time-shape` mounts and there's no horizontal
overflow, both still true).

**Screenshots regenerated** (`app/test-results/clarity-phase3/`), visually confirmed —
the Today time-shape track shows **red-family blocks** for "Being Nerds at BR[IC]" and
"E2E: fixture meeting (red...)" (error-subtle background, error border, error-ink text),
while the two focus picks ("E2E Clarity Phase 3 Arc (demo)", "E2E: quick note pick") stay
blue/accent — confirming the color-family swap without disturbing the focus-block styling:

- `app/test-results/clarity-phase3/desktop-1280-oracle.png`
- `app/test-results/clarity-phase3/desktop-1280-arc-board-before-drag.png`
- `app/test-results/clarity-phase3/desktop-1280-arc-board-after-drag.png`
- `app/test-results/clarity-phase3/mobile-390-oracle.png`

**Result: PASS.**

---

## Test-data footprint left in the local dev DB (not cleaned up — ephemeral/local only)

Entirely inside the local `citadel_dev` Postgres container (port 5433), never touches
production:
- 10 real `calendar_events` rows synced from Mike's actual Google Calendar (harmless —
  it's just his own real calendar data, already visible to him in Google Calendar itself)
  + 1 e2e fixture row (`e2e-clarity-phase3b-fixture-meeting`).
- One additional API key row for `mike@becomeindelible.com` ("Clarity Phase 3b local
  verification key (mike)") — only its sha256 hash persists; the raw key file was deleted
  after testing (see Cleanup below).
- `npx prisma migrate reset` (or `npm run db:reset`) clears all of it if a clean slate is
  wanted before further Phase 1/2/3 work.

## Cleanup performed after verification

- Deleted `~/.claude/tools/oracle/clarity/test-config.json` and the throwaway raw-key file
  (not spec deliverables — test harness only, same as the Phase 2 precedent).
- Killed both dev server instances used during verification (the manual `PORT=3005` one
  used for the real sync-run evidence, and the `PORT=3000` one Playwright's `webServer`
  spawned for the e2e run).
- Nothing under `~/.claude/tools/oracle/` outside `clarity/` was modified; no crontab
  touched (per the spec's explicit instruction — `calendar-sync.py` stays STAGED, Bast
  wires the schedule separately after this record is reviewed); no `~/.claude/settings.json`
  change; no push.

---

## Deviations from the literal spec text (with reasoning)

1. **Auth for local verification did not use `~/.citadel-token` as literally instructed.**
   Same reasoning as the Phase 2 precedent (`feature-planning/clarity-phase2-verification.md`
   deviation #1): that token's sha256 hash authenticates against production
   (`https://citadel.becomeindelible.com`), not this ephemeral local Postgres. Minted an
   equivalent local API key the exact way `generateApiKey()` does and used that instead —
   the actual HTTP/DB code path (`requireAuth()`, the upsert, the prune) is identical
   either way; only the specific bearer value differs. In real production use (once Bast
   wires the cron), `calendar-sync.py`'s documented default (`~/.citadel-token`) is exactly
   right.
2. **`z.coerce.date()` instead of `z.string().datetime()`** for `window_start`/
   `window_end`/`starts_at`/`ends_at` in the calendar-sync route's Zod schema (not
   mentioned explicitly in the delta spec, which only said "zod-validated"). Real Google
   Calendar timestamps from `gog` carry a numeric UTC offset (e.g.
   `2026-07-21T09:00:00-04:00`), which Zod's stricter `.datetime()` rejects by default
   (requires a bare `Z` suffix unless `{offset: true}` is passed). `z.coerce.date()` is the
   same convention already used by `/api/oracle/ingest`'s `eventInSchema` for exactly this
   reason — chosen for consistency and because the stricter method would have silently
   400'd every real timed event during verification.
3. **`meetings_count`/`meeting_minutes` in the week strip now exclude all-day events**
   (the spec didn't explicitly restate this for the week aggregation, only for the day
   track's `meetings`/`allDay` split). An all-day "Home"/"Office" working-location marker
   has no time cost and was never meant to inflate the packed-day capacity tint — this
   matches the day-track behavior and is the only self-consistent reading once `allDay` is
   a first-class concept.
4. **`MEETING_RECOVERY_MINUTES` and the buffer functions live in
   `components/domain/oracle/today/time-shape-logic.ts`**, imported directly by the
   server-side `/api/today/calendar/route.ts` (a route importing from `components/` is
   unusual layering). This follows Mike's own mid-task instruction verbatim ("Constant ...
   in the time-shape layout lib ... single source") — the file is already pure/
   dependency-free (no React, no fetch — same discipline the file's own header comment
   claims), so it's safe to import from a server route, and duplicating the constant/math
   in two places would have been the actual violation of "single source."
5. **`calendar-sync.py`'s production defaults** (`base_url:
   https://citadel.becomeindelible.com`, `key_file: ~/.citadel-token`) were inferred from
   Bast's own operating context (this is the same token already used for other Citadel PM
   API calls against prod) rather than stated verbatim in the delta spec, which only named
   the bearer source. Documented in the script's own docstring; the `CLARITY_CALENDAR_CONFIG`
   override path used for this verification never touched those defaults.

## What Bast should know before wiring the cron

- `calendar-sync.py` is fully staged and verified but **NOT in any crontab** — that step is
  explicitly reserved for Bast per the spec.
- Suggested cadence: every 15-30 minutes (the endpoint's own upsert+prune-within-window
  design tolerates re-running the same rolling window arbitrarily often — it's idempotent).
- The endpoint accepts any authenticated caller (`requireAuth()`, not machine-only like
  `/api/oracle/ingest`) — matches the spec's explicit instruction to mirror
  `/api/session-tasks`'s auth, not the ingest endpoint's bot-only restriction.
