import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTodayPickResponse } from '@/lib/api/formatters';
import { getArcStatus } from '@/lib/arc-status';
import { getZonedDateString } from '@/lib/utils/time';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import {
  validateTodayPickRef,
  isAtWipCap,
  primaryActionKindForPick,
  type TodayPickItemType,
} from '@/lib/today-picks';

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

const PICK_INCLUDE = {
  arc: { include: { tasks: { select: { status: true } } } },
  task: { select: { id: true, title: true, status: true } },
  charter: { select: { id: true, name: true } },
} as const;

function parseDateParam(dateStr: string | null, timezone: string): Date {
  const raw = dateStr && DATE_RE.test(dateStr) ? dateStr : getZonedDateString(new Date(), timezone);
  return new Date(`${raw}T00:00:00.000Z`);
}

/** Attach the per-type joined summary + derived primary action a Today card needs to render. */
async function shapePicks(picks: Awaited<ReturnType<typeof fetchPicksForDate>>) {
  const sessionIds = Array.from(
    new Set(picks.filter((p) => p.item_type === 'session' && p.session_external_id).map((p) => p.session_external_id as string))
  );

  const sessions = sessionIds.length
    ? await prisma.oracleSession.findMany({
        where: { external_id: { in: sessionIds } },
        select: { external_id: true, title: true, status: true, remote_url: true, goal: true },
      })
    : [];
  const sessionByExternalId = new Map(sessions.map((s) => [s.external_id, s]));

  return picks.map((pick) => {
    const arcSummary = pick.arc
      ? {
          id: pick.arc.id,
          name: pick.arc.name,
          status: getArcStatus(pick.arc),
          task_count: pick.arc.tasks.length,
        }
      : null;

    const sessionSummary = pick.session_external_id
      ? sessionByExternalId.get(pick.session_external_id) ?? null
      : null;

    const primaryAction = {
      kind: primaryActionKindForPick(pick.item_type as TodayPickItemType, {
        hasRemoteUrl: !!sessionSummary?.remote_url,
      }),
    };

    return formatTodayPickResponse(pick, {
      arcSummary,
      sessionSummary: sessionSummary
        ? {
            external_id: sessionSummary.external_id,
            title: sessionSummary.title,
            status: sessionSummary.status,
            remote_url: sessionSummary.remote_url,
            goal: sessionSummary.goal,
          }
        : null,
      primaryAction,
    });
  });
}

function fetchPicksForDate(date: Date) {
  return prisma.todayPick.findMany({
    where: { date },
    include: PICK_INCLUDE,
    orderBy: [{ sort: 'asc' }, { created_at: 'asc' }],
  });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const timezone = await resolveUserTimezone(auth.userId);
    const { searchParams } = new URL(request.url);
    const targetDate = parseDateParam(searchParams.get('date'), timezone);

    const picks = await fetchPicksForDate(targetDate);
    const shaped = await shapePicks(picks);

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

    const [shaped] = await shapePicks([created]);

    return NextResponse.json(shaped, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
