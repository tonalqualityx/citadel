/**
 * History grouping (portal redesign, spec 7.8). Pure: takes the loaded history items and returns
 * month groups, newest first, with a summary sentence and counts by type and kind. Months are cut
 * in America/New_York, the same zone the retainer page uses. Months with no items are skipped.
 */
import type { ActivityType } from '@/lib/portal/status-labels';

export const HISTORY_TZ = 'America/New_York';

export type HistoryFilter = 'all' | 'site' | 'article' | 'approval' | 'cancelled';
export type HistoryKind = 'project' | 'retainer' | 'request';

export interface GroupableItem {
  id: string;
  type: ActivityType;
  /** ISO string or Date. */
  at: string | Date;
  /** Kind of the engagement, or null (articles carry none). */
  kind: HistoryKind | null;
  /** The site the item is about, when the payload says so. */
  site?: string | null;
}

export interface MonthGroupData<T extends GroupableItem> {
  key: string; // "2026-10"
  label: string; // "October 2026"
  /** Items that pass the filter, newest first. */
  items: T[];
  total: number;
  byType: Record<ActivityType, number>;
  byKind: Record<HistoryKind, number>;
  summary: string;
  isCurrent: boolean;
  /** The two newest months open. */
  defaultOpen: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function zonedParts(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: HISTORY_TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function monthKeyOf(at: string | Date): string | null {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const p = zonedParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

/** "Oct 20", in the client's zone. */
export function shortDate(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = zonedParts(d);
  return `${MONTHS[p.month - 1].slice(0, 3)} ${p.day}`;
}

export function matchesFilter(type: ActivityType, filter: HistoryFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'site') return type === 'task_completed';
  if (filter === 'article') return type === 'article_published';
  if (filter === 'cancelled') return type === 'task_cancelled';
  return type === 'task_approved';
}

export const EMPTY_MONTH_LINE = 'Nothing of this kind this month.';

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function summarize(byType: Record<ActivityType, number>, total: number): string {
  if (total === 0) return EMPTY_MONTH_LINE;
  const parts: string[] = [];
  if (byType.task_completed) parts.push(plural(byType.task_completed, 'site change', 'site changes'));
  if (byType.article_published) parts.push(plural(byType.article_published, 'article', 'articles'));
  if (byType.task_approved) parts.push(plural(byType.task_approved, 'approval', 'approvals'));
  const finished = total - byType.task_cancelled;
  if (byType.task_cancelled) parts.push(`${byType.task_cancelled} cancelled`);
  return finished > 0 ? `${finished} finished: ${parts.join(', ')}.` : `${parts.join(', ')}.`;
}

export interface GroupOptions {
  filter?: HistoryFilter;
  /** A site name, or null/undefined for all sites. Items with no known site stay in. */
  site?: string | null;
}

export function groupByMonth<T extends GroupableItem>(items: T[], now: Date, opts: GroupOptions = {}): MonthGroupData<T>[] {
  const filter = opts.filter ?? 'all';
  const site = opts.site ?? null;
  const nowKey = monthKeyOf(now);
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const key = monthKeyOf(it.at);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(it);
    else buckets.set(key, [it]);
  }
  const keys = Array.from(buckets.keys()).sort().reverse();
  return keys.map((key, index) => {
    const all = buckets.get(key) ?? [];
    const visible = all
      .filter((it) => matchesFilter(it.type, filter) && (site === null || !it.site || it.site === site))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const byType: Record<ActivityType, number> = { task_completed: 0, task_approved: 0, task_cancelled: 0, article_published: 0 };
    const byKind: Record<HistoryKind, number> = { project: 0, retainer: 0, request: 0 };
    for (const it of visible) {
      byType[it.type] += 1;
      byKind[it.kind ?? 'retainer'] += 1;
    }
    return {
      key,
      label: monthLabel(key),
      items: visible,
      total: visible.length,
      byType,
      byKind,
      summary: summarize(byType, visible.length),
      isCurrent: key === nowKey,
      defaultOpen: index < 2,
    };
  });
}
