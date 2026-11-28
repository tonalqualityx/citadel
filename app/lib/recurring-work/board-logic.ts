import type { RecurringWorkItem } from '@/types/entities';

export type RecurringSort = 'default' | 'usage' | 'last_run';

const DAY_MS = 24 * 60 * 60 * 1000;
export const UNUSED_AFTER_DAYS = 30;

const DESTINATION_WORDS: Record<string, string> = {
  email_mike: 'email to Mike',
  citadel_card: 'Citadel card',
  citadel_data: 'Citadel data',
  slack: 'Slack',
  client_send: 'client email',
  site_deploy: 'site change',
  file_only: 'file on the machine',
  machine_plumbing: 'background plumbing',
};

export function destinationWords(destinations: string[] | null | undefined): string {
  if (!destinations || destinations.length === 0) return 'destination not known yet';
  return destinations.map((d) => DESTINATION_WORDS[d] ?? d.replace(/_/g, ' ')).join(', ');
}

const destinationsKnown = (r: RecurringWorkItem) => Array.isArray(r.destinations) && r.destinations.length > 0;

export interface UsageText {
  /** The main line, e.g. "this week 12% · $4". */
  main: string;
  /** The month line when measured, e.g. "month $12". */
  month: string | null;
}

export function dollars(n: number): string {
  return n < 1 ? '<$1' : `$${Math.round(n)}`;
}

const known = (v: number | null | undefined): v is number => v !== null && v !== undefined;

export function usageText(r: RecurringWorkItem): UsageText {
  switch (r.usage_state) {
    case 'measured': {
      const week: string[] = [];
      if (known(r.usage_week_share)) week.push(`${Math.round(r.usage_week_share)}%`);
      if (known(r.usage_week_usd)) week.push(dollars(r.usage_week_usd));
      return {
        main: week.length ? `this week ${week.join(' · ')}` : 'this week not known yet',
        month: known(r.usage_month_usd) ? `month ${dollars(r.usage_month_usd)}` : null,
      };
    }
    case 'no_claude':
      return { main: 'no Claude', month: null };
    case 'unmeasured':
      return { main: 'not measured', month: null };
    default:
      return { main: 'usage not known yet', month: null };
  }
}

/** Last used: "used Nov 24", "never used" (destinations known), or "use not known yet". `fmt` formats the date. */
export function lastUsedText(r: RecurringWorkItem, fmt: (iso: string) => string): string {
  if (r.last_used_at) return `used ${fmt(r.last_used_at)}`;
  return destinationsKnown(r) ? 'never used' : 'use not known yet';
}

/**
 * Nobody reads it: the output only lands in a file on the machine, OR the destinations are known, are not all
 * background plumbing, and no person has used it in the last 30 days (or ever). Unknown destinations never count.
 */
export function nobodyReads(r: RecurringWorkItem, now: Date = new Date()): boolean {
  if (r.file_only === true) return true;
  const d = r.destinations;
  if (!Array.isArray(d) || d.length === 0) return false;
  if (d.every((x) => x === 'machine_plumbing')) return false;
  if (!r.last_used_at) return true;
  const t = Date.parse(r.last_used_at);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > UNUSED_AFTER_DAYS * DAY_MS;
}

/** Descending with unknown (null) last. */
function desc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

const orNull = (v: number | null | undefined) => (known(v) ? v : null);

/** Stable sort of rows; 'default' keeps the order given (stopped first as the API returns). */
export function sortRows(rows: RecurringWorkItem[], sort: RecurringSort): RecurringWorkItem[] {
  if (sort === 'default') return rows;
  const cmp =
    sort === 'usage'
      ? (a: RecurringWorkItem, b: RecurringWorkItem) =>
          desc(orNull(a.usage_week_share), orNull(b.usage_week_share)) || desc(orNull(a.usage_week_usd), orNull(b.usage_week_usd))
      : (a: RecurringWorkItem, b: RecurringWorkItem) =>
          desc(a.last_run_at ? Date.parse(a.last_run_at) : null, b.last_run_at ? Date.parse(b.last_run_at) : null);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => cmp(x.r, y.r) || x.i - y.i)
    .map((x) => x.r);
}

export function filterRows(rows: RecurringWorkItem[], onlyNobodyReads: boolean, now: Date = new Date()): RecurringWorkItem[] {
  return onlyNobodyReads ? rows.filter((r) => nobodyReads(r, now)) : rows;
}
