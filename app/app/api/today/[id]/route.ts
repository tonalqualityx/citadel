import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatTodayPickResponse } from '@/lib/api/formatters';
import { getArcStatus } from '@/lib/arc-status';
import { primaryActionKindForPick, type TodayPickItemType } from '@/lib/today-picks';

// PATCH: sort / completed_at / label only (Today picks don't get their type or ref
// re-pointed — dropping/re-adding is the "change what a pick is" path). DELETE removes the
// pick row only; it is never a delete of the underlying arc/task/session/charter.
const updatePickSchema = z.object({
  sort: z.number().int().optional(),
  completed_at: z.string().datetime().optional().nullable(),
  // Clarity Phase 4b — the Today board lens's Doing column, persisted so drag state
  // survives reload (was session-local before).
  started_at: z.string().datetime().optional().nullable(),
  label: z.string().max(300).optional().nullable(),
});

const PICK_INCLUDE = {
  arc: { include: { tasks: { select: { status: true } } } },
  task: { select: { id: true, title: true, status: true } },
  charter: { select: { id: true, name: true } },
} as const;

async function shapeOne(pick: any) {
  const arcSummary = pick.arc
    ? {
        id: pick.arc.id,
        name: pick.arc.name,
        status: getArcStatus(pick.arc),
        task_count: pick.arc.tasks.length,
      }
    : null;

  const sessionSummary = pick.session_external_id
    ? await prisma.oracleSession.findFirst({
        where: { external_id: pick.session_external_id },
        // Clarity Phase 4c — needs_attention/last_event_at feed the session-type pick
        // card's own quiet "waiting since <time>" line, same parity fix as /api/today.
        select: {
          external_id: true,
          title: true,
          status: true,
          remote_url: true,
          goal: true,
          needs_attention: true,
          last_event_at: true,
        },
      })
    : null;

  const primaryAction = {
    kind: primaryActionKindForPick(pick.item_type as TodayPickItemType, {
      hasRemoteUrl: !!sessionSummary?.remote_url,
    }),
  };

  return formatTodayPickResponse(pick, { arcSummary, sessionSummary, primaryAction });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const existing = await prisma.todayPick.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Today pick not found', 404);
    }

    const body = await request.json();
    const data = updatePickSchema.parse(body);

    const updated = await prisma.todayPick.update({
      where: { id },
      data: {
        ...(data.sort !== undefined && { sort: data.sort }),
        ...(data.completed_at !== undefined && {
          completed_at: data.completed_at === null ? null : new Date(data.completed_at),
        }),
        ...(data.started_at !== undefined && {
          started_at: data.started_at === null ? null : new Date(data.started_at),
        }),
        ...(data.label !== undefined && { label: data.label }),
      },
      include: PICK_INCLUDE,
    });

    return NextResponse.json(await shapeOne(updated));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const existing = await prisma.todayPick.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError('Today pick not found', 404);
    }

    // Removal is not deletion of the underlying arc/task/session/charter — only the pick
    // row (the day's commitment to it) goes away.
    await prisma.todayPick.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
