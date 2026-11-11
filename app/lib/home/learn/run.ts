/**
 * Slice 7a: the learn step. A report: it writes only the owner's home_measures rows, one home_keeper_runs row of kind
 * 'learn' and home_actions lines (keeper_measures, keeper_guard; source keeper, no Undo). It changes no ranking and no
 * Task, EmailAsk, Wait or Project row, and nothing for any other user.
 *
 * Every night: one `daily` snapshot. On a Monday (his zone): also the `week` row for the Monday to Sunday before, and
 * the Monday line and the guard line when they qualify. Dry run (GET): the same answer, nothing written.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { zonedDateString } from '../act';
import { RUN_STALE_MS, ownerOnHome } from '../keeper/run';
import { appendHomeAction, dateOnly } from '../state';
import { GUARD_ACTION, LEARN, MEASURES_ACTION, guardLine, weekLine } from './copy';
import { guard, measuresWeek, type DailySnapshot, type GuardResult, type WeekMeasures } from './measures';
import { buildDailySnapshot, loadWeekReads } from './store';
import { previousWeek, weekdayOfYmd } from './working-hours';

const RUN_KIND = 'learn';
const TX_TIMEOUT_MS = 30_000;

export interface LearnLine {
  action: typeof MEASURES_ACTION | typeof GUARD_ACTION;
  line: string;
  details: string[];
}

export interface LearnWeek {
  week_start: string;
  week_end: string;
  measures: WeekMeasures;
  guard: GuardResult | null;
}

export interface LearnResult {
  dry_run: boolean;
  skipped?: 'home_off';
  already_ran?: true;
  date?: string;
  monday?: boolean;
  daily?: DailySnapshot;
  week?: LearnWeek | null;
  lines?: LearnLine[];
  action_ids: string[];
}

const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** The guard's details, plain words. */
function guardDetails(g: GuardResult): string[] {
  return [
    `${g.rows} first taps on sign-offs and approvals last week, ${g.approvals} of them approvals.`,
    `The middle gap since your tap before was ${Math.max(1, Math.round(g.median_gap_ms / 1000))} seconds.`,
  ];
}

async function build(db: PrismaClient, ownerId: string, now: Date, tz: string) {
  const date = zonedDateString(now, tz);
  const monday = weekdayOfYmd(date) === 1;
  const daily = await buildDailySnapshot(db, ownerId, now, tz, date);
  let week: LearnWeek | null = null;
  const lines: LearnLine[] = [];
  if (monday) {
    const { start, end } = previousWeek(date);
    const reads = await loadWeekReads(db, ownerId, tz, start, end);
    const measures = measuresWeek({
      week_start: start,
      week_end: end,
      tz,
      now,
      emergencies: reads.emergencies,
      snapshots: reads.snapshots,
      prev_snapshot: reads.prev_snapshot,
      task_changes: reads.task_changes,
      first_action_day: reads.first_action_day,
      hard_dates: reads.hard_dates,
      today_days: reads.today_days,
    });
    const fired = guard(reads.guard_rows);
    week = { week_start: start, week_end: end, measures, guard: fired };
    const line = weekLine(measures);
    if (line) lines.push({ action: MEASURES_ACTION, line: line.text, details: line.details });
    if (fired) lines.push({ action: GUARD_ACTION, line: guardLine(fired), details: guardDetails(fired) });
  }
  return { date, monday, daily, week, lines };
}

export async function runLearn(db: PrismaClient, ownerId: string, now: Date, opts: { dryRun: boolean }): Promise<LearnResult> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { dry_run: opts.dryRun, skipped: 'home_off', action_ids: [] };

  if (opts.dryRun) {
    const built = await build(db, ownerId, now, timezone);
    return { dry_run: true, ...built, action_ids: [] };
  }

  const date = zonedDateString(now, timezone);
  const runDate = dateOnly(date);
  const runKey = { user_id_date_kind: { user_id: ownerId, date: runDate, kind: RUN_KIND } };
  const prior = await db.homeKeeperRun.findUnique({ where: runKey, select: { finished_at: true, started_at: true } });
  if (prior && (prior.finished_at || now.getTime() - prior.started_at.getTime() < RUN_STALE_MS)) {
    return { dry_run: false, already_ran: true, action_ids: [] };
  }

  const built = await build(db, ownerId, now, timezone);

  return db.$transaction(
    async (tx): Promise<LearnResult> => {
      const row = await tx.homeKeeperRun.findUnique({ where: runKey });
      if (row) {
        if (row.finished_at || now.getTime() - row.started_at.getTime() < RUN_STALE_MS) return { dry_run: false, already_ran: true, action_ids: [] };
        const taken = await tx.homeKeeperRun.updateMany({ where: { id: row.id, finished_at: null, started_at: row.started_at }, data: { started_at: now, error: null } });
        if (taken.count !== 1) return { dry_run: false, already_ran: true, action_ids: [] };
      } else {
        const made = await tx.homeKeeperRun.createMany({ data: [{ user_id: ownerId, date: runDate, kind: RUN_KIND, started_at: now }], skipDuplicates: true });
        if (made.count !== 1) return { dry_run: false, already_ran: true, action_ids: [] };
      }

      await tx.homeMeasure.upsert({
        where: { user_id_date_kind: { user_id: ownerId, date: runDate, kind: 'daily' } },
        create: { user_id: ownerId, date: runDate, kind: 'daily', value: json(built.daily) },
        update: { value: json(built.daily) },
      });
      if (built.week) {
        const weekDate = dateOnly(built.week.week_start);
        const value = json({ ...built.week, lines: built.lines });
        await tx.homeMeasure.upsert({
          where: { user_id_date_kind: { user_id: ownerId, date: weekDate, kind: 'week' } },
          create: { user_id: ownerId, date: weekDate, kind: 'week', value },
          update: { value },
        });
      }

      const actionIds: string[] = [];
      for (const l of built.lines) {
        const action = await appendHomeAction(tx, ownerId, {
          item_key: null,
          action: l.action,
          source: 'keeper',
          after: { line: l.line, details: l.details },
          undo_until: null,
        });
        actionIds.push(action.id);
      }

      await tx.homeKeeperRun.update({
        where: runKey,
        data: {
          finished_at: now,
          counts: { daily: 1, week: built.week ? 1 : 0, lines: built.lines.length, min_business_days: LEARN.minBusinessDays },
        },
      });
      return { dry_run: false, ...built, action_ids: actionIds };
    },
    { timeout: TX_TIMEOUT_MS },
  );
}

