import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { TaskStatus } from '@prisma/client';

// Clarity Phase 3 — the time-shape's calendar source. `Meeting` only carries a single
// `meeting_date` timestamp (no stored duration), so it isn't "a suitable read" for a
// start/end time-shape block per the spec's own escape hatch — this is the new endpoint the
// spec allows for instead. Deviation (documented): a meeting block is given an ASSUMED
// default duration since none is stored; the day track fills a block, not a point, from it.
//
// Dates are UTC calendar days throughout (see app/api/today/route.ts's identical note) —
// keeps this endpoint's "today" consistent with /api/today's, regardless of server TZ.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ASSUMED_MEETING_MINUTES = 30;
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

    const dayMeetings = await prisma.meeting.findMany({
      where: { is_deleted: false, meeting_date: { gte: start, lte: end } },
      select: { id: true, title: true, meeting_date: true },
      orderBy: { meeting_date: 'asc' },
    });

    const meetings = dayMeetings.map((m) => {
      const startTime = m.meeting_date;
      const endTime = new Date(startTime.getTime() + ASSUMED_MEETING_MINUTES * 60_000);
      return {
        id: m.id,
        title: m.title,
        start: startTime.toISOString(),
        end: endTime.toISOString(),
      };
    });

    // Week strip: today (or the requested date) through WEEK_STRIP_DAYS-1 days forward.
    const weekDateStrs = Array.from({ length: WEEK_STRIP_DAYS }, (_, i) => addDays(dateStr, i));
    const weekStart = dayBounds(weekDateStrs[0]).start;
    const weekEnd = dayBounds(weekDateStrs[weekDateStrs.length - 1]).end;

    const [weekMeetings, weekDueTasks] = await Promise.all([
      prisma.meeting.findMany({
        where: { is_deleted: false, meeting_date: { gte: weekStart, lte: weekEnd } },
        select: { meeting_date: true },
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
      const meetingsCount = weekMeetings.filter(
        (m) => m.meeting_date >= dStart && m.meeting_date <= dEnd
      ).length;
      const dueTasksCount = weekDueTasks.filter(
        (t) => t.due_date && t.due_date >= dStart && t.due_date <= dEnd
      ).length;
      return {
        date: d,
        meeting_minutes: meetingsCount * ASSUMED_MEETING_MINUTES,
        meetings_count: meetingsCount,
        due_tasks_count: dueTasksCount,
      };
    });

    return NextResponse.json({ date: dateStr, meetings, week });
  } catch (error) {
    return handleApiError(error);
  }
}
