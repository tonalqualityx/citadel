/**
 * Engine rows (design.md 2.5, "Engines"): one `engine` row per active Troubador schedule and one per active maintenance
 * plan, so the Recurring work tab is the one list of everything that repeats. The engines keep their own schedules and
 * code; a row only points at its source with source_kind and source_id.
 *
 * A maintenance plan is a pricing tier shared by many clients' sites, so it gets ONE row for the plan, with no client
 * and no site. It is created in the "Client sites" group, and its reach (how many sites are on it) is said in `produces`.
 * The sync is a full reconcile: it creates what is missing, updates what drifted, and marks rows whose source is gone or
 * stopped inactive. It never deletes, and it never writes the fields people set (initiative, sort order, group, usage,
 * destinations, priority, pick). The group is only given when a row is created.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

export interface EngineSyncResult {
  created: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  total: number;
}

/** The fields the sync owns. */
interface EngineFields {
  title: string;
  client_id: string | null;
  site_id: string | null;
  owner_id: string | null;
  produces: string;
  schedule_text: string;
  last_run_at: Date | null;
  paused_on_purpose: boolean;
}

interface Desired {
  source_kind: 'troubador_schedule' | 'maintenance_plan';
  source_id: string;
  fields: EngineFields;
  /** written only when the row is created, never on update (people may regroup a row) */
  createOnly?: { group_label: string };
}

export const PLAN_GROUP_LABEL = 'Client sites';

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const trimNum = (n: number) => String(Number(n.toFixed(2)));

/** Words for a posts-per-week rate: 2 -> "2 posts a week", 0.5 -> "1 post every 2 weeks". */
export function publishScheduleText(perWeek: number): string {
  if (!Number.isFinite(perWeek) || perWeek <= 0) return 'no posts scheduled';
  if (perWeek >= 1) {
    const whole = Math.abs(perWeek - Math.round(perWeek)) < 0.005;
    const n = whole ? String(Math.round(perWeek)) : trimNum(perWeek);
    return `${n} ${n === '1' ? 'post' : 'posts'} a week`;
  }
  const weeks = 1 / perWeek;
  if (Math.abs(weeks - Math.round(weeks)) < 0.05) return `1 post every ${Math.round(weeks)} weeks`;
  return `${trimNum(perWeek)} posts a week`;
}

const FREQUENCY_TEXT: Record<string, string> = {
  monthly: 'monthly',
  bi_monthly: 'every 2 months',
  quarterly: 'quarterly',
  semi_annually: 'every 6 months',
  annually: 'yearly',
};

export function maintenanceScheduleText(frequency: string): string {
  return FREQUENCY_TEXT[frequency] ?? frequency.replace(/_/g, ' ');
}

const PERIOD_TEXT: Record<string, string> = {
  monthly: 'each month',
  bi_monthly: 'every 2 months',
  quarterly: 'each quarter',
  semi_annually: 'every 6 months',
  annually: 'each year',
};

/** What a plan row produces, with its reach: "a maintenance task each month for each of the 47 sites on Essentials". */
export function maintenanceProducesText(planName: string, frequency: string, siteCount: number): string {
  const period = PERIOD_TEXT[frequency] ?? frequency.replace(/_/g, ' ');
  const base = `a maintenance task ${period}`;
  if (siteCount <= 0) return `${base} for each site on ${planName}, none on it yet`;
  if (siteCount === 1) return `${base} for the 1 site on ${planName}`;
  return `${base} for each of the ${siteCount} sites on ${planName}`;
}

const sameTime = (a: Date | null, b: Date | null) => (a ? a.getTime() : null) === (b ? b.getTime() : null);

function differs(row: EngineFields & { is_active: boolean; is_plumbing: boolean }, f: EngineFields): boolean {
  return (
    !row.is_active ||
    row.is_plumbing ||
    row.title !== f.title ||
    row.client_id !== f.client_id ||
    row.site_id !== f.site_id ||
    row.owner_id !== f.owner_id ||
    row.produces !== f.produces ||
    row.schedule_text !== f.schedule_text ||
    row.paused_on_purpose !== f.paused_on_purpose ||
    !sameTime(row.last_run_at, f.last_run_at)
  );
}

type Tx = Prisma.TransactionClient;

async function desiredTroubador(tx: Tx): Promise<Desired[]> {
  const schedules = await tx.troubadorSchedule.findMany({
    where: { is_deleted: false, status: { in: ['active', 'paused'] } },
    select: {
      id: true,
      name: true,
      status: true,
      client_id: true,
      site_id: true,
      default_assignee_id: true,
      publish_per_week: true,
      last_run_at: true,
      site: { select: { name: true } },
    },
  });
  return schedules.map((s) => ({
    source_kind: 'troubador_schedule' as const,
    source_id: s.id,
    fields: {
      title: truncate(s.name, 200),
      client_id: s.client_id,
      site_id: s.site_id,
      owner_id: s.default_assignee_id ?? null,
      schedule_text: truncate(publishScheduleText(Number(s.publish_per_week)), 120),
      produces: truncate(`a blog post published on ${s.site?.name ?? 'the site'}`, 300),
      last_run_at: s.last_run_at ?? null,
      paused_on_purpose: s.status === 'paused',
    },
  }));
}

/**
 * One row per active maintenance plan, with or without sites or SOPs. A plan with no SOPs still counts: Citadel's
 * maintenance generator makes no tasks for it, but the plan's upkeep still repeats every period (the machine does it).
 */
async function desiredMaintenance(tx: Tx): Promise<Desired[]> {
  const plans = await tx.maintenancePlan.findMany({
    where: { is_active: true },
    select: { id: true, name: true, frequency: true },
  });
  if (plans.length === 0) return [];
  const planIds = plans.map((p) => p.id);

  const siteCounts = await tx.site.groupBy({
    by: ['maintenance_plan_id'],
    where: { is_deleted: false, maintenance_plan_id: { in: planIds } },
    _count: { _all: true },
  });
  const counts = new Map(siteCounts.map((c) => [c.maintenance_plan_id, c._count._all]));

  const logs = await tx.maintenanceGenerationLog.groupBy({
    by: ['maintenance_plan_id'],
    where: { maintenance_plan_id: { in: planIds } },
    _max: { generated_at: true },
  });
  const lastRun = new Map(logs.map((l) => [l.maintenance_plan_id, l._max.generated_at ?? null]));

  return plans.map((plan) => ({
    source_kind: 'maintenance_plan' as const,
    source_id: plan.id,
    createOnly: { group_label: PLAN_GROUP_LABEL },
    fields: {
      title: truncate(`${plan.name} maintenance`, 200),
      client_id: null,
      site_id: null,
      owner_id: BAST_USER_ID,
      schedule_text: maintenanceScheduleText(plan.frequency),
      produces: truncate(maintenanceProducesText(plan.name, plan.frequency, counts.get(plan.id) ?? 0), 300),
      last_run_at: lastRun.get(plan.id) ?? null,
      paused_on_purpose: false,
    },
  }));
}

const keyOf = (d: { source_kind: string | null; source_id: string | null }) => `${d.source_kind}|${d.source_id}`;

/** Full reconcile of the engine rows against the Troubador schedules and maintenance plans. */
export async function syncEngineRows(): Promise<EngineSyncResult> {
  return prisma.$transaction(
    async (tx) => {
      // one sync at a time, so two overlapping writes can never create the same row twice
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('recurring-work:engine-sync'))`;

      const desired = [...(await desiredTroubador(tx)), ...(await desiredMaintenance(tx))];

      const existing = await tx.recurringWork.findMany({
        where: { kind: 'engine', source_kind: { in: ['troubador_schedule', 'maintenance_plan'] }, source_id: { not: null } },
        select: {
          id: true,
          source_kind: true,
          source_id: true,
          is_active: true,
          is_plumbing: true,
          title: true,
          client_id: true,
          site_id: true,
          owner_id: true,
          produces: true,
          schedule_text: true,
          last_run_at: true,
          paused_on_purpose: true,
          created_at: true,
        },
        orderBy: { created_at: 'asc' },
      });
      // a duplicate key should not exist; the oldest row is the match and the others are left alone
      const byKey = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        const k = keyOf(row);
        if (!byKey.has(k)) byKey.set(k, row);
      }

      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const wanted = new Set<string>();
      for (const d of desired) {
        const k = keyOf(d);
        wanted.add(k);
        const row = byKey.get(k);
        if (!row) {
          await tx.recurringWork.create({
            data: { ...d.fields, ...d.createOnly, kind: 'engine', source_kind: d.source_kind, source_id: d.source_id, is_active: true, is_plumbing: false },
          });
          created++;
        } else if (differs(row as unknown as EngineFields & { is_active: boolean; is_plumbing: boolean }, d.fields)) {
          await tx.recurringWork.update({ where: { id: row.id }, data: { ...d.fields, is_active: true, is_plumbing: false } });
          updated++;
        } else {
          unchanged++;
        }
      }

      // every active engine row whose source is no longer in the set is marked inactive, never deleted
      const goneIds = [...byKey.entries()].filter(([k, row]) => row.is_active && !wanted.has(k)).map(([, row]) => row.id);
      let deactivated = 0;
      if (goneIds.length > 0) {
        const res = await tx.recurringWork.updateMany({ where: { id: { in: goneIds } }, data: { is_active: false } });
        deactivated = res.count;
      }

      return { created, updated, deactivated, unchanged, total: desired.length };
    },
    { timeout: 30000 }
  );
}

/** For write routes: a sync failure is logged and never fails the user's write. */
export async function syncEngineRowsSafe(context: string): Promise<void> {
  try {
    await syncEngineRows();
  } catch (error) {
    console.error(`[engine-sync] failed after ${context}:`, error);
  }
}
