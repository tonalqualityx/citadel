import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { requireCalendarOwner } from '@/lib/home/calendar/gate';
import { loadCalendarView } from '@/lib/home/calendar/load';
import { buildStrip } from '@/lib/home/calendar/strip';
import type { HomeCalendarStrip } from '@/lib/home/calendar/types';

/**
 * GET /api/home/calendar: today's calendar strip on the home screen. A time and a who for
 * each row, nothing else (the meeting drawer has the rest). Browser session only, and only
 * the calendar's owner (requireCalendarOwner); there is no user id parameter. It does not
 * build the home list and writes nothing.
 */
export async function GET() {
  try {
    const auth = await requireCalendarOwner();
    const now = new Date();
    const timeZone = await resolveUserTimezone(auth.userId);
    const view = await loadCalendarView(prisma, auth.userId, now, timeZone);
    const body: HomeCalendarStrip = buildStrip({ now, timeZone, events: view.events, bookedIds: view.bookedIds, who: view.who });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
