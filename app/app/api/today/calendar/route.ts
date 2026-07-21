import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { TaskStatus } from '@prisma/client';
import { sumCommittedMinutesWithBuffer } from '@/components/domain/oracle/today/time-shape-logic';

// Clarity Phase 3b — the time-shape's calendar source. Reads the real-duration
// `CalendarEvent` table (synced via POST /api/oracle/calendar-sync from Mike's Google
// Calendar) instead of `Meeting`, which only ever carried a single `meeting_date`
// timestamp with no stored duration — the 30-minute-assumption deviation this replaces.
// Timed events become time-shape blocks with their REAL start/end; all-day events are
// excluded from the track entirely and returned separately in `allDay`.
//
// Dates are UTC calendar days throughout (see app/api/today/route.ts's identical note) —
// keeps this endpoint's "today" consistent with /api/today's, regardless of server TZ.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_STRIP_DAYS = 5; // matches the approved mockup: today + 4 forward days

function toUTCDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Kept "dumb" per spec — raw counts only. Fill-percent/packed-tint encoding is computed
// client-side (see components/domain/oracle/today/time-shape-logic.ts) so the single
// capacity encoding used across the day track, the week strip, and (later) planning views
// lives in exactly one place.
function dayBounds(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);
  return { start, end };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toUTCDateString(d);
}

const NOT_DONE_ABANDONED: TaskStatus[] = [TaskStatus.done, TaskStatus.abandoned];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const dateStr = dateParam && DATE_RE.test(dateParam) ? dateParam : toUTCDateString(new Date());

    const { start, end } = dayBounds(dateStr);

    const dayEvents = await prisma.calendarEvent.findMany({
      where: { starts_at: { gte: start, lte: end } },
      select: { event_id: true, title: true, starts_at: true, ends_at: true, all_day: true },
      orderBy: { starts_at: 'asc' },
    });

    const meetings = dayEvents
      .filter((e) => !e.all_day)
      .map((e) => ({
        id: e.event_id,
        title: e.title,
        start: e.starts_at.toISOString(),
        end: e.ends_at.toISOString(),
      }));

    const allDay = dayEvents
      .filter((e) => e.all_day)
      .map((e) => ({
        id: e.event_id,
        title: e.title,
        start: e.starts_at.toISOString(),
        end: e.ends_at.toISOString(),
      }));

    // Week strip: today (or the requested date) through WEEK_STRIP_DAYS-1 days forward.
    const weekDateStrs = Array.from({ length: WEEK_STRIP_DAYS }, (_, i) => addDays(dateStr, i));
    const weekStart = dayBounds(weekDateStrs[0]).start;
    const weekEnd = dayBounds(weekDateStrs[weekDateStrs.length - 1]).end;

    const [weekEvents, weekDueTasks] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { starts_at: { gte: weekStart, lte: weekEnd } },
        select: { starts_at: true, ends_at: true, all_day: true },
      }),
      prisma.task.findMany({
        where: {
          is_deleted: false,
          status: { notIn: NOT_DONE_ABANDONED },
          due_date: { gte: weekStart, lte: weekEnd },
        },
        select: { due_date: true },
      }),
    ]);

    const week = weekDateStrs.map((d) => {
      const { start: dStart, end: dEnd } = dayBounds(d);
      // Committed load: real duration + the 15-minute recovery buffer trailing each
      // meeting (truncated by a back-to-back next meeting) — see
      // sumCommittedMinutesWithBuffer's own doc comment. All-day events never enter this
      // calculation (no time cost, no buffer) — excluded here, not inside that function.
      const dayTimedEvents = weekEvents.filter(
        (e) => !e.all_day && e.starts_at >= dStart && e.starts_at <= dEnd
      );
      const dueTasksCount = weekDueTasks.filter(
        (t) => t.due_date && t.due_date >= dStart && t.due_date <= dEnd
      ).length;
      return {
        date: d,
        meeting_minutes: Math.round(
          sumCommittedMinutesWithBuffer(
            dayTimedEvents.map((e) => ({ id: '', title: '', start: e.starts_at, end: e.ends_at }))
          )
        ),
        meetings_count: dayTimedEvents.length,
        due_tasks_count: dueTasksCount,
      };
    });

    return NextResponse.json({ date: dateStr, meetings, allDay, week });
  } catch (error) {
    return handleApiError(error);
  }
}
