import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { getZonedDateString } from '@/lib/utils/time';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { validateTodayPickRef, isAtWipCap } from '@/lib/today-picks';
import { PICK_INCLUDE, fetchTodayPicksForDate, shapeTodayPicks } from '@/lib/services/today-picks-shape';

// Clarity Phase 3 — The Oracle Face: Today picks (the day's chosen commitments). Admin-only,
// same as the rest of the Oracle surface (fleet, waiting-on-me).
//
// Clarity Phase 3d (bug fix): "today" now resolves to the REQUESTING USER's own
// timezone (lib/services/user-timezone.ts's resolution chain: UserPreference.timezone
// -> CITADEL_DISPLAY_TZ env -> America/New_York), not a plain UTC calendar day — that
// was the Phase 3 deviation that made the Seeing Stone drift from wall-clock reality
// (an evening ET pick could land on "tomorrow" once past 8pm ET / midnight UTC). The DB
// column itself is still `@db.Date` (no timezone of its own — confirmed empirically
// that Prisma truncates whatever Date object it's given to ITS UTC calendar day), so
// the fix is entirely in what date STRING this route resolves as the default/write
// value — always the zoned string, never toUTCDateString(new Date()). The resolved
// zone is also returned in the response so the client formats every rendered time in
// the SAME zone this route used to decide "today", never a guess.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUTCDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const createPickSchema = z.object({
  date: z.string().regex(DATE_RE).optional(),
  item_type: z.enum(['arc', 'task', 'session', 'lead', 'note']),
  arc_id: z.string().uuid().optional().nullable(),
  task_id: z.string().uuid().optional().nullable(),
  session_external_id: z.string().max(255).optional().nullable(),
  charter_id: z.string().uuid().optional().nullable(),
  label: z.string().max(300).optional().nullable(),
  sort: z.number().int().optional(),
});

function parseDateParam(dateStr: string | null, timezone: string): Date {
  const raw = dateStr && DATE_RE.test(dateStr) ? dateStr : getZonedDateString(new Date(), timezone);
  return new Date(`${raw}T00:00:00.000Z`);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const timezone = await resolveUserTimezone(auth.userId);
    const { searchParams } = new URL(request.url);
    // Clarity Phase 5 — verified (and now regression-tested) that a future `date` param
    // was already accepted here with no special-casing: parseDateParam just parses
    // whatever valid YYYY-MM-DD string is given, and the WIP cap below is already scoped
    // `where: { date: targetDate }` — per-day, not "today-relative". This is the
    // Soothsayer's data source; no new planning model was needed or added.
    const targetDate = parseDateParam(searchParams.get('date'), timezone);

    const picks = await fetchTodayPicksForDate(targetDate);
    const shaped = await shapeTodayPicks(picks);

    const uncompletedCount = picks.filter((p) => !p.completed_at).length;

    return NextResponse.json({
      date: toUTCDateString(targetDate),
      timezone,
      picks: shaped,
      meta: {
        total: shaped.length,
        uncompleted: uncompletedCount,
        cap: 5,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const data = createPickSchema.parse(body);

    const validation = validateTodayPickRef({
      item_type: data.item_type,
      arc_id: data.arc_id,
      task_id: data.task_id,
      session_external_id: data.session_external_id,
      charter_id: data.charter_id,
      label: data.label,
    });
    if (!validation.valid) {
      throw new ApiError(validation.error ?? 'Invalid pick', 400);
    }

    const timezone = await resolveUserTimezone(auth.userId);
    const targetDate = parseDateParam(data.date ?? null, timezone);

    const uncompletedCount = await prisma.todayPick.count({
      where: { date: targetDate, completed_at: null },
    });
    if (isAtWipCap(uncompletedCount)) {
      throw new ApiError(
        'Today already holds 5 uncompleted picks — finish or drop one before adding another.',
        409
      );
    }

    if (data.arc_id) {
      const arc = await prisma.arc.findUnique({ where: { id: data.arc_id } });
      if (!arc) throw new ApiError('Arc not found', 404);
    }
    if (data.task_id) {
      const task = await prisma.task.findUnique({ where: { id: data.task_id, is_deleted: false } });
      if (!task) throw new ApiError('Task not found', 404);
    }
    if (data.charter_id) {
      const charter = await prisma.charter.findUnique({ where: { id: data.charter_id, is_deleted: false } });
      if (!charter) throw new ApiError('Charter not found', 404);
    }

    const created = await prisma.todayPick.create({
      data: {
        date: targetDate,
        item_type: data.item_type,
        arc_id: data.arc_id ?? null,
        task_id: data.task_id ?? null,
        session_external_id: data.session_external_id ?? null,
        charter_id: data.charter_id ?? null,
        label: data.label ?? null,
        sort: data.sort ?? 0,
      },
      include: PICK_INCLUDE,
    });

    const [shaped] = await shapeTodayPicks([created]);

    return NextResponse.json(shaped, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
