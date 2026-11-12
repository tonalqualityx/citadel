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
import { handledMailMeasure } from '@/lib/work/intake';
import { keptOffNow } from '@/lib/work/home-guard';
import { RUN_STALE_MS, ownerOnHome } from '../keeper/run';
import { appendHomeAction, dateOnly } from '../state';
import { GUARD_ACTION, LEARN, LEARNED_ACTION, MEASURES_ACTION, guardLine, learnedDetails, learnedLine, weekLine } from './copy';
import { guard, measuresWeek, type DailySnapshot, type GuardResult, type WeekMeasures } from './measures';
import { buildDailySnapshot, loadWeekReads, writeGuesses, type GuessRun } from './store';
import { buildSignals } from './signals';
import { WEIGHT, planShifts, type Shift } from './weights';
import { applyShifts, historyDays, learningOn, loadCurrentWeights, loadTaps, resolveEvidence } from './weights-store';
import { previousWeek, weekdayOfYmd } from './working-hours';

const RUN_KIND = 'learn';
const TX_TIMEOUT_MS = 30_000;

export interface LearnLine {
  action: typeof MEASURES_ACTION | typeof GUARD_ACTION | typeof LEARNED_ACTION;
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
  /** Slice 7b: the weight shifts this run makes (dry run: would make). Evidence keys and labels, never a number the screen shows. */
  learned?: LearnedShift[];
  action_ids: string[];
  /** Slice 7c: the nightly time guesses (written to his home_item_state rows only). `error` when that step failed; the other steps are unaffected. */
  guesses?: GuessRun | { error: string };
}

export interface LearnedShift {
  evidence_key: string;
  label: string;
  dir: 'up' | 'down';
  line: string;
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
      guess_errors: reads.guess_errors,
      handled_mail: await handledMailMeasure(db, ownerId, dateOnly(start), new Date(dateOnly(end).getTime() + 86_400_000)),
      kept_off: await keptOffNow(db),
    });
    const fired = guard(reads.guard_rows);
    week = { week_start: start, week_end: end, measures, guard: fired };
    const line = weekLine(measures);
    if (line) lines.push({ action: MEASURES_ACTION, line: line.text, details: line.details });
    if (fired) lines.push({ action: GUARD_ACTION, line: guardLine(fired), details: guardDetails(fired) });
  }

  // Slice 7b: the Monday weight step. Reads only; the shifts are written by runLearn.
  let shifts: Shift[] = [];
  const labels = new Map<string, string>();
  const learned: LearnedShift[] = [];
  if (monday && (await learningOn(db, ownerId))) {
    const [taps, current, days] = await Promise.all([
      loadTaps(db, ownerId, now, tz, WEIGHT.windowDays),
      loadCurrentWeights(db, ownerId),
      historyDays(db, ownerId, now),
    ]);
    const resolved = await resolveEvidence(db, ownerId, Array.from(new Set(taps.map((t) => t.item_key).filter((k): k is string => !!k))));
    const signals = buildSignals(taps, resolved.evidence);
    shifts = planShifts({ signals, current, historyDays: days, now, monday, learning: true });
    for (const [k, v] of resolved.labels) labels.set(k, v);
    for (const s of shifts) {
      const label = labels.get(s.evidence_key) ?? s.evidence_key.slice(s.evidence_key.indexOf(':') + 1);
      const dir = s.to > s.from ? 'up' : 'down';
      learned.push({ evidence_key: s.evidence_key, label, dir, line: learnedLine(s.evidence_key, label, dir) });
      lines.push({ action: LEARNED_ACTION, line: learnedLine(s.evidence_key, label, dir), details: learnedDetails(s.up, s.down) });
    }
  }
  return { date, monday, daily, week, lines, shifts, labels, learned };
}

export async function runLearn(db: PrismaClient, ownerId: string, now: Date, opts: { dryRun: boolean }): Promise<LearnResult> {
  const { ok, timezone } = await ownerOnHome(db, ownerId);
  if (!ok) return { dry_run: opts.dryRun, skipped: 'home_off', action_ids: [] };

  if (opts.dryRun) {
    const { shifts: _s, labels: _l, ...built } = await build(db, ownerId, now, timezone);
    void _s;
    void _l;
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

  const result = await db.$transaction(
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
        if (l.action === LEARNED_ACTION) continue; // written below with its weight row
        const action = await appendHomeAction(tx, ownerId, {
          item_key: null,
          action: l.action,
          source: 'keeper',
          after: { line: l.line, details: l.details },
          undo_until: null,
        });
        actionIds.push(action.id);
      }

      if (built.shifts.length > 0) {
        const current = await loadCurrentWeights(tx, ownerId);
        const applied = await applyShifts(tx, ownerId, built.shifts, built.labels, current, now);
        for (const a of applied) actionIds.push(a.action_id);
      }

      await tx.homeKeeperRun.update({
        where: runKey,
        data: {
          finished_at: now,
          counts: { daily: 1, week: built.week ? 1 : 0, lines: built.lines.length, learned: built.shifts.length, min_business_days: LEARN.minBusinessDays },
        },
      });
      const { shifts: _s, labels: _l, ...out } = built;
      void _s;
      void _l;
      return { dry_run: false, ...out, action_ids: actionIds };
    },
    { timeout: TX_TIMEOUT_MS },
  );

  // Slice 7c: one more step. Display-only guesses for his open tasks. Its failure never fails the steps above.
  if (!result.already_ran) {
    try {
      result.guesses = await writeGuesses(db, ownerId, now);
    } catch (err) {
      result.guesses = { error: err instanceof Error ? err.message.slice(0, 200) : 'guess step failed' };
    }
  }
  return result;
}
