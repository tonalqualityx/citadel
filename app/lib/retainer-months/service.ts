/**
 * Retainer months (design.md 2.6): the prisma side. Pure rules live in ./helpers.
 * The charter is the retainer; a month is one row per charter per "YYYY-MM".
 */
import { Prisma, type RetainerMonth, type RetainerMonthItem } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { serializeRichText } from '@/lib/api/blocknote';
import { closeAsksForTask } from '@/lib/work/ask-closure'; // Work stage A: the one closure of a finished task's emails
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import {
  USED_THE_DRAFT,
  allotmentHours,
  attributeEntries,
  decideCurrentMonth,
  estimateRange,
  isEligibleCharter,
  itemRangeError,
  mergeDraftItems,
  monthPeriod,
  monthString,
  parseMonth,
  planningTaskDescription,
  planningTaskTitle,
  shiftMonth,
  shouldClose,
  shouldDraftNext,
  usageFromCounted,
  type CharterForMonth,
  type DraftItem,
  type UsageEntry,
  type UsageResult,
} from './helpers';

export const OPEN_TASK_STATUSES = ['done', 'abandoned', 'triage'] as const;

export const CHARTER_INCLUDE = {
  client: { select: { id: true, name: true, retainer_hours: true } },
  scheduled_tasks: { where: { is_active: true, kind: 'citadel_task' as const }, include: { sop: true }, orderBy: { sort_order: 'asc' as const } },
} satisfies Prisma.CharterInclude;
export type CharterWithRows = Prisma.CharterGetPayload<{ include: typeof CHARTER_INCLUDE }>;

export const MONTH_INCLUDE = {
  items: { orderBy: [{ position: 'asc' as const }, { created_at: 'asc' as const }] },
  charter: { include: { client: { select: { id: true, name: true, retainer_hours: true } } } },
} satisfies Prisma.RetainerMonthInclude;
export type MonthWithItems = Prisma.RetainerMonthGetPayload<{ include: typeof MONTH_INCLUDE }>;

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

export const itemCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    estimate_min_low: z.number().int().min(0),
    estimate_min_high: z.number().int().min(0),
    task_id: z.string().uuid().nullable().optional(),
    recurring_work_id: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict();
export const itemUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    estimate_min_low: z.number().int().min(0).optional(),
    estimate_min_high: z.number().int().min(0).optional(),
    task_id: z.string().uuid().nullable().optional(),
    recurring_work_id: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict();

export async function eligibleCharters(): Promise<CharterWithRows[]> {
  return prisma.charter.findMany({
    where: { status: 'active', is_deleted: false, billing_period: 'monthly' },
    include: CHARTER_INCLUDE,
    orderBy: { name: 'asc' },
  });
}

// ---------------------------------------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------------------------------------

async function draftItems(charter: CharterWithRows, month: string): Promise<DraftItem[]> {
  const period = monthPeriod(month);

  // 1. each active citadel_task recurring row; its task for this month when the generator has made one
  const rows = charter.scheduled_tasks.filter((r) => r.is_active && r.kind === 'citadel_task');
  const rowTasks = rows.length
    ? await prisma.task.findMany({
        where: { recurring_work_id: { in: rows.map((r) => r.id) }, maintenance_period: month, is_deleted: false },
        select: { id: true, recurring_work_id: true },
      })
    : [];
  const fromRows = rows.map((r) => ({
    title: (r.title ?? r.sop?.title ?? 'Recurring work').slice(0, 200),
    ...(() => {
      const e = r.sop ? estimateRange(r.sop) : { low: 0, high: 0 };
      return { estimate_min_low: e.low, estimate_min_high: e.high };
    })(),
    recurring_work_id: r.id,
    task_id: rowTasks.find((t) => t.recurring_work_id === r.id)?.id ?? null,
  }));

  // 2. open tasks of this charter due in the month (and retainer-work tasks of a client with exactly one monthly charter)
  const siblings = await prisma.charter.count({
    where: { client_id: charter.client_id, status: 'active', is_deleted: false, billing_period: 'monthly' },
  });
  const dueTasks = await prisma.task.findMany({
    where: {
      is_deleted: false,
      status: { notIn: [...OPEN_TASK_STATUSES] },
      due_date: { gte: period.start, lte: period.end },
      OR: [
        { charter_id: charter.id },
        ...(siblings === 1 ? [{ charter_id: null, is_retainer_work: true, OR: [{ client_id: charter.client_id }, { project: { client_id: charter.client_id } }] }] : []),
      ],
    },
    select: { id: true, title: true, energy_estimate: true, mystery_factor: true, battery_impact: true, estimated_minutes: true, recurring_work_id: true },
    orderBy: { due_date: 'asc' },
  });
  const fromTasks = dueTasks.map((t) => {
    const e = estimateRange(t);
    return { title: t.title.slice(0, 200), estimate_min_low: e.low, estimate_min_high: e.high, recurring_work_id: t.recurring_work_id, task_id: t.id };
  });

  // 3. last month's items whose task is not done
  const last = await prisma.retainerMonth.findUnique({
    where: { charter_id_month: { charter_id: charter.id, month: shiftMonth(month, -1) } },
    include: { items: { include: { task: { select: { id: true, status: true, is_deleted: true } } } } },
  });
  // An item with an open task is undone; so is named work that never got a task (a recurring item with no task comes back
  // from its row above, so it is not carried twice).
  const carried = (last?.items ?? [])
    .filter((i) =>
      i.task
        ? !i.task.is_deleted && !['done', 'abandoned'].includes(i.task.status)
        : !i.task_id && !i.recurring_work_id)
    .map((i) => ({ title: i.title, estimate_min_low: i.estimate_min_low, estimate_min_high: i.estimate_min_high, recurring_work_id: i.recurring_work_id, task_id: i.task_id }));

  return mergeDraftItems([fromRows, fromTasks, carried]);
}

export interface DraftOptions {
  /** Make the planning task (a month drafted ahead, or the current month drafted on the 1st). */
  planningTask: boolean;
  /** Create the month already planned, "used the draft" (a current month drafted after its 1st). */
  usedTheDraft?: boolean;
  now?: Date;
}

/** Draft one charter's month. Idempotent: the unique (charter, month) key means a second call changes nothing. */
export async function draftMonth(
  charter: CharterWithRows,
  month: string,
  opts: DraftOptions,
): Promise<{ created: boolean; planningTask: boolean; month: RetainerMonth | null }> {
  if (!parseMonth(month)) throw new ApiError('month must be YYYY-MM', 400);
  const now = opts.now ?? new Date();
  const existing = await prisma.retainerMonth.findUnique({ where: { charter_id_month: { charter_id: charter.id, month } } });
  if (existing) return { created: false, planningTask: false, month: existing };

  const items = await draftItems(charter, month);
  const hours = allotmentHours(charter);
  const makeTask = opts.planningTask && !opts.usedTheDraft;

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.retainerMonth.create({
        data: {
          charter_id: charter.id,
          month,
          hours_allotted: hours,
          state: opts.usedTheDraft ? 'planned' : 'planning',
          ...(opts.usedTheDraft ? { planned_at: now, note: USED_THE_DRAFT } : {}),
        },
      });
      if (items.length) {
        await tx.retainerMonthItem.createMany({ data: items.map((i) => ({ ...i, retainer_month_id: row.id })) });
      }
      let withTask = row;
      if (makeTask) {
        const p = monthPeriod(month);
        const task = await tx.task.create({
          data: {
            title: planningTaskTitle(charter.client.name, month),
            description: serializeRichText(planningTaskDescription({ month, hours, items })),
            status: 'not_started',
            priority: 3,
            client_id: charter.client_id,
            charter_id: charter.id,
            assignee_id: MIKE_USER_ID,
            due_date: p.start,
            is_billable: false,
            is_retainer_work: false,
            energy_estimate: 1,
            mystery_factor: 'none',
            battery_impact: 'energizing',
            estimated_minutes: 15,
          },
        });
        withTask = await tx.retainerMonth.update({ where: { id: row.id }, data: { planning_task_id: task.id } });
      }
      return { created: true, planningTask: makeTask, month: withTask };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { created: false, planningTask: false, month: null };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------------------------------

export interface MonthUsage extends UsageResult {
  frozen: boolean;
}

/** Used against the allotment for one month, by the charter-attribution rule (design.md 2.6). A closed month returns its frozen totals. */
export async function monthUsage(month: MonthWithItems): Promise<MonthUsage> {
  const period = monthPeriod(month.month);
  const charterId = month.charter_id;
  const clientId = month.charter.client_id;
  const siblings = await prisma.charter.count({
    where: { client_id: clientId, status: 'active', is_deleted: false, billing_period: 'monthly' },
  });
  const rows = await prisma.timeEntry.findMany({
    where: {
      is_deleted: false,
      started_at: { gte: period.start, lte: period.end },
      task: {
        is_deleted: false,
        OR: [
          { charter_id: charterId },
          { charter_id: null, is_retainer_work: true, OR: [{ client_id: clientId }, { project: { client_id: clientId } }] },
        ],
      },
    },
    select: { duration: true, task: { select: { id: true, title: true, charter_id: true, is_retainer_work: true, recurring_work_id: true } } },
  });
  const entries: UsageEntry[] = rows.filter((r) => r.task).map((r) => ({ minutes: r.duration || 0, task: r.task! }));
  const { counted, unassigned_minutes } = attributeEntries(entries, charterId, siblings);
  const live = usageFromCounted(counted, month.items, unassigned_minutes, month.planning_task_id);
  if (month.state === 'closed' && month.used_minutes !== null && month.outside_minutes !== null) {
    return { ...live, used_minutes: month.used_minutes, outside_minutes: month.outside_minutes, frozen: true };
  }
  return { ...live, frozen: false };
}

// ---------------------------------------------------------------------------------------------------------
// Confirm and items
// ---------------------------------------------------------------------------------------------------------

export async function loadMonth(id: string): Promise<MonthWithItems> {
  const row = await prisma.retainerMonth.findUnique({ where: { id }, include: MONTH_INCLUDE });
  if (!row) throw new ApiError('Retainer month not found', 404);
  return row;
}

function refuseClosed(m: { state: string }): void {
  if (m.state === 'closed') throw new ApiError('This month is closed; its plan can no longer change', 409);
}

/** Mark a month's planning task done if it is still open, through the one closure of a finished task's emails. */
async function closePlanningTask(taskId: string, now: Date): Promise<void> {
  const r = await prisma.task.updateMany({
    where: { id: taskId, status: { notIn: ['done', 'abandoned'] } },
    data: { status: 'done', completed_at: now },
  });
  if (r.count > 0) await closeAsksForTask(prisma, taskId, 'done'); // Work stage A
}

/** "Use this plan": the month is planned, and its planning task is done if still open. */
export async function confirmMonth(id: string, userId: string, now: Date = new Date()): Promise<RetainerMonth> {
  const month = await prisma.retainerMonth.findUnique({ where: { id } });
  if (!month) throw new ApiError('Retainer month not found', 404);
  refuseClosed(month);
  const updated = await prisma.retainerMonth.update({
    where: { id },
    data: { state: 'planned', planned_at: now, planned_by_id: userId, note: null },
  });
  if (month.planning_task_id) await closePlanningTask(month.planning_task_id, now);
  return updated;
}

export async function addItem(monthId: string, input: z.infer<typeof itemCreateSchema>): Promise<RetainerMonthItem> {
  const month = await prisma.retainerMonth.findUnique({ where: { id: monthId }, include: { items: { select: { position: true } } } });
  if (!month) throw new ApiError('Retainer month not found', 404);
  refuseClosed(month);
  const err = itemRangeError(input.estimate_min_low, input.estimate_min_high);
  if (err) throw new ApiError(err, 400);
  const position = input.position ?? month.items.reduce((m, i) => Math.max(m, i.position + 1), 0);
  return prisma.retainerMonthItem.create({
    data: {
      retainer_month_id: monthId,
      title: input.title,
      estimate_min_low: input.estimate_min_low,
      estimate_min_high: input.estimate_min_high,
      task_id: input.task_id ?? null,
      recurring_work_id: input.recurring_work_id ?? null,
      position,
    },
  });
}

async function loadItem(monthId: string, itemId: string) {
  const item = await prisma.retainerMonthItem.findUnique({ where: { id: itemId }, include: { retainer_month: true } });
  if (!item || item.retainer_month_id !== monthId) throw new ApiError('Item not found', 404);
  refuseClosed(item.retainer_month);
  return item;
}

export async function updateItem(monthId: string, itemId: string, input: z.infer<typeof itemUpdateSchema>): Promise<RetainerMonthItem> {
  const item = await loadItem(monthId, itemId);
  const low = input.estimate_min_low ?? item.estimate_min_low;
  const high = input.estimate_min_high ?? item.estimate_min_high;
  const err = itemRangeError(low, high);
  if (err) throw new ApiError(err, 400);
  return prisma.retainerMonthItem.update({ where: { id: itemId }, data: input });
}

export async function removeItem(monthId: string, itemId: string): Promise<void> {
  await loadItem(monthId, itemId);
  await prisma.retainerMonthItem.delete({ where: { id: itemId } });
}

// ---------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------

export interface MonthView {
  id: string;
  charter_id: string;
  charter_name: string;
  client_id: string;
  client_name: string;
  month: string;
  state: string;
  hours_allotted: number;
  planning_task_id: string | null;
  created_at: string;
  planned_at: string | null;
  planned_by_id: string | null;
  note: string | null;
  used_minutes: number;
  outside_minutes: number;
  unassigned_minutes: number;
  frozen: boolean;
  outside: { id: string; title: string; minutes: number }[];
  items: {
    id: string;
    title: string;
    estimate_min_low: number;
    estimate_min_high: number;
    task_id: string | null;
    recurring_work_id: string | null;
    position: number;
    used_minutes: number;
  }[];
}

export async function viewMonth(month: MonthWithItems): Promise<MonthView> {
  const usage = await monthUsage(month);
  return {
    id: month.id,
    charter_id: month.charter_id,
    charter_name: month.charter.name,
    client_id: month.charter.client_id,
    client_name: month.charter.client.name,
    month: month.month,
    state: month.state,
    hours_allotted: Number(month.hours_allotted),
    planning_task_id: month.planning_task_id,
    created_at: month.created_at.toISOString(),
    planned_at: month.planned_at ? month.planned_at.toISOString() : null,
    planned_by_id: month.planned_by_id,
    note: month.note,
    used_minutes: usage.used_minutes,
    outside_minutes: usage.outside_minutes,
    unassigned_minutes: usage.unassigned_minutes,
    frozen: usage.frozen,
    outside: usage.outside,
    items: month.items.map((i) => ({
      id: i.id,
      title: i.title,
      estimate_min_low: i.estimate_min_low,
      estimate_min_high: i.estimate_min_high,
      task_id: i.task_id,
      recurring_work_id: i.recurring_work_id,
      position: i.position,
      used_minutes: usage.item_minutes[i.id] ?? 0,
    })),
  };
}

/** One month's rows for every eligible charter, as views, by client name. */
async function monthViews(month: string): Promise<MonthView[]> {
  const rows = await prisma.retainerMonth.findMany({
    where: { month, charter: { status: 'active', is_deleted: false, billing_period: 'monthly' } },
    include: MONTH_INCLUDE,
    orderBy: { created_at: 'asc' },
  });
  const views = await Promise.all(rows.map(viewMonth));
  views.sort((a, b) => a.client_name.localeCompare(b.client_name));
  return views;
}

/**
 * Every eligible charter's month for one month; a current or past month with no row shows as not drafted (the cycle drafts it).
 * `upcoming` is the following month's rows (drafted from the 25th), so a plan waiting to be confirmed shows before its month starts.
 */
export async function listMonths(month: string): Promise<{ month: string; retainers: MonthView[]; upcoming: MonthView[] }> {
  const [retainers, upcoming] = await Promise.all([monthViews(month), monthViews(shiftMonth(month, 1))]);
  return { month, retainers, upcoming };
}

export interface PastMonthLine {
  id: string;
  month: string;
  state: string;
  hours_allotted: number;
  used_minutes: number;
  outside_minutes: number;
}

/** A charter's current month in full and its past months as data for one line each. */
export async function charterMonths(charterId: string, now: Date = new Date()): Promise<{ current: MonthView | null; upcoming: MonthView | null; past: PastMonthLine[] }> {
  const currentKey = monthString(now);
  const nextKey = shiftMonth(currentKey, 1);
  const rows = await prisma.retainerMonth.findMany({ where: { charter_id: charterId }, include: MONTH_INCLUDE, orderBy: { month: 'desc' } });
  const currentRow = rows.find((r) => r.month === currentKey) ?? null;
  const pastRows = rows.filter((r) => r.month < currentKey);
  const past = await Promise.all(
    pastRows.map(async (r) => {
      const u = await monthUsage(r);
      return { id: r.id, month: r.month, state: r.state, hours_allotted: Number(r.hours_allotted), used_minutes: u.used_minutes, outside_minutes: u.outside_minutes };
    }),
  );
  const nextRow = rows.find((r) => r.month === nextKey) ?? null;
  return { current: currentRow ? await viewMonth(currentRow) : null, upcoming: nextRow ? await viewMonth(nextRow) : null, past };
}

// ---------------------------------------------------------------------------------------------------------
// The cycle (cron)
// ---------------------------------------------------------------------------------------------------------

export interface CycleSummary {
  drafted: number;
  planningTasks: number;
  autoPlanned: number;
  closed: number;
  errors: string[];
}

export async function runRetainerMonthCycle(now: Date = new Date()): Promise<CycleSummary> {
  const summary: CycleSummary = { drafted: 0, planningTasks: 0, autoPlanned: 0, closed: 0, errors: [] };
  const current = monthString(now);
  const next = shiftMonth(current, 1);

  let charters: CharterWithRows[] = [];
  try {
    charters = (await eligibleCharters()).filter((c) => isEligibleCharter(c as unknown as CharterForMonth));
  } catch (e) {
    summary.errors.push(`list charters: ${(e as Error).message}`);
  }

  for (const charter of charters) {
    try {
      const existing = await prisma.retainerMonth.findMany({ where: { charter_id: charter.id, month: { in: [current, next] } } });
      const cur = existing.find((m) => m.month === current) ?? null;
      const action = decideCurrentMonth(now, cur);

      if (action === 'draft_with_task' || action === 'draft_backfill') {
        const r = await draftMonth(charter, current, { planningTask: action === 'draft_with_task', usedTheDraft: action === 'draft_backfill', now });
        if (r.created) summary.drafted += 1;
        if (r.planningTask) summary.planningTasks += 1;
      } else if (action === 'auto_plan' && cur) {
        await prisma.retainerMonth.update({ where: { id: cur.id }, data: { state: 'planned', planned_at: now, planned_by_id: null, note: USED_THE_DRAFT } });
        // The draft stands, so the planning step is no longer anyone's to take: close its task.
        if (cur.planning_task_id) await closePlanningTask(cur.planning_task_id, now);
        summary.autoPlanned += 1;
      }

      if (shouldDraftNext(now) && !existing.some((m) => m.month === next)) {
        const r = await draftMonth(charter, next, { planningTask: true, now });
        if (r.created) summary.drafted += 1;
        if (r.planningTask) summary.planningTasks += 1;
      }
    } catch (e) {
      summary.errors.push(`${charter.name}: ${(e as Error).message}`);
    }
  }

  // Months before the current one that are not closed: freeze their numbers (any charter, eligible or not)
  try {
    const stale = await prisma.retainerMonth.findMany({ where: { month: { lt: current }, state: { not: 'closed' } }, include: MONTH_INCLUDE });
    for (const row of stale.filter((r) => shouldClose(r, current))) {
      try {
        const u = await monthUsage(row);
        await prisma.retainerMonth.update({ where: { id: row.id }, data: { state: 'closed', used_minutes: u.used_minutes, outside_minutes: u.outside_minutes } });
        summary.closed += 1;
      } catch (e) {
        summary.errors.push(`close ${row.month} ${row.charter.name}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    summary.errors.push(`close months: ${(e as Error).message}`);
  }

  return summary;
}
