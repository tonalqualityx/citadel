/**
 * The signed deal, read-only, for the chat (and Dox under its project binding): what was sold, the contract's state, and the client's retainers.
 * Nothing in this file writes. It never selects a signer's name, address or IP, a portal token, the contract text, a pricing snapshot, the lead's
 * own contact fields, the accord's private notes or its rejection reason: only what a planner needs to scope, date and bill the work.
 *
 * HOW A PROJECT IS TIED TO ITS DEAL (Project.accord_id is the real link; the schema has it, the older chat reads never returned it):
 *   1. `project_accord`      Project.accord_id names the deal. This is the reliable link and is used whenever it is set.
 *   2. `commission_item`     No accord_id on the project, but a deal's commission item points at the project (AccordCommissionItem.project_id).
 *   3. `client_signed_deals` Neither link exists: the client's own signed or active deals, newest signature first. NOT a link, only the nearest
 *                            candidates, and `tie_note` says so.
 *   4. `client_deals`        Asked for a client with no project: the client's deals of every status, newest first.
 *   5. `none`                Nothing found.
 * Amounts are exactly as stored: decimal strings with the column's two places ("1500.00"), never rounded floats.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export type DealTie = 'project_accord' | 'commission_item' | 'client_signed_deals' | 'client_deals' | 'none';

export interface DealContractOut {
  version: number;
  status: 'draft' | 'sent' | 'signed';
  sent_at: string | null;
  signed_at: string | null;
}

export interface DealCommissionItemOut {
  id: string;
  name: string;
  ware_type: string;
  estimated_price: string | null;
  discount_type: string | null;
  discount_value: string | null;
  final_price: string | null;
  project_id: string | null;
  addendum_id: string | null;
}

export interface DealCharterItemOut {
  id: string;
  name: string;
  ware_type: string;
  price_tier: string | null;
  base_price: string;
  discount_type: string | null;
  discount_value: string | null;
  final_price: string;
  billing_period: 'monthly' | 'annually';
  duration_months: number;
  total_contract_value: string;
  charter_id: string | null;
  addendum_id: string | null;
}

export interface DealKeepItemOut {
  id: string;
  name: string | null;
  domain_name: string | null;
  hosting_final_price: string | null;
  maintenance_final_price: string | null;
  monthly_total: string | null;
  is_client_hosted: boolean;
  addendum_id: string | null;
}

export interface DealOut {
  id: string;
  name: string;
  status: string;
  pipeline_stage: string | null;
  signed_at: string | null;
  total_value: string | null;
  href: string;
  /** True when Citadel itself ties this deal to the project asked about (tie project_accord or commission_item). */
  tied_to_project: boolean;
  /** The signed contract when there is one, else the newest version with its status; null when the deal has no contract. */
  contract: DealContractOut | null;
  contract_count: number;
  items: { commission: DealCommissionItemOut[]; charter: DealCharterItemOut[]; keep: DealKeepItemOut[] };
}

export interface RetainerOut {
  id: string;
  name: string;
  status: string;
  billing_period: 'monthly' | 'annually';
  budget_hours: string | null;
  hourly_rate: string | null;
  budget_amount: string | null;
  start_date: string;
  end_date: string | null;
  duration_months: number | null;
  renewal_date: string | null;
  deal_id: string | null;
  site_id: string | null;
}

export interface DealSection {
  tie: DealTie;
  tie_note: string;
  deals: DealOut[];
  /** The client's active and paused retainer plans (Charter rows), with hours, rate and period as stored. */
  retainers: RetainerOut[];
  /** The hours and rate kept on the client record itself (Client.retainer_hours, hourly_rate), or null when neither is set. */
  client_retainer: { retainer_hours: string | null; hourly_rate: string | null; usage_mode: string } | null;
}

type Db = Pick<PrismaClient, 'project' | 'accord' | 'accordCommissionItem' | 'charter' | 'client'>;

export const DEALS_MAX = 8;
export const ITEMS_MAX = 40;

type Dec = { toFixed(n: number): string };
const money = (v: Dec | null | undefined): string | null => (v === null || v === undefined ? null : v.toFixed(2));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

const ACCORD_SELECT: Prisma.AccordSelect = {
  id: true,
  name: true,
  status: true,
  pipeline_stage: true,
  signed_at: true,
  total_value: true,
  contracts: {
    where: { is_deleted: false },
    orderBy: [{ version: 'desc' as const }],
    select: { version: true, status: true, sent_at: true, signed_at: true },
  },
  commission_items: {
    where: { is_deleted: false },
    orderBy: [{ sort_order: 'asc' as const }, { created_at: 'asc' as const }],
    take: ITEMS_MAX,
    select: {
      id: true, name_override: true, estimated_price: true, discount_type: true, discount_value: true, final_price: true, project_id: true, addendum_id: true,
      ware: { select: { name: true, type: true } },
    },
  },
  charter_items: {
    where: { is_deleted: false },
    orderBy: [{ sort_order: 'asc' as const }, { created_at: 'asc' as const }],
    take: ITEMS_MAX,
    select: {
      id: true, name_override: true, price_tier: true, base_price: true, discount_type: true, discount_value: true, final_price: true, billing_period: true,
      duration_months: true, total_contract_value: true, charter_id: true, addendum_id: true,
      ware: { select: { name: true, type: true } },
    },
  },
  keep_items: {
    where: { is_deleted: false },
    orderBy: [{ sort_order: 'asc' as const }, { created_at: 'asc' as const }],
    take: ITEMS_MAX,
    select: {
      id: true, site_name_placeholder: true, domain_name: true, hosting_final_price: true, maintenance_final_price: true, monthly_total: true, is_client_hosted: true,
      addendum_id: true, site: { select: { name: true } },
    },
  },
};

type AccordRow = {
  id: string;
  name: string;
  status: string;
  pipeline_stage: string | null;
  signed_at: Date | null;
  total_value: Dec | null;
  contracts: { version: number; status: 'draft' | 'sent' | 'signed'; sent_at: Date | null; signed_at: Date | null }[];
  commission_items: {
    id: string; name_override: string | null; estimated_price: Dec | null; discount_type: string | null; discount_value: Dec | null;
    final_price: Dec | null; project_id: string | null; addendum_id: string | null; ware: { name: string; type: string };
  }[];
  charter_items: {
    id: string; name_override: string | null; price_tier: string | null; base_price: Dec; discount_type: string | null; discount_value: Dec | null;
    final_price: Dec; billing_period: 'monthly' | 'annually'; duration_months: number; total_contract_value: Dec;
    charter_id: string | null; addendum_id: string | null; ware: { name: string; type: string };
  }[];
  keep_items: {
    id: string; site_name_placeholder: string | null; domain_name: string | null; hosting_final_price: Dec | null;
    maintenance_final_price: Dec | null; monthly_total: Dec | null; is_client_hosted: boolean; addendum_id: string | null;
    site: { name: string } | null;
  }[];
};

export function formatDeal(a: AccordRow, tied: boolean): DealOut {
  // The signed contract (newest signed) when there is one, else the newest version with its status.
  const signed = a.contracts.find((c) => c.status === 'signed');
  const c = signed ?? a.contracts[0] ?? null;
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    pipeline_stage: a.pipeline_stage,
    signed_at: iso(a.signed_at),
    total_value: money(a.total_value),
    href: `/deals/${a.id}`,
    tied_to_project: tied,
    contract: c ? { version: c.version, status: c.status, sent_at: iso(c.sent_at), signed_at: iso(c.signed_at) } : null,
    contract_count: a.contracts.length,
    items: {
      commission: a.commission_items.map((i) => ({
        id: i.id,
        name: i.name_override ?? i.ware.name,
        ware_type: i.ware.type,
        estimated_price: money(i.estimated_price),
        discount_type: i.discount_type,
        discount_value: money(i.discount_value),
        final_price: money(i.final_price),
        project_id: i.project_id,
        addendum_id: i.addendum_id,
      })),
      charter: a.charter_items.map((i) => ({
        id: i.id,
        name: i.name_override ?? i.ware.name,
        ware_type: i.ware.type,
        price_tier: i.price_tier,
        base_price: money(i.base_price) as string,
        discount_type: i.discount_type,
        discount_value: money(i.discount_value),
        final_price: money(i.final_price) as string,
        billing_period: i.billing_period,
        duration_months: i.duration_months,
        total_contract_value: money(i.total_contract_value) as string,
        charter_id: i.charter_id,
        addendum_id: i.addendum_id,
      })),
      keep: a.keep_items.map((i) => ({
        id: i.id,
        name: i.site?.name ?? i.site_name_placeholder,
        domain_name: i.domain_name,
        hosting_final_price: money(i.hosting_final_price),
        maintenance_final_price: money(i.maintenance_final_price),
        monthly_total: money(i.monthly_total),
        is_client_hosted: i.is_client_hosted,
        addendum_id: i.addendum_id,
      })),
    },
  };
}

const NONE_NOTE = 'Citadel records no deal for this.';

async function loadRetainers(db: Db, clientId: string | null): Promise<Pick<DealSection, 'retainers' | 'client_retainer'>> {
  if (!clientId) return { retainers: [], client_retainer: null };
  const [charters, client] = await Promise.all([
    db.charter.findMany({
      where: { client_id: clientId, is_deleted: false, status: { in: ['active', 'paused'] } },
      orderBy: [{ start_date: 'desc' }, { id: 'asc' }],
      take: 10,
      select: {
        id: true, name: true, status: true, billing_period: true, budget_hours: true, hourly_rate: true, budget_amount: true, start_date: true, end_date: true,
        duration_months: true, renewal_date: true, accord_id: true, site_id: true,
      },
    }),
    db.client.findFirst({ where: { id: clientId, is_deleted: false }, select: { retainer_hours: true, hourly_rate: true, retainer_usage_mode: true } }),
  ]);
  const hasClient = !!client && (client.retainer_hours !== null || client.hourly_rate !== null);
  return {
    retainers: charters.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      billing_period: c.billing_period,
      budget_hours: money(c.budget_hours),
      hourly_rate: money(c.hourly_rate),
      budget_amount: money(c.budget_amount),
      start_date: day(c.start_date) as string,
      end_date: day(c.end_date),
      duration_months: c.duration_months,
      renewal_date: day(c.renewal_date),
      deal_id: c.accord_id,
      site_id: c.site_id,
    })),
    client_retainer: hasClient && client ? { retainer_hours: money(client.retainer_hours), hourly_rate: money(client.hourly_rate), usage_mode: client.retainer_usage_mode } : null,
  };
}

const NEWEST_SIGNED = [{ signed_at: { sort: 'desc' as const, nulls: 'last' as const } }, { id: 'asc' as const }];

/**
 * The deal section for a project and/or a client. With a project, the tie order in the file header applies and the client is the project's own.
 * With only a client, every one of the client's deals is returned. Read-only: only `find*` calls.
 */
export async function readDeals(db: Db, input: { projectId?: string | null; clientId?: string | null }): Promise<DealSection> {
  let clientId = input.clientId ?? null;
  let tie: DealTie = 'none';
  let tieNote = NONE_NOTE;
  let rows: { row: AccordRow; tied: boolean }[] = [];

  if (input.projectId) {
    const project = await db.project.findFirst({ where: { id: input.projectId, is_deleted: false }, select: { id: true, client_id: true, accord_id: true } });
    if (!project) return { tie: 'none', tie_note: NONE_NOTE, deals: [], retainers: [], client_retainer: null };
    clientId = project.client_id;
    if (project.accord_id) {
      const a = (await db.accord.findFirst({ where: { id: project.accord_id, is_deleted: false }, select: ACCORD_SELECT })) as unknown as AccordRow | null;
      if (a) {
        tie = 'project_accord';
        tieNote = "Tied by the project's own deal link (Project.accord_id).";
        rows = [{ row: a, tied: true }];
      }
    }
    if (rows.length === 0) {
      const links = await db.accordCommissionItem.findMany({ where: { project_id: project.id, is_deleted: false, accord: { is_deleted: false } }, select: { accord_id: true }, take: 20 });
      const ids = [...new Set(links.map((l) => l.accord_id))].slice(0, DEALS_MAX);
      if (ids.length > 0) {
        const found = (await db.accord.findMany({ where: { id: { in: ids }, is_deleted: false }, select: ACCORD_SELECT, orderBy: NEWEST_SIGNED })) as unknown as AccordRow[];
        tie = 'commission_item';
        tieNote = "The project has no deal link of its own; a deal's commission item points at this project, so those deals are tied to it.";
        rows = found.map((row) => ({ row, tied: true }));
      }
    }
    if (rows.length === 0 && clientId) {
      const found = (await db.accord.findMany({
        // Candidates only: a deal already tied to ANOTHER project (its own deal link, or a commission item that points at one) is that project's, not this one's.
        where: {
          client_id: clientId,
          is_deleted: false,
          status: { in: ['signed', 'active'] },
          projects: { none: { id: { not: project.id }, is_deleted: false } },
          commission_items: { none: { is_deleted: false, project_id: { not: null, notIn: [project.id] } } },
        },
        select: ACCORD_SELECT,
        orderBy: NEWEST_SIGNED,
        take: DEALS_MAX,
      })) as unknown as AccordRow[];
      if (found.length > 0) {
        tie = 'client_signed_deals';
        tieNote = "Citadel does not tie this project to a deal: no deal link and no commission item points at it. These are the client's signed deals, newest first. Treat them as candidates, not as this project's deal.";
        rows = found.map((row) => ({ row, tied: false }));
      }
    }
  } else if (clientId) {
    const found = (await db.accord.findMany({
      where: { client_id: clientId, is_deleted: false },
      select: ACCORD_SELECT,
      orderBy: [{ signed_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }, { id: 'asc' }],
      take: DEALS_MAX,
    })) as unknown as AccordRow[];
    if (found.length > 0) {
      tie = 'client_deals';
      tieNote = "All of the client's deals, signed first and newest first.";
      rows = found.map((row) => ({ row, tied: false }));
    }
  }

  const retainers = await loadRetainers(db, clientId);
  return { tie, tie_note: rows.length === 0 && retainers.retainers.length === 0 ? NONE_NOTE : tieNote, deals: rows.map((r) => formatDeal(r.row, r.tied)), ...retainers };
}
