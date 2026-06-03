import { prisma } from '@/lib/db/prisma';
import { notifyTroubadorRunCreated } from './troubador-notifications';

export interface SchedulerResult {
  runs_created: number;
  skipped: number;
  details: Array<{
    schedule_id: string;
    action: 'created' | 'skipped';
    reason?: string;
    run_id?: string;
  }>;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Format a date as e.g. 'Jun 2026' using UTC fields (locale-independent). */
function formatMonthYear(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Stages that count as an "open" (still-active) run.
const CLOSED_STAGES = new Set(['done', 'cancelled']);

/**
 * Instantiate due Runs from active Schedules.
 *
 * Cadence model: "keep the calendar full". A run produces `target_article_count`
 * articles; at `publish_per_week` per week those articles last `coverageDays`. The
 * next run should start `lead_time_days` before coverage runs out.
 *
 * Never backfills — creates at most ONE run per schedule per call.
 */
export async function instantiateDueRuns(now: Date = new Date()): Promise<SchedulerResult> {
  const result: SchedulerResult = { runs_created: 0, skipped: 0, details: [] };

  const schedules = await prisma.troubadorSchedule.findMany({
    where: { status: 'active', is_deleted: false },
    include: {
      client: { select: { id: true, name: true } },
      site: { select: { id: true } },
      runs: {
        where: { is_deleted: false },
        select: { id: true, stage: true, created_at: true },
      },
    },
  });

  const skip = (schedule_id: string, reason: string) => {
    result.skipped += 1;
    result.details.push({ schedule_id, action: 'skipped', reason });
  };

  for (const schedule of schedules) {
    // Before start date → not yet active.
    if (now < schedule.start_date) {
      skip(schedule.id, 'before start date');
      continue;
    }

    // Open run = any run not in a closed stage.
    const hasOpenRun = schedule.runs.some((r) => !CLOSED_STAGES.has(r.stage));

    if (hasOpenRun && schedule.allow_concurrent === false) {
      skip(schedule.id, 'prior run still open');
      continue;
    }

    // Determine whether a run is due.
    const lastRunAt = schedule.last_run_at ?? null;
    let due: boolean;

    if (lastRunAt === null) {
      // First run — due now (we already know now >= start_date).
      due = true;
    } else {
      const perWeek = Number(schedule.publish_per_week);
      let coverageDays: number;
      if (!(perWeek > 0)) {
        // Invalid cadence — default coverage to count * 7 days rather than dividing by zero.
        coverageDays = schedule.target_article_count * 7;
      } else {
        coverageDays = (schedule.target_article_count / perWeek) * 7;
      }
      const nextDue = new Date(
        new Date(lastRunAt).getTime() + (coverageDays - schedule.lead_time_days) * DAY_MS
      );
      due = now >= nextDue;
    }

    if (!due) {
      skip(schedule.id, 'calendar still full');
      continue;
    }

    // Skip-once: consume the flag, advance bookkeeping, but create nothing.
    if (schedule.skip_next === true) {
      await prisma.troubadorSchedule.update({
        where: { id: schedule.id },
        data: { skip_next: false, last_run_at: now },
      });
      skip(schedule.id, 'skip-once');
      continue;
    }

    // Due → create exactly one run.
    const run = await prisma.troubadorRun.create({
      data: {
        client_id: schedule.client_id,
        site_id: schedule.site_id,
        schedule_id: schedule.id,
        title: `${schedule.name} — ${formatMonthYear(now)}`,
        stage: 'planning',
        assignee_id: schedule.default_assignee_id ?? null,
        brief: schedule.overarching_goals ?? null,
      },
    });

    await prisma.troubadorSchedule.update({
      where: { id: schedule.id },
      data: { last_run_at: now },
    });

    // Fire-and-forget notification (already swallows its own errors, but guard anyway).
    try {
      await notifyTroubadorRunCreated(run.id);
    } catch (error) {
      console.error('notifyTroubadorRunCreated failed in scheduler:', error);
    }

    result.runs_created += 1;
    result.details.push({ schedule_id: schedule.id, action: 'created', run_id: run.id });
  }

  return result;
}
