import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ROLLOVER_LOOKBACK_DAYS, ROLLOVER_MARKER_KIND, selectPicksToCarry } from '@/lib/today-rollover';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Carry the last working day's unfinished picks onto `today`, at most once per day.
 *
 * The once-per-day guarantee is the ritual_runs unique (date, kind) row: the marker is
 * CREATED first, so two concurrent Stone loads race on the unique constraint and only the
 * winner copies picks. A day that already has picks (posted ahead by the ritual or by Mike)
 * is MERGED into, not skipped: yesterday's unfinished picks are appended after today's
 * existing ones, minus any that already point at the same arc/task/session/lead/note
 * (Mike, 2026-10-15: two picks posted for today a day early made the rollover skip the
 * Admin and Brian Hernon arcs; "Yesterday's picks need to be on today's board").
 * Returns how many picks were carried.
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

  const existing = await prisma.todayPick.findMany({
    where: { date: today },
    select: {
      item_type: true,
      arc_id: true,
      task_id: true,
      session_external_id: true,
      charter_id: true,
      accord_id: true,
      label: true,
      sort: true,
    },
  });

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

  const carry = selectPicksToCarry(prior).filter(
    (p) => !existing.some((e) => sameTarget(e, p))
  );
  if (carry.length === 0) return 0;

  const nextSort = existing.reduce((max, e) => Math.max(max, e.sort ?? -1), -1) + 1;

  await prisma.todayPick.createMany({
    data: carry.map((p, i) => ({
      date: today,
      item_type: p.item_type,
      arc_id: p.arc_id,
      task_id: p.task_id,
      session_external_id: p.session_external_id,
      charter_id: p.charter_id,
      accord_id: p.accord_id,
      label: p.label,
      sort: nextSort + i,
      // Keep the Doing column: a pick Mike had started stays started.
      started_at: p.started_at,
    })),
  });
  return carry.length;
}

interface PickTarget {
  item_type: string;
  arc_id: string | null;
  task_id: string | null;
  session_external_id: string | null;
  charter_id: string | null;
  accord_id: string | null;
  label: string | null;
}

/** Two picks point at the same thing: same type and same reference (notes compare by label). */
function sameTarget(a: PickTarget, b: PickTarget): boolean {
  if (a.item_type !== b.item_type) return false;
  switch (a.item_type) {
    case 'arc':
      return a.arc_id === b.arc_id;
    case 'task':
      return a.task_id === b.task_id;
    case 'session':
      return a.session_external_id === b.session_external_id;
    case 'lead':
      return a.accord_id === b.accord_id && a.charter_id === b.charter_id;
    default:
      return a.label === b.label;
  }
}
