/**
 * Retainer months (design.md 2.6): the pure parts. No prisma in this file, so every rule here unit tests on its own.
 * Dates follow getMonthPeriod (lib/calculations/retainer.ts): the server's local calendar.
 */
import { getMonthPeriod } from '@/lib/calculations/retainer';
import { calculateEstimatedMinutes, energyToMinutes } from '@/lib/calculations/energy';
import type { BatteryImpact, MysteryFactor } from '@prisma/client';

import { hoursText, monthLabel, rangeText, monthName } from './format';
export { hoursText, monthLabel, rangeText, monthName };

export const MONTH_RE = /^(\d{4})-(\d{2})$/;
/** From this day of the month on, next month's plan is drafted. */
export const DRAFT_AHEAD_DAY = 25;
export const USED_THE_DRAFT = 'used the draft';

export function monthString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseMonth(month: string): { year: number; month: number } | null {
  const m = MONTH_RE.exec(month);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { year: Number(m[1]), month: mo - 1 };
}

export function monthPeriod(month: string): { start: Date; end: Date } {
  const p = parseMonth(month);
  if (!p) throw new Error(`Invalid month ${month}`);
  return getMonthPeriod(p.year, p.month);
}

export function shiftMonth(month: string, by: number): string {
  const p = parseMonth(month);
  if (!p) throw new Error(`Invalid month ${month}`);
  return monthString(new Date(p.year, p.month + by, 1));
}

// ---------------------------------------------------------------------------------------------------------
// Allotment and eligibility
// ---------------------------------------------------------------------------------------------------------

export interface CharterForMonth {
  id: string;
  status: string;
  is_deleted: boolean;
  billing_period: string;
  budget_hours: unknown; // Prisma Decimal | number | null
  client: { id: string; name: string; retainer_hours: unknown };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The charter's budget_hours, else the client's retainer_hours, else 0 (design.md 2.6). */
export function allotmentHours(charter: Pick<CharterForMonth, 'budget_hours' | 'client'>): number {
  const own = num(charter.budget_hours);
  if (own !== null && own > 0) return own;
  const fallback = num(charter.client?.retainer_hours);
  return fallback !== null && fallback > 0 ? fallback : 0;
}

/** Only active, non-deleted charters billed monthly get months. */
export function isEligibleCharter(charter: Pick<CharterForMonth, 'status' | 'is_deleted' | 'billing_period'>): boolean {
  return charter.status === 'active' && !charter.is_deleted && charter.billing_period === 'monthly';
}

// ---------------------------------------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------------------------------------

export interface EstimateSource {
  energy_estimate: number | null;
  mystery_factor: MysteryFactor | string;
  battery_impact: BatteryImpact | string | null;
  estimated_minutes: number | null;
}

/** A range, per the task estimation rule: low is the plain energy time, high adds the mystery and battery multipliers (as the retainer route does). */
export function estimateRange(src: EstimateSource): { low: number; high: number } {
  if (src.energy_estimate) {
    const low = energyToMinutes(src.energy_estimate);
    const high = calculateEstimatedMinutes(src.energy_estimate, src.mystery_factor as MysteryFactor, (src.battery_impact ?? 'average_drain') as BatteryImpact) ?? low;
    return { low, high: Math.max(low, high) };
  }
  if (src.estimated_minutes) return { low: Math.round(src.estimated_minutes * 0.7), high: src.estimated_minutes };
  return { low: 0, high: 0 };
}

export interface DraftItem {
  title: string;
  estimate_min_low: number;
  estimate_min_high: number;
  recurring_work_id: string | null;
  task_id: string | null;
  position: number;
}

export function totalRange(items: { estimate_min_low: number; estimate_min_high: number }[]): { low: number; high: number } {
  return items.reduce((a, i) => ({ low: a.low + i.estimate_min_low, high: a.high + i.estimate_min_high }), { low: 0, high: 0 });
}

/** Merge the three draft sources in order, dropping a later item that repeats an earlier task or recurring row, and number the positions. */
export function mergeDraftItems(groups: Omit<DraftItem, 'position'>[][]): DraftItem[] {
  const seenTask = new Set<string>();
  const seenRow = new Set<string>();
  const out: DraftItem[] = [];
  for (const g of groups) {
    for (const item of g) {
      if (item.task_id && seenTask.has(item.task_id)) continue;
      if (item.recurring_work_id && seenRow.has(item.recurring_work_id)) continue;
      if (item.task_id) seenTask.add(item.task_id);
      if (item.recurring_work_id) seenRow.add(item.recurring_work_id);
      out.push({ ...item, position: out.length });
    }
  }
  return out;
}

export function planningTaskTitle(clientName: string, month: string): string {
  return `${clientName}: plan ${monthLabel(month)} retainer work`;
}

export function planningTaskDescription(opts: { month: string; hours: number; items: { title: string; estimate_min_low: number; estimate_min_high: number }[] }): string {
  const total = totalRange(opts.items);
  const lines = [
    `${monthLabel(opts.month)}: ${opts.hours} h of retainer time.`,
    '',
    opts.items.length ? 'Drafted plan:' : 'Nothing is drafted for this month yet.',
    ...opts.items.map((i) => `- ${i.title}: ${rangeText(i.estimate_min_low, i.estimate_min_high)}`),
  ];
  if (opts.items.length) lines.push('', `Total: ${rangeText(total.low, total.high)} of ${opts.hours} h.`);
  lines.push(
    '',
    'This task is done with the "Use this plan" button on the retainer month, or by telling the chat the plan is fine. If nobody confirms by the 1st, the draft stands.',
    '',
    'Finalized by: a step Mike takes.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// The cycle's decisions
// ---------------------------------------------------------------------------------------------------------

export type CurrentMonthAction =
  | 'none'
  | 'draft_with_task' // no row yet and it is the 1st: draft it and make the planning task
  | 'draft_backfill' // no row yet and the 1st has passed: draft it already planned, no task
  | 'auto_plan'; // a row still in planning and the 1st has passed: the draft stands

export function decideCurrentMonth(now: Date, row: { state: string } | null): CurrentMonthAction {
  const pastFirst = now.getDate() > 1;
  if (!row) return pastFirst ? 'draft_backfill' : 'draft_with_task';
  if (row.state === 'planning' && pastFirst) return 'auto_plan';
  return 'none';
}

/** From the 25th on, next month is drafted for any charter that lacks one. */
export function shouldDraftNext(now: Date): boolean {
  return now.getDate() >= DRAFT_AHEAD_DAY;
}

/** A month before the current one that is not closed gets closed. */
export function shouldClose(row: { month: string; state: string }, currentMonth: string): boolean {
  return row.month < currentMonth && row.state !== 'closed';
}

// ---------------------------------------------------------------------------------------------------------
// Which minute counts toward which charter (design.md 2.6)
// ---------------------------------------------------------------------------------------------------------

export interface UsageEntry {
  minutes: number;
  task: { id: string; title: string; charter_id: string | null; is_retainer_work: boolean; recurring_work_id?: string | null };
}

export interface Attribution {
  counted: UsageEntry[];
  unassigned_minutes: number;
}

/**
 * In order: time on a task with this charter counts; time on a task with no charter that is retainer work counts when the client has exactly
 * one active monthly charter, and with two or more it is returned as unassigned_minutes instead; everything else (another charter's time,
 * other work) is not counted.
 */
export function attributeEntries(entries: UsageEntry[], charterId: string, clientActiveMonthlyCharters: number): Attribution {
  const counted: UsageEntry[] = [];
  let unassigned = 0;
  for (const e of entries) {
    if (e.task.charter_id === charterId) counted.push(e);
    else if (e.task.charter_id === null && e.task.is_retainer_work) {
      if (clientActiveMonthlyCharters === 1) counted.push(e);
      else if (clientActiveMonthlyCharters >= 2) unassigned += e.minutes;
    }
  }
  return { counted, unassigned_minutes: unassigned };
}

export interface UsageResult {
  used_minutes: number;
  outside_minutes: number;
  unassigned_minutes: number;
  item_minutes: Record<string, number>; // by item id
  outside: { id: string; title: string; minutes: number }[];
}

/**
 * Used per item and outside the plan, from the counted entries. A task belongs to an item when it is the item's task, or when the item
 * comes from a recurring row and the task was generated from that row (the generator may make it after the draft). A task on no item of
 * the month (and not the planning task) is outside the plan.
 */
export function usageFromCounted(
  counted: UsageEntry[],
  items: { id: string; task_id: string | null; recurring_work_id?: string | null }[],
  unassigned: number,
  planningTaskId: string | null = null,
): UsageResult {
  const byTaskId = new Map(items.filter((i) => i.task_id).map((i) => [i.task_id as string, i.id]));
  const byRow = new Map<string, string>();
  for (const i of items) if (i.recurring_work_id && !byRow.has(i.recurring_work_id)) byRow.set(i.recurring_work_id, i.id);
  const itemFor = (t: UsageEntry['task']): string | null =>
    byTaskId.get(t.id) ?? (t.recurring_work_id ? byRow.get(t.recurring_work_id) ?? null : null);

  let used = 0;
  const item_minutes: Record<string, number> = {};
  for (const i of items) item_minutes[i.id] = 0;
  const outsideByTask = new Map<string, { title: string; minutes: number }>();
  for (const e of counted) {
    used += e.minutes;
    const itemId = itemFor(e.task);
    if (itemId) item_minutes[itemId] += e.minutes;
    else if (e.task.id !== planningTaskId) {
      const cur = outsideByTask.get(e.task.id);
      if (cur) cur.minutes += e.minutes;
      else outsideByTask.set(e.task.id, { title: e.task.title, minutes: e.minutes });
    }
  }
  const outside = [...outsideByTask.entries()]
    .map(([id, v]) => ({ id, title: v.title, minutes: v.minutes }))
    .sort((a, b) => b.minutes - a.minutes);
  return { used_minutes: used, outside_minutes: outside.reduce((s, o) => s + o.minutes, 0), unassigned_minutes: unassigned, item_minutes, outside };
}

export function itemRangeError(low: number, high: number): string | null {
  return low > high ? 'estimate_min_low must not be more than estimate_min_high' : null;
}
