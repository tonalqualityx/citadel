/**
 * Confirm an accord's KPI proposal into SiteKpi rows (specs/citadel-shape-SPEC.md 3.4).
 *
 * `planKpiConfirmation` is pure: given a proposal and the rows that already exist for the accord,
 * it says which rows to create and which proposed rows to confirm. `confirmKpiProposal` is the
 * Prisma writer. Idempotent: a second run changes nothing. A retired row stays retired.
 * Nothing calls this from the signing route today; a staff route does.
 */
import type { PrismaClient } from '@prisma/client';
import { validateKpiProposal, type KpiProposalItem } from './proposal';

export interface ExistingKpi {
  id: string;
  metric: string;
  site_id: string | null;
  status: string;
}

export interface KpiCreate {
  client_id: string;
  site_id: string | null;
  accord_id: string;
  charter_id: string | null;
  metric: string;
  label: string;
  direction: string;
  baseline_value: number | null;
  baseline_at: Date | null;
  target_value: number | null;
  target_by: Date | null;
  source: string;
  status: 'confirmed';
  confirmed_at: Date;
}

export interface KpiPlan {
  create: KpiCreate[];
  /** Existing rows still in proposed state: confirm them. */
  confirm: string[];
  /** Metrics left alone (already confirmed, or retired). */
  unchanged: string[];
}

export interface PlanContext {
  client_id: string;
  accord_id: string;
  charter_id?: string | null;
  /** Used for an item with no site of its own. Null when the site does not exist yet. */
  default_site_id?: string | null;
  now: Date;
}

const keyOf = (site: string | null, metric: string) => `${site ?? ''}|${metric}`;

export function planKpiConfirmation(items: KpiProposalItem[], existing: ExistingKpi[], ctx: PlanContext): KpiPlan {
  const byKey = new Map(existing.map((e) => [keyOf(e.site_id, e.metric), e]));
  const plan: KpiPlan = { create: [], confirm: [], unchanged: [] };
  for (const it of items) {
    const site_id = it.site_id ?? ctx.default_site_id ?? null;
    const found = byKey.get(keyOf(site_id, it.metric));
    if (found) {
      if (found.status === 'proposed') plan.confirm.push(found.id);
      else plan.unchanged.push(it.metric);
      continue;
    }
    plan.create.push({
      client_id: ctx.client_id,
      site_id,
      accord_id: ctx.accord_id,
      charter_id: ctx.charter_id ?? null,
      metric: it.metric,
      label: it.label,
      direction: it.direction,
      baseline_value: it.baseline_value ?? null,
      baseline_at: it.baseline_value !== undefined ? ctx.now : null,
      target_value: it.target_value ?? null,
      target_by: it.target_by ? new Date(`${it.target_by}T00:00:00Z`) : null,
      source: it.source,
      status: 'confirmed',
      confirmed_at: ctx.now,
    });
  }
  return plan;
}

export class KpiConfirmError extends Error {
  constructor(message: string, public code: 'accord_not_found' | 'no_client' | 'no_proposal' | 'invalid_proposal', public details?: string[]) {
    super(message);
  }
}

export interface ConfirmResult {
  created: number;
  confirmed: number;
  unchanged: number;
  rows: string[];
}

/** Read the accord's proposal, plan, and write. One transaction, locked per accord so two calls cannot duplicate. */
export async function confirmKpiProposal(
  db: PrismaClient,
  accordId: string,
  opts: { now?: Date } = {}
): Promise<ConfirmResult> {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'kpi-confirm:' + accordId}))`;
    const accord = await tx.accord.findUnique({
      where: { id: accordId },
      select: {
        id: true,
        client_id: true,
        kpi_proposal: true,
        charters: { where: { is_deleted: false }, select: { id: true, site_id: true }, take: 2 },
      },
    });
    if (!accord) throw new KpiConfirmError('Accord not found', 'accord_not_found');
    if (!accord.client_id) throw new KpiConfirmError('The accord has no client yet', 'no_client');
    if (accord.kpi_proposal === null || accord.kpi_proposal === undefined) throw new KpiConfirmError('The accord has no KPI proposal', 'no_proposal');
    const checked = validateKpiProposal(accord.kpi_proposal);
    if (!checked.ok) throw new KpiConfirmError('The stored proposal is not valid', 'invalid_proposal', checked.errors);

    const existing = await tx.siteKpi.findMany({
      where: { accord_id: accord.id },
      select: { id: true, metric: true, site_id: true, status: true },
    });
    const single = accord.charters.length === 1 ? accord.charters[0] : null;
    const plan = planKpiConfirmation(checked.items, existing, {
      client_id: accord.client_id,
      accord_id: accord.id,
      charter_id: single?.id ?? null,
      default_site_id: single?.site_id ?? null,
      now,
    });

    const ids: string[] = [];
    for (const data of plan.create) {
      const row = await tx.siteKpi.create({ data, select: { id: true } });
      ids.push(row.id);
    }
    if (plan.confirm.length > 0) {
      await tx.siteKpi.updateMany({ where: { id: { in: plan.confirm }, status: 'proposed' }, data: { status: 'confirmed', confirmed_at: now } });
      ids.push(...plan.confirm);
    }
    return { created: plan.create.length, confirmed: plan.confirm.length, unchanged: plan.unchanged.length, rows: ids };
  });
}
