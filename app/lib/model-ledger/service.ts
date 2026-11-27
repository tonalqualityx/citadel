/**
 * Model ledger: the daily rollup the Bast machine pushes (task ab418893; Mike, 2026-11-27: "Let's keep it local for now and
 * run the cleaned up version of it you're recommending."). Raw runs stay on the machine in ~/.model-ledger/runs.jsonl;
 * Citadel keeps one row per Eastern day, model family and task type, and shows the totals on the Recurring work tab.
 */
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import type { LedgerLine, LedgerSummary } from './types';

export type { LedgerLine, LedgerSummary } from './types';

type LedgerDb = Pick<PrismaClient, 'modelLedgerDay'>;

const count = z.number().int().min(0).max(1_000_000);

export const ledgerDaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
  model: z.string().trim().min(1).max(20),
  task_type: z.string().trim().min(1).max(60),
  runs: count.default(0),
  cards: count.default(0),
  finished: count.default(0),
  first_try: count.default(0),
  escalations: count.default(0),
  cost_usd: z.number().min(0).max(10_000_000).default(0),
  unpriced_runs: count.default(0),
});

export const ledgerPushSchema = z.object({
  rows: z.array(ledgerDaySchema).min(1).max(500),
});

export type LedgerDayInput = z.infer<typeof ledgerDaySchema>;

const dayDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** Upsert each (day, model, task_type) row: a repeat push of the same day replaces that day's numbers. Never deletes. */
export async function upsertLedgerDays(rows: LedgerDayInput[], db: LedgerDb = defaultDb): Promise<{ upserted: number }> {
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.day}|${r.model}|${r.task_type}`;
    if (seen.has(key)) throw new z.ZodError([{ code: 'custom', path: ['rows'], message: `duplicate row ${key}` }]);
    seen.add(key);
  }
  let upserted = 0;
  for (const r of rows) {
    const data = {
      runs: r.runs,
      cards: r.cards,
      finished: r.finished,
      first_try: r.first_try,
      escalations: r.escalations,
      cost_usd: r.cost_usd,
      unpriced_runs: r.unpriced_runs,
    };
    await db.modelLedgerDay.upsert({
      where: { day_model_task_type: { day: dayDate(r.day), model: r.model, task_type: r.task_type } },
      create: { day: dayDate(r.day), model: r.model, task_type: r.task_type, ...data },
      update: data,
    });
    upserted += 1;
  }
  return { upserted };
}

type StoredDay = {
  day: Date;
  model: string;
  task_type: string;
  runs: number;
  cards: number;
  finished: number;
  first_try: number;
  escalations: number;
  cost_usd: Prisma.Decimal | number | string;
};

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Totals per model and task type over the stored days, most expensive first. */
export function summarize(days: StoredDay[], windowDays: number, since: string): LedgerSummary {
  const groups = new Map<string, LedgerLine>();
  let latest: string | null = null;
  for (const d of days) {
    const iso = d.day.toISOString().slice(0, 10);
    if (!latest || iso > latest) latest = iso;
    const key = `${d.model}|${d.task_type}`;
    const g =
      groups.get(key) ??
      ({ model: d.model, task_type: d.task_type, runs: 0, cards: 0, finished: 0, first_try: 0, escalations: 0, cost_usd: 0, first_try_rate: null, cost_per_finished_card: null } as LedgerLine);
    g.runs += d.runs;
    g.cards += d.cards;
    g.finished += d.finished;
    g.first_try += d.first_try;
    g.escalations += d.escalations;
    g.cost_usd += Number(d.cost_usd.toString());
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => ({
    ...g,
    cost_usd: round(g.cost_usd, 2),
    first_try_rate: g.cards > 0 ? round(g.first_try / g.cards, 2) : null,
    cost_per_finished_card: g.finished > 0 ? round(g.cost_usd / g.finished, 2) : null,
  }));
  lines.sort((a, b) => b.cost_usd - a.cost_usd || b.runs - a.runs || a.model.localeCompare(b.model));
  return {
    window_days: windowDays,
    since,
    latest_day: latest,
    total_cost_usd: round(lines.reduce((n, l) => n + l.cost_usd, 0), 2),
    total_runs: lines.reduce((n, l) => n + l.runs, 0),
    lines,
  };
}

/** The last `windowDays` stored days (counting back from today, Eastern), summarized. */
export async function ledgerSummary(windowDays: number, now: Date = new Date(), db: LedgerDb = defaultDb): Promise<LedgerSummary> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const sinceDate = dayDate(today);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - (windowDays - 1));
  const since = sinceDate.toISOString().slice(0, 10);
  const days = await db.modelLedgerDay.findMany({ where: { day: { gte: sinceDate } }, orderBy: { day: 'asc' } });
  return summarize(days, windowDays, since);
}
