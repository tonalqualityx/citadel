/**
 * The Initiatives screen's one read (design.md 3.1): every initiative with what the screen shows at a glance, in the
 * order the screen focuses them, plus the count line.
 *
 * The pure helpers (check due, stop check due, focus order) take a clock and no database, so they are tested alone.
 * `loadInitiativeBoard` does the reads: initiatives with fresh health, the last 12 readings of each number, what is
 * attached (projects, recurring work, tasks) and this quarter's rocks.
 */
import { prisma } from '@/lib/db/prisma';
import { formatInitiativeResponse } from '@/lib/api/formatters';
import { currentQuarter, rockDecisionLine, rockStatus, type RockStatus } from '@/lib/milestones/rock';
import { numberPace, type NumberPace } from './health';
import { INITIATIVE_INCLUDE, withFreshHealth } from './service';

/** Points in a number's trend line. */
export const SPARK_POINTS = 12;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface CheckShape {
  status: string;
  check_date: Date | string | null;
  stop_condition?: string | null;
  latest_check_in?: { created_at: Date | string } | null;
}

/**
 * The check date has come (today or earlier) and nobody has checked in since it. Only an active initiative is due:
 * a proposed, paused or closed one asks nothing of Mike.
 */
export function isCheckDue(i: CheckShape, now: Date): boolean {
  if (i.status !== 'active' || !i.check_date) return false;
  const check = utcDay(new Date(i.check_date));
  if (check > utcDay(now)) return false;
  if (!i.latest_check_in) return true;
  return new Date(i.latest_check_in.created_at).getTime() < check;
}

interface StopShape extends CheckShape {
  numbers: { label?: string; target_by: Date | string; pace: NumberPace }[];
}

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).map((w) => w.replace(/s$/, ''));

/**
 * The numbers a written stop condition names ("Fewer than 2 builds signed by Mar 31" names "ADA builds signed"): a label is
 * named when each of its words of four letters or more appears in the condition (plural or not); a label with no such word
 * must appear whole. Every number when it names none.
 */
export function stopNumbers<N extends { label?: string }>(stopCondition: string, numbers: N[]): N[] {
  const text = new Set(words(stopCondition));
  const named = numbers.filter((n) => {
    const label = n.label?.trim();
    if (!label) return false;
    const long = words(label).filter((w) => w.length >= 4);
    return long.length ? long.every((w) => text.has(w)) : stopCondition.toLowerCase().includes(label.toLowerCase());
  });
  return named.length ? named : numbers;
}

/**
 * The stop condition can be judged: it is written, every number it names (by label; every number when it names none) has
 * reached its target date, at least one of them missed its target, and Mike has not checked in since the last of those
 * dates. Then the screen puts the written condition to Mike with Keep going and Stop it; a check-in (Keep going) clears it.
 * The condition itself is free text Mike wrote, so Mike judges it; the screen only says when it is time to.
 */
export function isStopCheckDue(i: StopShape, now: Date): boolean {
  if (i.status !== 'active' || !i.stop_condition?.trim() || i.numbers.length === 0) return false;
  const governing = stopNumbers(i.stop_condition, i.numbers);
  const today = utcDay(now);
  const last = Math.max(...governing.map((n) => utcDay(new Date(n.target_by))));
  if (last > today) return false;
  if (governing.every((n) => n.pace === 'met')) return false;
  const checkedAt = i.latest_check_in ? new Date(i.latest_check_in.created_at).getTime() : -Infinity;
  return checkedAt < last;
}

interface FocusShape extends CheckShape {
  id: string;
  health: string;
  sort_order: number;
  decision_waiting?: boolean;
}

/**
 * The order the screen focuses active initiatives (design.md 3.1): a decision waiting (a passed check date nobody has
 * checked in on, a stop condition to judge, or a rock waiting on Mike) first, then behind, then the rest; within each, the soonest check date
 * first, then Mike's own sort order.
 */
export function focusOrder<T extends FocusShape>(items: T[], now: Date): T[] {
  const rank = (i: T) => {
    if (isCheckDue(i, now) || i.decision_waiting) return 0;
    if (i.health === 'behind') return 1;
    return 2;
  };
  const checkKey = (i: T) => (i.check_date ? utcDay(new Date(i.check_date)) : Number.MAX_SAFE_INTEGER);
  return [...items].sort((a, b) => rank(a) - rank(b) || checkKey(a) - checkKey(b) || a.sort_order - b.sort_order);
}

export interface BoardRock {
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  target_date: Date | null;
  rock_quarter: string;
  rock_done_when: string | null;
  rock_status: RockStatus;
  rock_decision: string | null;
}

export interface BoardAttached {
  projects: { id: string; name: string; status: string }[];
  recurring: { id: string; title: string; is_active: boolean }[];
  tasks: { id: string; title: string; status: string }[];
}

type FormattedInitiative = ReturnType<typeof formatInitiativeResponse>;

export type BoardNumber = FormattedInitiative['numbers'][number] & {
  pace: NumberPace;
  expected: number | null;
  readings: { value: number; read_at: Date }[];
};

export type BoardInitiative = Omit<FormattedInitiative, 'numbers'> & {
  numbers: BoardNumber[];
  attached: BoardAttached;
  attached_count: number;
  rocks: BoardRock[];
  check_due: boolean;
  stop_check_due: boolean;
  decision_waiting: boolean;
};

/** A rock on the count line's list: every rock this quarter, attached to an initiative or not. */
export type QuarterRock = BoardRock & { initiative_id: string | null };

export interface InitiativeBoard {
  quarter: string;
  summary: {
    active: number;
    decisions_waiting: number;
    rocks_this_quarter: number;
    rocks_off_track: number;
    proposed: number;
    paused: number;
    closed: number;
  };
  /** The initiative the screen opens on: the first active one in focus order, else the first of the rest. */
  focus_id: string | null;
  /** Active ones in focus order, then proposed, paused and closed (newest first within each). */
  initiatives: BoardInitiative[];
  /** Every rock this quarter, so the count line's rock count opens all of them (a rock on an unattached project too). */
  quarter_rocks: QuarterRock[];
}

const QUIET_ORDER: Record<string, number> = { proposed: 0, paused: 1, done: 2, stopped: 2 };

/** Every rock of a quarter across Citadel, with its derived status. */
async function rocksForQuarter(quarter: string, now: Date) {
  const milestones = await prisma.milestone.findMany({
    where: { rock_quarter: quarter, project: { is_deleted: false } },
    select: {
      id: true,
      name: true,
      project_id: true,
      target_date: true,
      completed_at: true,
      rock_quarter: true,
      rock_done_when: true,
      project: {
        select: { name: true, initiative_id: true, next_step_text: true, next_step_owner_id: true, next_step_at: true },
      },
    },
    orderBy: [{ target_date: 'asc' }, { sort_order: 'asc' }],
  });
  return milestones.map((m) => ({
    initiative_id: m.project.initiative_id,
    rock: {
      id: m.id,
      name: m.name,
      project_id: m.project_id,
      project_name: m.project.name,
      target_date: m.target_date,
      rock_quarter: m.rock_quarter as string,
      rock_done_when: m.rock_done_when,
      rock_status: rockStatus(m, now, m.project) as RockStatus,
      rock_decision: rockDecisionLine(m, now, m.project),
    } satisfies BoardRock,
  }));
}

export async function loadInitiativeBoard(now: Date = new Date()): Promise<InitiativeBoard> {
  const quarter = currentQuarter(now);
  const rows = await prisma.initiative.findMany({
    where: { is_deleted: false },
    include: INITIATIVE_INCLUDE,
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  const fresh = await Promise.all(rows.map((r) => withFreshHealth(r, now)));
  const ids = fresh.map((i) => i.id);
  const numberIds = fresh.flatMap((i) => i.numbers.map((n) => n.id));

  const [readings, projects, recurring, tasks, rocks] = await Promise.all([
    numberIds.length
      ? prisma.initiativeReading.findMany({
          where: { number_id: { in: numberIds } },
          select: { number_id: true, value: true, read_at: true },
          orderBy: { read_at: 'desc' },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.project.findMany({
          where: { initiative_id: { in: ids }, is_deleted: false },
          select: { id: true, name: true, status: true, initiative_id: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.recurringWork.findMany({
          where: { initiative_id: { in: ids } },
          select: { id: true, title: true, is_active: true, initiative_id: true, sop: { select: { title: true } } },
          orderBy: { sort_order: 'asc' },
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.task.findMany({
          where: { initiative_id: { in: ids }, is_deleted: false },
          select: { id: true, title: true, status: true, initiative_id: true },
          orderBy: { created_at: 'asc' },
        })
      : Promise.resolve([]),
    rocksForQuarter(quarter, now),
  ]);

  const readingsByNumber = new Map<string, { value: number; read_at: Date }[]>();
  for (const r of readings) {
    const list = readingsByNumber.get(r.number_id) ?? [];
    if (list.length < SPARK_POINTS) list.push({ value: Number(r.value.toString()), read_at: r.read_at });
    readingsByNumber.set(r.number_id, list);
  }

  const items: BoardInitiative[] = fresh.map((row) => {
    const base = formatInitiativeResponse(row);
    const attached: BoardAttached = {
      projects: projects.filter((p) => p.initiative_id === row.id).map(({ id, name, status }) => ({ id, name, status })),
      recurring: recurring
        .filter((r) => r.initiative_id === row.id)
        .map((r) => ({ id: r.id, title: r.title ?? r.sop?.title ?? 'Recurring work', is_active: r.is_active })),
      tasks: tasks.filter((t) => t.initiative_id === row.id).map(({ id, title, status }) => ({ id, title, status })),
    };
    const ownRocks = rocks.filter((r) => r.initiative_id === row.id).map((r) => r.rock);
    const numbers: BoardNumber[] = base.numbers.map((n, index) => {
      const pace = numberPace(row.numbers[index], now);
      return { ...n, pace: pace.pace, expected: pace.expected, readings: (readingsByNumber.get(n.id) ?? []).reverse() };
    });
    const check_due = isCheckDue(base, now);
    const stop_check_due = isStopCheckDue({ ...base, numbers }, now);
    const rockWaits = base.status === 'active' && ownRocks.some((r) => !!r.rock_decision);
    return {
      ...base,
      numbers,
      attached,
      attached_count: attached.projects.length + attached.recurring.length + attached.tasks.length,
      rocks: ownRocks,
      check_due,
      stop_check_due,
      decision_waiting: check_due || stop_check_due || rockWaits,
    };
  });

  const active = focusOrder(items.filter((i) => i.status === 'active'), now);
  const quiet = items
    .filter((i) => i.status !== 'active')
    .sort(
      (a, b) =>
        (QUIET_ORDER[a.status] ?? 3) - (QUIET_ORDER[b.status] ?? 3) ||
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  const ordered = [...active, ...quiet];

  return {
    quarter,
    summary: {
      active: active.length,
      decisions_waiting: active.filter((i) => i.decision_waiting).length,
      rocks_this_quarter: rocks.length,
      rocks_off_track: rocks.filter((r) => r.rock.rock_status === 'off_track').length,
      proposed: items.filter((i) => i.status === 'proposed').length,
      paused: items.filter((i) => i.status === 'paused').length,
      closed: items.filter((i) => i.status === 'done' || i.status === 'stopped').length,
    },
    focus_id: ordered[0]?.id ?? null,
    initiatives: ordered,
    quarter_rocks: rocks.map((r) => ({ ...r.rock, initiative_id: r.initiative_id })),
  };
}
