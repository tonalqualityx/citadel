/**
 * The nightly read of Citadel-computed initiative numbers (design.md 2.2). A number whose source is `citadel:<key>` gets one
 * reading (source `citadel`) per UTC day. Keys: projects_signed, proposals_sent, charters_active, retainer_hours_sold.
 * Any other key is skipped and reported, never an error. After the readings, stored health is refreshed on every
 * non-deleted initiative.
 */
import { prisma } from '@/lib/db/prisma';
import { recordReading } from './readings';
import { recomputeHealth } from './service';

export const CITADEL_KEYS = ['projects_signed', 'proposals_sent', 'charters_active', 'retainer_hours_sold'] as const;
export type CitadelKey = (typeof CITADEL_KEYS)[number];


export interface CitadelNumberRun {
  read: number;
  skipped: { number_id: string; source: string; reason: string }[];
  refreshed: number;
}

type Window = { after: Date | null; upTo: Date };

export function isCitadelKey(key: string): key is CitadelKey {
  return (CITADEL_KEYS as readonly string[]).includes(key);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Projects on this initiative whose accord was signed inside the window. No accord or no signed_at: not counted. */
export async function countProjectsSigned(initiativeId: string, w: Window): Promise<number> {
  if (!w.after) return 0;
  return prisma.project.count({
    where: {
      initiative_id: initiativeId,
      is_deleted: false,
      accord: { is: { is_deleted: false, signed_at: { gt: w.after, lte: w.upTo } } },
    },
  });
}

/** Accords with a project on this initiative, counted once each, at the earliest sent_at among their proposals. */
export async function countProposalsSent(initiativeId: string, w: Window): Promise<number> {
  if (!w.after) return 0;
  const accords = await prisma.accord.findMany({
    where: { is_deleted: false, projects: { some: { initiative_id: initiativeId, is_deleted: false } } },
    select: {
      id: true,
      proposals: { where: { is_deleted: false, sent_at: { not: null } }, select: { sent_at: true } },
    },
  });
  let count = 0;
  for (const a of accords) {
    const times = (a.proposals as { sent_at: Date | null }[]).flatMap((p) => (p.sent_at ? [p.sent_at.getTime()] : []));
    if (times.length === 0) continue;
    const first = Math.min(...times);
    if (first > w.after.getTime() && first <= w.upTo.getTime()) count += 1;
  }
  return count;
}

async function activeCharters() {
  return prisma.charter.findMany({
    where: { status: 'active', is_deleted: false },
    select: { budget_hours: true, billing_period: true },
  });
}

export async function countChartersActive(): Promise<number> {
  return prisma.charter.count({ where: { status: 'active', is_deleted: false } });
}

/** Active charters' budget hours, each as monthly hours (annual divided by 12); no budget contributes nothing. */
export async function sumRetainerHoursSold(): Promise<number> {
  const charters = await activeCharters();
  let total = 0;
  for (const c of charters) {
    if (c.budget_hours === null || c.budget_hours === undefined) continue;
    const hours = Number(c.budget_hours.toString());
    if (!Number.isFinite(hours)) continue;
    total += c.billing_period === 'annually' ? hours / 12 : hours;
  }
  return Math.round(total * 100) / 100;
}

async function readKey(key: CitadelKey, initiativeId: string, w: Window): Promise<number> {
  switch (key) {
    case 'projects_signed':
      return countProjectsSigned(initiativeId, w);
    case 'proposals_sent':
      return countProposalsSent(initiativeId, w);
    case 'charters_active':
      return countChartersActive();
    case 'retainer_hours_sold':
      return sumRetainerHoursSold();
  }
}

export async function runCitadelNumbers(now: Date = new Date()): Promise<CitadelNumberRun> {
  const initiatives = await prisma.initiative.findMany({
    where: { is_deleted: false },
    select: { id: true, numbers: { orderBy: { position: 'asc' } } },
  });

  const skipped: CitadelNumberRun['skipped'] = [];
  let read = 0;
  const dayStart = startOfUtcDay(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  for (const initiative of initiatives) {
    for (const number of initiative.numbers) {
      if (!number.source.startsWith('citadel:')) continue;
      const key = number.source.slice('citadel:'.length);
      if (!isCitadelKey(key)) {
        skipped.push({ number_id: number.id, source: number.source, reason: `unknown key "${key}"` });
        continue;
      }
      try {
        const today = await prisma.initiativeReading.findFirst({
          where: { number_id: number.id, source: 'citadel', read_at: { gte: dayStart, lt: dayEnd } },
          select: { id: true },
        });
        if (today) {
          skipped.push({ number_id: number.id, source: number.source, reason: 'already read today' });
          continue;
        }
        const value = await readKey(key, initiative.id, { after: number.baseline_at ?? null, upTo: now });
        await recordReading(number, value, now, 'citadel');
        read += 1;
      } catch (error) {
        skipped.push({ number_id: number.id, source: number.source, reason: `error: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }

  let refreshed = 0;
  for (const initiative of initiatives) {
    // The quotes-sent zero note is part of the health line itself (health.ts), so a later read never wipes it.
    await recomputeHealth(initiative.id, now);
    refreshed += 1;
  }

  return { read, skipped, refreshed };
}
