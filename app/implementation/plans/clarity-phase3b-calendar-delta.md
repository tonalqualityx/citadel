# Feature: Clarity Phase 3b — Real Calendar Durations + Red Meeting Blocks (delta)

## Overview
Delta on Phase 3's Oracle Face. Two changes, both scoped to the Today time-shape's
calendar source: (1) replace the `Meeting` model + assumed-30-minute-duration read in
`/api/today/calendar` with a new `CalendarEvent` table carrying real Google Calendar
start/end, fed by a new bearer-authed sync endpoint and a staged (not cron-wired) python
sync script; (2) restyle TimeShape's meeting blocks from neutral/gray to the red/error
token family (explicit exception to the "no red" evidence-bound rule — that rule targets
overdue/aging displays, not fixed calendar commitments; Mike explicitly chose red/orange
here).

## Files to Create
- [ ] `prisma/migrations/<ts>_clarity_phase3b_calendar_events/migration.sql` — additive-only
- [ ] `app/api/oracle/calendar-sync/route.ts` — POST upsert+prune sync endpoint
- [ ] `app/api/oracle/calendar-sync/__tests__/route.test.ts`
- [ ] `~/.claude/tools/oracle/clarity/calendar-sync.py` — staged machine-side sync script (NOT cron-wired)
- [ ] `feature-planning/clarity-phase3b-verification.md` — executed verification record

## Files to Modify
- [ ] `prisma/schema.prisma` — add `CalendarEvent` model (`@@map("calendar_events")`)
- [ ] `app/api/today/calendar/route.ts` — read `calendar_events` instead of `Meeting`; drop
      the 30-min assumption; add `allDay: []` to the response
- [ ] `app/api/today/calendar/__tests__/route.test.ts` — update fixtures to real-duration
      `calendar_events` rows, add all-day exclusion coverage
- [ ] `lib/hooks/use-today.ts` — `TodayCalendarResponse` gains `allDay`
- [ ] `components/domain/oracle/today/TimeShape.tsx` — meeting block styling to error-family
      tokens + binding-rule-exception comment
- [ ] `lib/api/registry/oracle.ts` — register `/api/oracle/calendar-sync`
- [ ] `lib/api/registry/clarity.ts` — update `/api/today/calendar`'s documented response shape
      (real durations, no more "assumed 30-minute" note, `allDay`)
- [ ] `scripts/seed-clarity-phase3-fixtures.ts` — seed a fixture `calendar_event` (real,
      non-30-min duration) for the e2e day, replacing/alongside prior Meeting-based approach
      if any (checked: none currently seeded there)

## Implementation Steps
1. Schema: add `CalendarEvent` model per spec exactly (event_id unique, starts_at/ends_at,
   all_day default false, source default "google", @@index([starts_at])). Run
   `npx prisma migrate dev --name clarity_phase3b_calendar_events`.
2. `/api/oracle/calendar-sync` POST: `requireAuth()` only (matches spec: "same util as
   `/api/session-tasks`" — no role/bot restriction). Zod: window_start/window_end
   (ISO datetime), events[] max 500 (event_id, title, starts_at, ends_at, all_day optional).
   Upsert each event by event_id. Then delete calendar_events rows with starts_at within
   [window_start, window_end] whose event_id is NOT in the payload's event_id set (only
   within the window — rows outside untouched).
3. `/api/today/calendar` GET: query `calendar_events` for the day (starts_at within day
   bounds) instead of `Meeting`. Split all_day vs timed. Timed → `meetings[]` (real
   starts_at/ends_at, no assumed duration). All-day → `allDay[]` (separate array, excluded
   from the time-shape track). Week strip: same table, real per-event minutes for
   `meeting_minutes` (sum of real durations, timed events only) instead of count*30.
4. TimeShape.tsx: meeting block classes/styles switch to `bg-error-subtle` /
   `border-error` / `text-error-ink` (or the actual token names used elsewhere for the
   client-blocking severity chip — confirm exact class/var names before writing). Add the
   comment documenting the no-red-rule exception. Focus blocks unchanged (accent family).
5. Registry: add `/api/oracle/calendar-sync` to `oracle.ts` (group oracle, matches
   ingest's shape/style); update `/api/today/calendar`'s entry in `clarity.ts` to drop the
   "assumed 30-minute" note and document `allDay`.
6. Seed script: add a `calendar_event` row (real duration, e.g. 90 min) for the e2e's UTC
   today so the red block is guaranteed to render in the screenshot regardless of
   real-synced data.
7. `calendar-sync.py`: stdlib-only, mirrors `oracle-heartbeat-v2.py`'s config-override
   pattern (`CLARITY_CALENDAR_CONFIG` env var) and `citadel-meeting-sync.sh`'s exact `gog
   calendar events` invocation. Maps gog's raw event JSON → sync payload: skip
   `status == cancelled`; `all_day = True` when start/end are date-only (no `dateTime`);
   POST with bearer `~/.citadel-token` (or the config-override key file). NOT added to any
   crontab.

## Tests to Update (from reading, not a separate impact-analysis sub-agent — single
cohesive change, both existing test files read in full before this plan)
- [ ] `app/api/today/calendar/__tests__/route.test.ts` — mocks currently target
      `prisma.meeting.findMany` / `prisma.task.findMany`; must retarget to
      `prisma.calendarEvent.findMany`, update duration assertions to real (non-derived)
      end times, add an all-day-exclusion test, add a real-duration week-minutes test.
- [ ] `lib/hooks/__tests__/use-*` — checked: no existing hook test references
      `TodayCalendarResponse` shape directly; none require changes.
- [ ] `components/domain/oracle/today/__tests__/time-shape-logic.test.ts` — pure layout
      math is already start/end-duration-based (not 30-min-specific) — no changes needed.
      Confirmed by reading the file: MeetingInput already takes arbitrary start/end.
- [ ] `__tests__/e2e/oracle-phase3.spec.ts` — no assertion changes needed (doesn't assert
      meeting block color), but screenshots must be regenerated since blocks now render red.

## Tests to Write
- [ ] `/api/oracle/calendar-sync` route test: 200 upsert-by-event_id, prune-outside-payload-
      within-window, rows-outside-window-untouched, 400 on bad zod shape, cap at 500 events,
      401 without auth.
- [ ] Updated `/api/today/calendar` route test: real durations flow through unmodified,
      all-day events excluded from `meetings[]` and present in `allDay[]`, week
      `meeting_minutes` sums real per-event minutes.

## Addendum — mid-task spec addition (Mike, binding): 15-minute recovery buffer

Every timed meeting is followed by a 15-minute recovery buffer (attention-reset cost,
whether planned or not). Design:

- `MEETING_RECOVERY_MINUTES = 15` lives in `components/domain/oracle/today/time-shape-logic.ts`
  (the existing "single capacity encoding" pure lib — no React/fetch, already safely
  importable from a server route, same discipline as the file's own header comment).
- New pure functions in that same file: `computeMeetingBufferEnd(meetingEndMs,
  nextMeetingStartMs, recoveryMinutes?)` (null when fully truncated back-to-back),
  `layoutBufferBlocks(meetings, window, recoveryMinutes?)` (visual buffer segments, reuses
  `computeBlockLayout` for window clipping — handles "buffer runs past the visible day end"
  for free), `sumCommittedMinutesWithBuffer(meetings, recoveryMinutes?)` (per-day committed
  minutes = real duration + truncated buffer, for server-side week/day aggregation).
- `TimeShapeBlock.kind` gains `'buffer'`.
- Gap math: `freeGaps`/`layoutFocusBlocks` receive `[...meetingBlocks, ...bufferBlocks]` as
  the occupied-space input (both are already window-relative percent blocks; the existing
  overlap-merge logic naturally treats a meeting+its buffer as one continuous occupied span,
  and correctly merges back-to-back meetings' buffers too) — focus blocks can never land in
  a buffer.
- `/api/today/calendar` route: both the day's own committed minutes and each week-strip
  day's `meeting_minutes` are computed via `sumCommittedMinutesWithBuffer` over that day's
  timed events (all-day events excluded — they never enter this function).
- TimeShape.tsx renders each buffer block as a low-intensity, borderless, same-hue-family
  (error) segment attached to the meeting's trailing edge, `title="recovery buffer"`, no
  visible label at day scale.
- Tests (time-shape-logic.test.ts): normal gap (full 15min buffer, unclipped), back-to-back
  truncation (buffer shortened/eliminated), meeting at the end of the visible window (buffer
  clipped by window end), `sumCommittedMinutesWithBuffer` for a single meeting/back-to-back
  pair/no-next-meeting case, and a `layoutFocusBlocks` case proving a focus block never
  overlaps a buffer zone.
- All-day events: excluded before ever reaching these functions (calendar route already
  separates `allDay` from `meetings`) — no special-casing needed inside the buffer functions
  themselves; noted in the doc comment instead.

## Verification Checklist
- [ ] Baseline `npm run test:run` = 1514/128 (confirmed before any change)
- [ ] Migration applied locally, psql evidence captured
- [ ] `calendar-sync.py` run for REAL against `PORT=3005` dev server + local Postgres,
      using Mike's real Google Calendar via `gog` (bast@ auth) — POST 200, SELECT rows,
      a real event's true (non-30-min) duration visible via GET `/api/today/calendar`
- [ ] Full `npm run test:run` green, ≥1514 + new tests
- [ ] `next build` clean
- [ ] Registry updated
- [ ] Playwright e2e re-run, all 4 screenshots regenerated showing red-family blocks
- [ ] Verification record written + committed
