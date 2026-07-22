import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatArcResponse } from '@/lib/api/formatters';
import { getArcStatus, getArcProgressPercent } from '@/lib/arc-status';
import { isArcSnoozed } from '@/lib/arc-snooze';
import { getZonedDateString, getDayBoundsForTimezone } from '@/lib/utils/time';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { sumCommittedMinutesWithBuffer } from '@/components/domain/oracle/today/time-shape-logic';
import { fetchTodayPicksForDate, shapeTodayPicks } from '@/lib/services/today-picks-shape';

// Clarity Phase 5 — The Soothsayer: the week-plan visualization at /oracle/soothsayer.
// Admin-only, same gate as /oracle and /api/today. "No new planning model exists or is
// wanted" per the spec — this route is a read-only aggregation over the SAME TodayPick
// rows /api/today already writes (POST /api/today, verified to already accept future
// dates), plus the arcs/sessions the day-columns arm the "can-never-lose-an-arc"
// unplanned section with. Deliberately "dumb data" like /api/today/calendar — the day
// columns, unplanned list, and snoozed row are all just different slices of the same
// underlying rows; no new writes happen here.
const SOOTHSAYER_DAYS = 7; // today + next 6 days, per spec section C.1
const NOT_ENDED_STALE = ['ended', 'stale'] as const;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const timezone = await resolveUserTimezone(auth.userId);
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const dateStr =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : getZonedDateString(new Date(), timezone);

    const dayDateStrs = Array.from({ length: SOOTHSAYER_DAYS }, (_, i) => addDays(dateStr, i));
    // TodayPick.date is a plain @db.Date column written as a literal UTC-midnight Date for
    // the given calendar-date STRING (see app/api/today/route.ts's parseDateParam) — never
    // a real timezone-resolved instant. Comparing it against getDayBoundsForTimezone's
    // actual zoned instant would be wrong (that's for CalendarEvent's real timestamps
    // below); this needs the SAME literal construction the write path uses.
    const todayPickDateFloor = new Date(`${dayDateStrs[0]}T00:00:00.000Z`);
    const lastDayBounds = getDayBoundsForTimezone(dayDateStrs[dayDateStrs.length - 1], timezone);

    // --- Day columns: picks (with arc progress) + meeting load, per day. ---
    const days = await Promise.all(
      dayDateStrs.map(async (d) => {
        const dateObj = new Date(`${d}T00:00:00.000Z`);
        const { start, end } = getDayBoundsForTimezone(d, timezone);

        const [picks, dayEvents] = await Promise.all([
          fetchTodayPicksForDate(dateObj),
          prisma.calendarEvent.findMany({
            where: { starts_at: { gte: start, lte: end }, all_day: false },
            select: { event_id: true, starts_at: true, ends_at: true },
          }),
        ]);

        const shapedPicks = await shapeTodayPicks(picks, { withProgress: true });
        const meetingMinutes = Math.round(
          sumCommittedMinutesWithBuffer(
            dayEvents.map((e) => ({ id: e.event_id, title: '', start: e.starts_at, end: e.ends_at })),
            undefined,
            undefined,
            start.getTime()
          )
        );

        return {
          date: d,
          picks: shapedPicks,
          meeting_count: dayEvents.length,
          meeting_minutes: meetingMinutes,
        };
      })
    );

    // --- "No day assigned": open, un-snoozed arcs with no arc-type pick today-or-future,
    // and live (not ended/stale) sessions with no session-type pick today-or-future. The
    // can-never-lose-an-arc guarantee — so this reads from-scratch across ALL arcs/sessions,
    // not just this 7-day window. ---
    const [allArcs, futureArcPicks, liveSessions, futureSessionPicks] = await Promise.all([
      prisma.arc.findMany({
        include: { tasks: { select: { status: true } } },
        orderBy: { created_at: 'desc' },
      }),
      prisma.todayPick.findMany({
        where: { item_type: 'arc', date: { gte: todayPickDateFloor }, arc_id: { not: null } },
        select: { arc_id: true },
      }),
      prisma.oracleSession.findMany({
        where: { status: { notIn: [...NOT_ENDED_STALE] }, archived_at: null },
        select: { external_id: true, title: true, status: true, remote_url: true, goal: true, cwd: true },
        // Most-recently-active first — this list can otherwise carry every idle session a
        // dev machine has ever had with no pick, and an unordered (effectively insertion-
        // order) result buries genuinely fresh/relevant sessions behind stale ones once the
        // binding kanban density cap (see UnplannedSection.tsx) trims what's visible.
        orderBy: { last_event_at: 'desc' },
      }),
      prisma.todayPick.findMany({
        where: {
          item_type: 'session',
          date: { gte: todayPickDateFloor },
          session_external_id: { not: null },
        },
        select: { session_external_id: true },
      }),
    ]);

    const pickedArcIds = new Set(futureArcPicks.map((p) => p.arc_id as string));
    const pickedSessionExternalIds = new Set(futureSessionPicks.map((p) => p.session_external_id as string));

    const nowMs = Date.now();
    const openUnsnoozedArcs = allArcs.filter((arc) => {
      const status = getArcStatus(arc);
      return status === 'open' && !isArcSnoozed(arc.snoozed_until, nowMs);
    });

    const unplannedArcs = openUnsnoozedArcs
      .filter((arc) => !pickedArcIds.has(arc.id))
      .map((arc) => ({
        ...formatArcResponse(arc, getArcStatus(arc)),
        progress_percent: getArcProgressPercent(arc.tasks),
      }));

    const unplannedSessions = liveSessions
      .filter((s) => !pickedSessionExternalIds.has(s.external_id))
      .map((s) => ({
        external_id: s.external_id,
        title: s.title,
        status: s.status,
        remote_url: s.remote_url,
        goal: s.goal,
        cwd: s.cwd,
      }));

    // --- Snoozed row: arcs with snoozed_until still in the future. ---
    const snoozedArcs = allArcs
      .filter((arc) => isArcSnoozed(arc.snoozed_until, nowMs))
      .map((arc) => ({
        ...formatArcResponse(arc, getArcStatus(arc)),
        progress_percent: getArcProgressPercent(arc.tasks),
      }))
      .sort((a, b) => new Date(a.snoozed_until!).getTime() - new Date(b.snoozed_until!).getTime());

    return NextResponse.json({
      timezone,
      days,
      unplanned: {
        arcs: unplannedArcs,
        sessions: unplannedSessions,
      },
      snoozed: {
        arcs: snoozedArcs,
      },
      meta: {
        windowStart: dayDateStrs[0],
        windowEnd: dayDateStrs[dayDateStrs.length - 1],
        windowEndInstant: lastDayBounds.end.toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
