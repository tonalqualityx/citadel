import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

// Clarity Phase 3b — real Google Calendar sync for the Today time-shape. The machine-side
// script (~/.claude/tools/oracle/clarity/calendar-sync.py, STAGED — not cron-wired yet)
// calls this with a rolling window of events read from `gog calendar events`. Bearer auth
// via requireAuth() — same util as /api/session-tasks (cookie session OR API key, no
// bot-only restriction; this is an authenticated-caller endpoint, not machine-only like
// /api/oracle/ingest).
//
// Sync contract: upsert every event in the payload by its Google event_id (create-or-
// update — never duplicates), THEN delete any calendar_events row whose starts_at falls
// inside [window_start, window_end] but whose event_id was NOT in this payload — that's
// how a cancelled/deleted meeting disappears. Rows with starts_at OUTSIDE the window are
// never touched by a sync call for a different window (each call only "owns" its own
// window), which is why the caller is expected to re-sync a rolling window (e.g. now-2h to
// now+7d) on every run rather than a fixed one-shot range.
const MAX_EVENTS = 500;

// z.coerce.date() (not the stricter z.string().datetime()) — same convention as
// /api/oracle/ingest's eventInSchema.ts, since real Google Calendar timestamps arrive with
// a numeric UTC offset (e.g. "2026-07-21T09:00:00-04:00"), not always a bare "Z" suffix.
const eventSchema = z.object({
  event_id: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date(),
  all_day: z.boolean().optional().default(false),
});

const calendarSyncSchema = z
  .object({
    window_start: z.coerce.date(),
    window_end: z.coerce.date(),
    events: z.array(eventSchema).max(MAX_EVENTS),
  })
  .refine((data) => data.window_start.getTime() <= data.window_end.getTime(), {
    message: 'window_start must be at or before window_end',
    path: ['window_start'],
  });

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json();
    const data = calendarSyncSchema.parse(body);

    let upserted = 0;
    for (const event of data.events) {
      await prisma.calendarEvent.upsert({
        where: { event_id: event.event_id },
        create: {
          event_id: event.event_id,
          title: event.title,
          starts_at: event.starts_at,
          ends_at: event.ends_at,
          all_day: event.all_day,
        },
        update: {
          title: event.title,
          starts_at: event.starts_at,
          ends_at: event.ends_at,
          all_day: event.all_day,
        },
      });
      upserted++;
    }

    const incomingIds = data.events.map((e) => e.event_id);
    const pruned = await prisma.calendarEvent.deleteMany({
      where: {
        starts_at: { gte: data.window_start, lte: data.window_end },
        event_id: { notIn: incomingIds },
      },
    });

    return NextResponse.json({
      success: true,
      window_start: data.window_start.toISOString(),
      window_end: data.window_end.toISOString(),
      upserted,
      pruned: pruned.count,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
