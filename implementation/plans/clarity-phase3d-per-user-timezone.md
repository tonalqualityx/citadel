# Feature: Clarity Phase 3d — per-user timezone for Today/Seeing Stone

## Overview
Bug fix: the Seeing Stone renders Mike's calendar in UTC instead of his real zone
(America/New_York) — a 9am ET meeting shows at 13:00 on the time-shape. Root cause:
`/api/today` and `/api/today/calendar` treat "the day" as a UTC calendar day (a
documented Phase 3 deviation), and `TimeShape.tsx` builds its display window with a
literal `Z` (UTC) suffix even though its hour-axis labels ("8a"..."6p") are wall-clock
hours. Mike's amendment: timezone must be PER-USER (via `UserPreference.timezone`),
not a single global constant — other users (e.g. Sabeen, Asia/Karachi) will need their
own zone later.

## Files to Create
- [x] `prisma/migrations/..._clarity_phase3d_user_timezone/migration.sql` — additive,
      nullable `timezone` column on `user_preferences`
- [x] `lib/timezone.ts` — client+server-safe `DEFAULT_DISPLAY_TIMEZONE` constant only
      (no Prisma import, so client components can use it as a loading-state fallback)
- [x] `lib/services/user-timezone.ts` — server-only `resolveUserTimezone(userId)`:
      UserPreference.timezone → `CITADEL_DISPLAY_TZ` env → `DEFAULT_DISPLAY_TIMEZONE`
- [x] `lib/services/__tests__/user-timezone.test.ts`

## Files to Modify
- [x] `prisma/schema.prisma` — `UserPreference.timezone String? @db.VarChar(64)`
- [x] `lib/utils/time.ts` — add `getZonedDateString`, `getStartOfDateStringForTimezone`,
      `getDayBoundsForTimezone` (generalize the existing `getStartOfDayForTimezone`
      round-trip technique to an ARBITRARY date string, not just "now")
- [x] `app/api/today/route.ts` — resolve requester's timezone; default date =
      `getZonedDateString(now, tz)`; response includes `timezone`
- [x] `app/api/today/calendar/route.ts` — same resolution; `dayBounds` uses
      `getDayBoundsForTimezone`; response includes `timezone`
- [x] `lib/hooks/use-today.ts` — `TodayResponse`/`TodayCalendarResponse` gain `timezone`
- [x] `lib/api/registry/clarity.ts` — document the new `timezone` field/semantics
- [x] `components/domain/oracle/today/time-shape-logic.ts` — new exported
      `getTimeShapeWindow(dateStr, timezone, startHour, endHour)` (pure, testable) —
      this is the actual client-side fix for the reported bug
- [x] `components/domain/oracle/today/TimeShape.tsx` — takes a `timezone` prop, uses
      `getTimeShapeWindow` instead of building the window with a literal `Z`
- [x] `components/domain/oracle/today/TodaySection.tsx` — `formatPickedAt` takes a
      `timezone` param sourced from `calendarData.timezone`; passes `timezone` to
      `TimeShape`
- [x] `components/domain/oracle/OracleHeader.tsx` — `formatToday()` renders in
      `calendarData.timezone` (it already fetches `useTodayCalendar()` for the week
      strip), not the browser's implicit locale zone
- [x] `scripts/seed-oracle-fixtures.ts` or a one-off — set
      `admin@indelible.agency`'s `UserPreference.timezone = 'America/New_York'`
      (verification requirement)

## Tests to Update (Impact Analysis)
- `lib/utils/__tests__/time.test.ts` — new describe blocks for the 3 new functions,
  including the 8pm-ET boundary case and an Asia/Karachi mirror case
- `app/api/today/__tests__/route.test.ts` — mock `prisma.userPreference.findUnique`
  (new dependency); add the 8pm-ET-boundary default-date test + Karachi mirror; assert
  `timezone` in the GET response
- `app/api/today/calendar/__tests__/route.test.ts` — same mock; capture the actual
  `where` clause passed to `calendarEvent.findMany` to prove the day-bounds are
  ET-correct (existing tests are Prisma-mocked and don't exercise real bounds, so this
  is a genuinely new assertion, not just a defensive re-check)

## Verification Checklist
- [x] `npx tsc --noEmit`
- [x] `npm run test:run` (floor 1542/129 + new TZ tests)
- [x] `npm run build`
- [x] `npx playwright test` full suite (floor 11/0), screenshots regenerated showing
      ET-hour rendering
