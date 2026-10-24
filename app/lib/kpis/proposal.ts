/**
 * KPI proposal shape (specs/citadel-shape-SPEC.md 3.4). A proposal rides on the accord as
 * `Accord.kpi_proposal`: an array of KPI items. Signature (or a staff route today) confirms the
 * items into `SiteKpi` rows. This module is pure: shape checks only, no database.
 */

export const KPI_SOURCES = ['ga4', 'gsc', 'kuma', 'manual'] as const;
export type KpiSource = (typeof KPI_SOURCES)[number];
export const KPI_DIRECTIONS = ['up', 'down'] as const;
export type KpiDirection = (typeof KPI_DIRECTIONS)[number];
export const MAX_PROPOSAL_ITEMS = 20;

export interface KpiProposalItem {
  /** sessions, leads, revenue, uptime, or rank:<keyword>. Up to 60 characters. */
  metric: string;
  /** What the goal is called, in plain words. Up to 200 characters. */
  label: string;
  direction: KpiDirection;
  baseline_value?: number;
  target_value?: number;
  /** A calendar date, YYYY-MM-DD. */
  target_by?: string;
  source: KpiSource;
  /** Optional: the site the goal belongs to. Left out when the site does not exist yet. */
  site_id?: string;
}

export type ProposalResult =
  | { ok: true; items: KpiProposalItem[] }
  | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Decimal(14,2): twelve digits before the point.
const MAX_ABS = 999_999_999_999.99;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function checkNumber(v: unknown, field: string, at: string, errors: string[]): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_ABS) {
    errors.push(`${at}.${field} must be a finite number`);
    return undefined;
  }
  return v;
}

/** Validate an unknown value as a KPI proposal. Returns clean items, or every problem found. */
export function validateKpiProposal(input: unknown): ProposalResult {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { ok: false, errors: ['proposal must be an array of KPI items'] };
  if (input.length > MAX_PROPOSAL_ITEMS) errors.push(`proposal has more than ${MAX_PROPOSAL_ITEMS} items`);

  const items: KpiProposalItem[] = [];
  const seen = new Set<string>();
  input.slice(0, MAX_PROPOSAL_ITEMS).forEach((raw, i) => {
    const at = `[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const r = raw as Record<string, unknown>;
    const before = errors.length;

    const metric = typeof r.metric === 'string' ? r.metric.trim() : '';
    if (!metric || metric.length > 60) errors.push(`${at}.metric must be 1 to 60 characters`);
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label || label.length > 200) errors.push(`${at}.label must be 1 to 200 characters`);
    if (!(KPI_DIRECTIONS as readonly string[]).includes(r.direction as string)) errors.push(`${at}.direction must be up or down`);
    if (!(KPI_SOURCES as readonly string[]).includes(r.source as string)) errors.push(`${at}.source must be one of ${KPI_SOURCES.join(', ')}`);

    const baseline_value = checkNumber(r.baseline_value, 'baseline_value', at, errors);
    const target_value = checkNumber(r.target_value, 'target_value', at, errors);

    let target_by: string | undefined;
    if (r.target_by !== undefined && r.target_by !== null) {
      if (typeof r.target_by === 'string' && isRealDate(r.target_by)) target_by = r.target_by;
      else errors.push(`${at}.target_by must be a date, YYYY-MM-DD`);
    }
    let site_id: string | undefined;
    if (r.site_id !== undefined && r.site_id !== null) {
      if (typeof r.site_id === 'string' && UUID_RE.test(r.site_id)) site_id = r.site_id;
      else errors.push(`${at}.site_id must be a uuid`);
    }

    if (errors.length > before) return;
    const key = `${site_id ?? ''}|${metric}`;
    if (seen.has(key)) {
      errors.push(`${at} repeats metric ${metric}${site_id ? ' for the same site' : ''}`);
      return;
    }
    seen.add(key);
    items.push({
      metric,
      label,
      direction: r.direction as KpiDirection,
      source: r.source as KpiSource,
      ...(baseline_value !== undefined ? { baseline_value } : {}),
      ...(target_value !== undefined ? { target_value } : {}),
      ...(target_by ? { target_by } : {}),
      ...(site_id ? { site_id } : {}),
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, items };
}
