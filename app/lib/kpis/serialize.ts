import type { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal | number | string | null;
const num = (v: Dec) => (v === null || v === undefined ? null : Number(v));
const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export interface KpiRow {
  id: string;
  client_id: string;
  site_id: string | null;
  accord_id: string | null;
  charter_id: string | null;
  metric: string;
  label: string;
  direction: string;
  baseline_value: Dec;
  baseline_at: Date | null;
  target_value: Dec;
  target_by: Date | null;
  source: string;
  status: string;
  confirmed_at: Date | null;
  last_value: Dec;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Staff view of a KPI row: numbers as numbers, the date column as YYYY-MM-DD. */
export function serializeSiteKpi(r: KpiRow) {
  return {
    id: r.id,
    client_id: r.client_id,
    site_id: r.site_id,
    accord_id: r.accord_id,
    charter_id: r.charter_id,
    metric: r.metric,
    label: r.label,
    direction: r.direction,
    baseline_value: num(r.baseline_value),
    baseline_at: r.baseline_at,
    target_value: num(r.target_value),
    target_by: day(r.target_by),
    source: r.source,
    status: r.status,
    confirmed_at: r.confirmed_at,
    last_value: num(r.last_value),
    last_checked_at: r.last_checked_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
