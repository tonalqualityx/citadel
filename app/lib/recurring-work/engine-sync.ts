/**
 * Engine rows (design.md 2.5, "Engines"): one `engine` row per active Troubador schedule and one per site on a
 * maintenance plan, so the Recurring work tab is the one list of everything that repeats. The engines keep their own
 * schedules and code; a row only points at its source with source_kind and source_id.
 *
 * A maintenance plan is a pricing tier shared by many sites, so it gets one row per site (that is what puts it under
 * its client). The sync is a full reconcile: it creates what is missing, updates what drifted, and marks rows whose
 * source is gone or stopped inactive. It never deletes, and it never writes the fields people set (initiative, sort
 * order, group, usage, destinations, priority, pick).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

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
}

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

const maintenanceKey = (planId: string, siteId: string | null) => `${planId}:${siteId ?? ''}`;

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
 * Every live site on an active maintenance plan. A plan with no SOPs still counts: Citadel's maintenance generator makes no
 * tasks for it, but the plan's upkeep still repeats every period (the machine does it), so it belongs on the list.
 */
async function desiredMaintenance(tx: Tx): Promise<Desired[]> {
  const sites = await tx.site.findMany({
    where: {
      is_deleted: false,
      maintenance_plan_id: { not: null },
      maintenance_plan: { is_active: true },
    },
    select: {
      id: true,
      name: true,
      client_id: true,
      maintenance_assignee_id: true,
      maintenance_plan_id: true,
      maintenance_plan: { select: { id: true, name: true, frequency: true } },
    },
  });
  if (sites.length === 0) return [];

  const logs = await tx.maintenanceGenerationLog.groupBy({
    by: ['maintenance_plan_id', 'site_id'],
    where: { site_id: { in: sites.map((s) => s.id) } },
    _max: { generated_at: true },
  });
  const lastRun = new Map(logs.map((l) => [maintenanceKey(l.maintenance_plan_id, l.site_id), l._max.generated_at ?? null]));

  const out: Desired[] = [];
  for (const s of sites) {
    const plan = s.maintenance_plan;
    if (!plan) continue;
    out.push({
      source_kind: 'maintenance_plan',
      source_id: plan.id,
      fields: {
        title: truncate(`${plan.name} maintenance: ${s.name}`, 200),
        client_id: s.client_id ?? null,
        site_id: s.id,
        owner_id: s.maintenance_assignee_id ?? null,
        schedule_text: maintenanceScheduleText(plan.frequency),
        produces: truncate(`${plan.name} upkeep on ${s.name}`, 300),
        last_run_at: lastRun.get(maintenanceKey(plan.id, s.id)) ?? null,
        paused_on_purpose: false,
      },
    });
  }
  return out;
}

const keyOf = (d: { source_kind: string | null; source_id: string | null; site_id: string | null }) =>
  d.source_kind === 'maintenance_plan' ? `maintenance_plan|${maintenanceKey(d.source_id ?? '', d.site_id)}` : `${d.source_kind}|${d.source_id}`;

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
        const k = keyOf({ source_kind: d.source_kind, source_id: d.source_id, site_id: d.source_kind === 'maintenance_plan' ? d.fields.site_id : null });
        wanted.add(k);
        const row = byKey.get(k);
        if (!row) {
          await tx.recurringWork.create({
            data: { ...d.fields, kind: 'engine', source_kind: d.source_kind, source_id: d.source_id, is_active: true, is_plumbing: false },
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
