import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ROLLOVER_LOOKBACK_DAYS, ROLLOVER_MARKER_KIND, selectPicksToCarry } from '@/lib/today-rollover';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Carry the last working day's unfinished picks onto `today`, at most once per day.
 *
 * The once-per-day guarantee is the ritual_runs unique (date, kind) row: the marker is
 * CREATED first, so two concurrent Stone loads race on the unique constraint and only the
 * winner copies picks. A day that already has picks (the ritual or Mike got there first)
 * is stamped and left alone. Returns how many picks were carried.
 */
export async function rolloverTodayPicksIfNeeded(today: Date): Promise<number> {
  try {
    await prisma.ritualRun.create({
      data: { date: today, kind: ROLLOVER_MARKER_KIND, ran_at: new Date() },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return 0; // already rolled over today
    }
    throw error;
  }

  const existing = await prisma.todayPick.count({ where: { date: today } });
  if (existing > 0) return 0;

  const lastDay = await prisma.todayPick.findFirst({
    where: { date: { lt: today, gte: new Date(today.getTime() - ROLLOVER_LOOKBACK_DAYS * DAY_MS) } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  if (!lastDay) return 0;

  const prior = await prisma.todayPick.findMany({
    where: { date: lastDay.date },
    include: {
      arc: { select: { closed_at: true, tasks: { select: { status: true } } } },
      task: { select: { status: true } },
      accord: { select: { status: true } },
    },
    orderBy: [{ sort: 'asc' }, { created_at: 'asc' }],
  });

  const carry = selectPicksToCarry(prior);
  if (carry.length === 0) return 0;

  await prisma.todayPick.createMany({
    data: carry.map((p) => ({
      date: today,
      item_type: p.item_type,
      arc_id: p.arc_id,
      task_id: p.task_id,
      session_external_id: p.session_external_id,
      charter_id: p.charter_id,
      accord_id: p.accord_id,
      label: p.label,
      sort: p.sort,
      // Keep the Doing column: a pick Mike had started stays started.
      started_at: p.started_at,
    })),
  });
  return carry.length;
}
