import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { requireCalendarOwner } from '@/lib/home/calendar/gate';
import { loadBookedEventIds, loadCalendarEvent, loadMatchTables } from '@/lib/home/calendar/load';
import { loadDrawerContext } from '@/lib/home/calendar/context';
import { matchEvent } from '@/lib/home/calendar/match';
import { eventKind } from '@/lib/home/calendar/classify';
import { eventsInView } from '@/lib/home/calendar/strip';
import { buildDrawer } from '@/lib/home/calendar/drawer';
import type { HomeCalendarEventResponse } from '@/lib/home/calendar/types';
import { loadHomeInputs } from '@/lib/home/load';
import { loadItemStates } from '@/lib/home/state';
import { selectHome } from '@/lib/home/select';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/home/calendar/[id]: the meeting drawer, loaded when it opens. Same gate as the
 * strip (browser session, the calendar's owner). The event must be on today or tomorrow in
 * his zone and not declined, else 404. His items come from the same selection as /api/home
 * and are read only. Writes nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCalendarOwner();
    const { id } = await params;
    if (!UUID.test(id)) throw new ApiError('Meeting not found', 404);

    const now = new Date();
    const timeZone = await resolveUserTimezone(auth.userId);
    const found = await loadCalendarEvent(prisma, id);
    const event = found ? eventsInView([found], now, timeZone)[0] : undefined;
    if (!event) throw new ApiError('Meeting not found', 404);

    const [bookedIds, tables] = await Promise.all([loadBookedEventIds(prisma, auth.userId), loadMatchTables(prisma, [event])]);
    const match = matchEvent(event, tables);
    const kind = eventKind(event, { bookedIds, titleMatched: match.matched });

    const [raw, states, ctx] = await Promise.all([
      loadHomeInputs(prisma, auth.userId, now, { timezone: timeZone }),
      loadItemStates(prisma, auth.userId),
      loadDrawerContext(prisma, { userId: auth.userId, now, eventId: event.event_id, kind, match }),
    ]);
    const sel = selectHome({ raw, states, now });

    const body: HomeCalendarEventResponse = buildDrawer({ now, timeZone, event, kind, match, raw, candidates: sel.candidates, ctx });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error);
  }
}
