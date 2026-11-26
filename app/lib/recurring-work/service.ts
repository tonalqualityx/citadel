/**
 * Recurring work rules shared by the routes: the schemas, the per-kind required fields, the include shape, and the
 * 404 checks (design.md 2.5). One record per piece of recurring work; a charter's scheduled tasks are the same rows.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { assertInitiativeLinkable } from '@/lib/initiatives/service';

export const KIND_VALUES = ['citadel_task', 'machine_job', 'engine'] as const;
export const CADENCE_VALUES = ['weekly', 'monthly', 'quarterly', 'semi_annually', 'annually'] as const;
export const ENGINE_SOURCE_KINDS = ['troubador_schedule', 'maintenance_plan'] as const;

export const RECURRING_WORK_INCLUDE = {
  sop: { select: { id: true, title: true } },
  // a charter row's client and site are the charter's (read, never copied), so the charter brings them along
  charter: {
    select: {
      id: true,
      name: true,
      client_id: true,
      site_id: true,
      client: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
    },
  },
  owner: { select: { id: true, name: true } },
  initiative: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
};

const uuid = z.string().uuid();

const fields = {
  title: z.string().trim().min(1).max(200).nullable().optional(),
  charter_id: uuid.nullable().optional(),
  charter_ware_id: uuid.nullable().optional(),
  sop_id: uuid.nullable().optional(),
  cadence: z.enum(CADENCE_VALUES).nullable().optional(),
  schedule_text: z.string().trim().max(120).nullable().optional(),
  cron_expr: z.string().trim().min(1).max(60).nullable().optional(),
  job_key: z.string().trim().min(1).max(120).nullable().optional(),
  source_kind: z.enum(ENGINE_SOURCE_KINDS).nullable().optional(),
  source_id: uuid.nullable().optional(),
  owner_id: uuid.nullable().optional(),
  produces: z.string().trim().max(300).nullable().optional(),
  client_id: uuid.nullable().optional(),
  site_id: uuid.nullable().optional(),
  initiative_id: uuid.nullable().optional(),
  is_plumbing: z.boolean().optional(),
  paused_on_purpose: z.boolean().optional(),
  group_label: z.string().trim().max(60).nullable().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
};

export const recurringWorkCreateSchema = z.object({ kind: z.enum(KIND_VALUES).default('citadel_task'), ...fields }).strict();

/** kind never changes after create. */
export const recurringWorkUpdateSchema = z.object(fields).strict();

type Shape = {
  kind: (typeof KIND_VALUES)[number];
  sop_id?: string | null;
  cadence?: string | null;
  cron_expr?: string | null;
  job_key?: string | null;
  source_kind?: string | null;
  source_id?: string | null;
};

/** The fields each kind must carry (400 when one is missing). */
export function assertKindFields(shape: Shape) {
  const need = (names: (keyof Shape)[]) => {
    const missing = names.filter((n) => !shape[n]);
    if (missing.length > 0) throw new ApiError(`${shape.kind} requires ${missing.join(' and ')}`, 400);
  };
  if (shape.kind === 'citadel_task') need(['sop_id', 'cadence']);
  else if (shape.kind === 'machine_job') need(['cron_expr', 'job_key']);
  else need(['source_kind', 'source_id']);
}

/**
 * A row with a charter keeps no client or site of its own: they are the charter's, so a charter that changes client
 * moves its recurring work with it (nothing kept in two places). 400 when both are sent.
 */
export function assertNoCopyOfCharter(shape: { charter_id?: string | null; client_id?: string | null; site_id?: string | null }) {
  if (shape.charter_id && (shape.client_id || shape.site_id)) {
    throw new ApiError('A charter row takes its client and site from the charter; send charter_id or client_id and site_id, not both', 400);
  }
}

type LinkIds = {
  sop_id?: string | null;
  charter_id?: string | null;
  owner_id?: string | null;
  client_id?: string | null;
  site_id?: string | null;
  initiative_id?: string | null;
};

/** 404 for any named record that does not exist. Resolves the charter (when named) so callers can fall back on it. */
export async function assertLinksExist(ids: LinkIds) {
  let charter: { id: string; client_id: string; site_id: string | null } | null = null;
  if (ids.charter_id) {
    charter = await prisma.charter.findFirst({ where: { id: ids.charter_id, is_deleted: false }, select: { id: true, client_id: true, site_id: true } });
    if (!charter) throw new ApiError('Charter not found', 404);
  }
  if (ids.sop_id) {
    const sop = await prisma.sop.findUnique({ where: { id: ids.sop_id }, select: { id: true } });
    if (!sop) throw new ApiError('SOP not found', 404);
  }
  if (ids.owner_id) {
    const owner = await prisma.user.findUnique({ where: { id: ids.owner_id }, select: { id: true } });
    if (!owner) throw new ApiError('Owner not found', 404);
  }
  if (ids.client_id) {
    const client = await prisma.client.findUnique({ where: { id: ids.client_id, is_deleted: false }, select: { id: true } });
    if (!client) throw new ApiError('Client not found', 404);
  }
  if (ids.site_id) {
    const site = await prisma.site.findUnique({ where: { id: ids.site_id }, select: { id: true } });
    if (!site) throw new ApiError('Site not found', 404);
  }
  if (ids.initiative_id) await assertInitiativeLinkable(ids.initiative_id);
  return { charter };
}

/** Stopped = the last run failed and the row is not paused on purpose. */
export function isStopped(row: { last_run_ok?: unknown; paused_on_purpose?: unknown }) {
  return row.last_run_ok === false && !row.paused_on_purpose;
}

type GroupableRow = {
  title: unknown;
  group_label: string | null;
  client: { name: string } | null;
  last_run_ok: unknown;
  paused_on_purpose: unknown;
};

/** A row's group: its own label, else its client's name, else Indelible. */
export function groupLabelFor(row: Pick<GroupableRow, 'group_label' | 'client'>) {
  return row.group_label || row.client?.name || 'Indelible';
}

/** Groups ordered by label; inside a group stopped rows first, then title. */
export function groupRecurringWork<T extends GroupableRow>(rows: T[]) {
  const byLabel = new Map<string, T[]>();
  for (const row of rows) {
    const label = groupLabelFor(row);
    byLabel.set(label, [...(byLabel.get(label) ?? []), row]);
  }
  return [...byLabel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groupRows]) => {
      const sorted = [...groupRows].sort((a, b) => Number(isStopped(b)) - Number(isStopped(a)) || String(a.title ?? '').localeCompare(String(b.title ?? '')));
      return { label, count: sorted.length, stopped: sorted.filter(isStopped).length, rows: sorted };
    });
}
