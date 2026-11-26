/**
 * Machine job import (design.md 2.5): the Bast machine posts its full list of scheduled jobs; each becomes one
 * `machine_job` row keyed by job_key. The sync never touches initiative, client, site or sort order (people set those
 * in Citadel), and a job missing from the list is marked inactive, never deleted.
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

const isoDate = z.string().datetime({ offset: true }).nullable().optional();

export const machineJobItemSchema = z
  .object({
    job_key: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    owner_id: z.string().uuid().nullable().optional(),
    produces: z.string().trim().max(300).nullable().optional(),
    group_label: z.string().trim().max(60).nullable().optional(),
    schedule_text: z.string().trim().max(120).nullable().optional(),
    cron_expr: z.string().trim().max(60).nullable().optional(),
    is_plumbing: z.boolean().optional(),
    paused_on_purpose: z.boolean().optional(),
    last_run_at: isoDate,
    last_run_ok: z.boolean().nullable().optional(),
    last_run_note: z.string().trim().max(300).nullable().optional(),
    next_run_at: isoDate,
  })
  .strict();

/** An empty list is a 400 so a broken import can never mark everything inactive. */
export const machineSyncSchema = z.object({ jobs: z.array(machineJobItemSchema).min(1).max(500) }).strict();

export type MachineJobItem = z.infer<typeof machineJobItemSchema>;

export interface MachineSyncResult {
  created: number;
  updated: number;
  deactivated: number;
  skipped: string[];
  total: number;
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

/** The fields the sync owns. Only keys the item carried are written (an absent key leaves the stored value alone). */
function syncedFields(item: MachineJobItem) {
  const out: Record<string, unknown> = {
    title: item.title,
    owner_id: item.owner_id,
    produces: item.produces,
    group_label: item.group_label,
    schedule_text: item.schedule_text,
    cron_expr: item.cron_expr,
    is_plumbing: item.is_plumbing,
    paused_on_purpose: item.paused_on_purpose,
    last_run_at: toDate(item.last_run_at),
    last_run_ok: item.last_run_ok,
    last_run_note: item.last_run_note,
    next_run_at: toDate(item.next_run_at),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export async function syncMachineJobs(jobs: MachineJobItem[]): Promise<MachineSyncResult> {
  const keys = jobs.map((j) => j.job_key);
  if (new Set(keys).size !== keys.length) {
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    throw new ApiError(`Duplicate job_key in one import: ${dup}`, 400);
  }

  const ownerIds = [...new Set(jobs.map((j) => j.owner_id).filter((v): v is string => Boolean(v)))];
  if (ownerIds.length > 0) {
    const found = await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true } });
    const have = new Set(found.map((u) => u.id));
    const unknown = ownerIds.find((id) => !have.has(id));
    if (unknown) throw new ApiError(`Unknown owner_id: ${unknown}`, 400);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.recurringWork.findMany({ where: { job_key: { in: keys } }, select: { id: true, job_key: true, kind: true } });
    const byKey = new Map(existing.map((r) => [r.job_key as string, r]));

    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    for (const item of jobs) {
      const row = byKey.get(item.job_key);
      const fields = syncedFields(item) as Prisma.RecurringWorkUncheckedUpdateInput;
      if (!row) {
        await tx.recurringWork.create({
          data: { ...(fields as Prisma.RecurringWorkUncheckedCreateInput), kind: 'machine_job', job_key: item.job_key, title: item.title, is_active: true },
        });
        created++;
      } else if (row.kind !== 'machine_job') {
        skipped.push(item.job_key);
      } else {
        await tx.recurringWork.update({ where: { id: row.id }, data: { ...fields, is_active: true } });
        updated++;
      }
    }

    // every active machine job the list no longer names is marked inactive, never deleted
    const gone = await tx.recurringWork.updateMany({
      where: { kind: 'machine_job', is_active: true, job_key: { notIn: keys } },
      data: { is_active: false },
    });

    return { created, updated, deactivated: gone.count, skipped, total: jobs.length };
  }, { timeout: 30000 });
}
