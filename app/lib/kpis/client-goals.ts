/**
 * What a client sees of a KPI: an allow-list in client words. Label, a target sentence, the
 * direction, and the latest value when there is one. Never the source (ga4, gsc, kuma), the
 * baseline, the status, ids, or when it was checked.
 */
import type { Prisma } from '@prisma/client';

export interface ClientGoal {
  label: string;
  target_text: string;
  direction: 'up' | 'down';
  last_text: string | null;
}

export interface GoalRow {
  metric: string;
  label: string;
  direction: string;
  target_value: Prisma.Decimal | number | string | null;
  target_by: Date | string | null;
  last_value: Prisma.Decimal | number | string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** A value in words that fit the metric: a percent for uptime, dollars for revenue, else a count. */
export function goalValueText(metric: string, value: number): string {
  if (metric === 'uptime') return `${fmtNumber(value)}%`;
  if (metric === 'revenue') return `$${fmtNumber(value)}`;
  if (metric.startsWith('rank:')) return `position ${fmtNumber(value)}`;
  return fmtNumber(value);
}

function dateText(d: Date | string | null): string | null {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  // target_by is a date column: its UTC parts are the calendar date.
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

export function toClientGoal(r: GoalRow): ClientGoal {
  const direction: 'up' | 'down' = r.direction === 'down' ? 'down' : 'up';
  const target = r.target_value === null || r.target_value === undefined ? null : Number(r.target_value);
  const by = dateText(r.target_by);
  let text: string;
  if (target === null || !Number.isFinite(target)) {
    text = direction === 'up' ? 'Keep it growing' : 'Bring it down';
  } else if (r.metric.startsWith('rank:')) {
    text = `Reach ${goalValueText(r.metric, target)} or better`;
  } else {
    text = direction === 'up' ? `Reach ${goalValueText(r.metric, target)}` : `Bring it down to ${goalValueText(r.metric, target)}`;
  }
  if (by) text += ` by ${by}`;
  const last = r.last_value === null || r.last_value === undefined ? null : Number(r.last_value);
  return {
    label: r.label,
    target_text: text,
    direction,
    last_text: last !== null && Number.isFinite(last) ? `Now ${goalValueText(r.metric, last)}` : null,
  };
}
