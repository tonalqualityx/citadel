/**
 * Designer Portal v2: job claim, lease, report and park (SPEC 6.1a).
 *
 * - A claim takes the oldest queued job whose `not_before` is null or past (a `brief` job is claimable earlier once
 *   every reference of its track has settled), in ONE statement with `FOR UPDATE SKIP LOCKED`, so two concurrent
 *   claims give one winner. It sets claimed, `claimed_by`, `lease_until = now + 10 minutes`, `attempts + 1`.
 * - At claim time every job whose lease expired goes back to queued; a job that already used its second attempt
 *   fails for good instead.
 * - A job that fails with attempts left is queued again with its error kept (the runner injects it as context);
 *   at the second attempt it stays failed: the task gets the tag `needs-mike` and a comment with the error tail,
 *   and `busy_job_id` is cleared if it pointed at the job.
 * - Claiming a job with a task sets the task in_progress and assigns the key's user (Bast) when it has no assignee.
 */
import { Prisma } from '@prisma/client';
import type { DesignJob, DesignJobKind } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import {
  ADOPT_KINDS, BRIEF_DELAY_MINUTES, JOB_ATTEMPT_LIMIT, JOB_LEASE_SECONDS, NEEDS_MIKE_TAG,
  addInternalComment, addTaskTag, clearBusy, completeStageTask, errorTail, loadTrack, queueJob, trackTx, type TrackScope,
} from './track-core';

// Columns are `timestamp without time zone` holding UTC, so compare against UTC now (lib/tasks/claims.ts precedent).
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

export const MAX_JOB_RESULT_BYTES = 256 * 1024;
export const MAX_JOB_ERROR_BYTES = 8 * 1024;

const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');

export function jobView(j: DesignJob) {
  return {
    id: j.id, track_id: j.track_id, kind: j.kind, status: j.status, task_id: j.task_id, payload: j.payload, result: j.result,
    error: j.error, attempts: j.attempts, not_before: j.not_before, claimed_by: j.claimed_by, lease_until: j.lease_until,
    command_id: j.command_id, cost_usd: j.cost_usd === null ? null : Number(j.cost_usd.toString()), log_asset_id: j.log_asset_id,
    started_at: j.started_at, finished_at: j.finished_at, created_at: j.created_at,
  };
}

/**
 * Park a job that failed for good: status failed, the `needs-mike` tag and an error-tail comment on its task, busy
 * cleared when it pointed at this job. The job row itself is already failed (the caller's compare and set).
 */
async function park(scope: TrackScope, job: DesignJob, error: string, actorId: string): Promise<void> {
  const { tx } = scope;
  await clearBusy(tx, job.track_id, job.id);
  if (!job.task_id) return;
  await addTaskTag(tx, job.task_id, NEEDS_MIKE_TAG);
  await addInternalComment(tx, job.task_id, actorId, `The ${job.kind.replace(/_/g, ' ')} job failed after ${job.attempts} attempts and needs Mike.\n\n${errorTail(error)}`);
}

/**
 * Move a job that is claimed or running to its next state after a failure, as a compare and set on its status: back
 * to queued with attempts left, failed for good (and parked) at the second attempt. Returns the outcome, or null when
 * another caller already moved it.
 */
export async function failOrRequeue(
  scope: TrackScope, job: DesignJob, error: string, actorId: string, extra: { cost_usd?: number | null; log_asset_id?: string | null } = {},
): Promise<'requeued' | 'failed' | null> {
  const { tx } = scope;
  const forGood = job.attempts >= JOB_ATTEMPT_LIMIT;
  const data: Prisma.DesignJobUncheckedUpdateManyInput = {
    error: error.slice(0, MAX_JOB_ERROR_BYTES),
    claimed_by: null,
    lease_until: null,
    ...(extra.cost_usd != null ? { cost_usd: extra.cost_usd } : {}),
    ...(extra.log_asset_id ? { log_asset_id: extra.log_asset_id } : {}),
    ...(forGood ? { status: 'failed', finished_at: new Date() } : { status: 'queued' }),
  };
  const res = await tx.designJob.updateMany({ where: { id: job.id, status: { in: ['claimed', 'running'] }, attempts: job.attempts }, data });
  if (res.count !== 1) return null;
  if (!forGood) return 'requeued';
  await park(scope, job, error, actorId);
  return 'failed';
}

/** Return every job whose lease expired to queued (or fail it for good at its second attempt). */
export async function expireLeases(scope: TrackScope, actorId: string): Promise<number> {
  const { tx } = scope;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM design_jobs WHERE status IN ('claimed', 'running') AND lease_until < ${NOW} ORDER BY created_at FOR UPDATE SKIP LOCKED`;
  let n = 0;
  for (const r of rows) {
    const job = await tx.designJob.findUnique({ where: { id: r.id } });
    if (job && (await failOrRequeue(scope, job, 'lease_expired: the runner stopped renewing this job', actorId))) n++;
  }
  return n;
}

/**
 * Claim the oldest claimable job. `runnerId` is recorded on the job. Returns null when nothing is claimable (204).
 * Everything happens in one transaction: a lost race returns null, never a half-claimed job.
 */
export async function claimJob(input: { userId: string; runnerId: string; kinds?: DesignJobKind[] }): Promise<DesignJob | null> {
  return trackTx(async (scope) => {
    const { tx } = scope;
    await expireLeases(scope, input.userId);
    const kindFilter = input.kinds && input.kinds.length > 0 ? Prisma.sql`AND j.kind::text = ANY(${input.kinds as string[]}::text[])` : Prisma.empty;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE design_jobs SET
        status = 'claimed',
        claimed_by = ${input.runnerId},
        lease_until = ${NOW} + make_interval(secs => ${JOB_LEASE_SECONDS}::int),
        attempts = attempts + 1,
        started_at = COALESCE(started_at, ${NOW}),
        updated_at = ${NOW}
      WHERE id = (
        SELECT j.id FROM design_jobs j
        WHERE j.status = 'queued' ${kindFilter}
          AND (
            j.not_before IS NULL OR j.not_before <= ${NOW}
            OR (j.kind = 'brief' AND NOT EXISTS (
              SELECT 1 FROM design_references r
              WHERE r.track_id = j.track_id AND (r.capture_status = 'queued' OR (r.capture_status = 'none' AND r.url IS NOT NULL))))
          )
        ORDER BY j.created_at, j.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (rows.length === 0) return null;
    const job = await tx.designJob.findUniqueOrThrow({ where: { id: rows[0].id } });
    if (job.task_id) {
      await tx.task.updateMany({ where: { id: job.task_id, status: 'not_started', is_deleted: false }, data: { status: 'in_progress', started_at: new Date() } });
      await tx.task.updateMany({ where: { id: job.task_id, assignee_id: null, is_deleted: false }, data: { assignee_id: input.userId } });
    }
    return job;
  });
}

export type JobAction =
  | { action: 'renew' }
  | { action: 'done'; result?: Prisma.InputJsonValue; cost_usd?: number; log_asset_id?: string }
  | { action: 'failed'; error?: string; cost_usd?: number; log_asset_id?: string };

/** A log asset must be a track asset of the job's own track. */
async function checkLogAsset(tx: TrackScope['tx'], trackId: string, assetId: string | undefined): Promise<void> {
  if (!assetId) return;
  const a = await tx.designTrackAsset.findFirst({ where: { id: assetId, track_id: trackId }, select: { id: true } });
  if (!a) throw new ApiError('log_asset_id is not an asset of this track', 400, 'bad_log_asset');
}

/**
 * The runner's report (PATCH jobs/:id). 404 for an unknown job; 409 `job_not_active` when the job is not claimed or
 * running (a lease that expired and was handed on, a job already finished); a runner `done` for an adopting kind is
 * 409 `adopt_pending` (the job closes when its adopt command completes). `runner_id`, when sent, must match the claim.
 */
export async function reportJob(jobId: string, input: JobAction & { runner_id?: string }, actorId: string): Promise<DesignJob> {
  const out = await trackTx(async (scope) => {
    const { tx } = scope;
    const job = await tx.designJob.findUnique({ where: { id: jobId } });
    if (!job) throw new ApiError('Job not found', 404, 'not_found');
    if (job.status !== 'claimed' && job.status !== 'running') throw new ApiError(`Job is ${job.status}`, 409, 'job_not_active');
    if (input.runner_id && job.claimed_by && input.runner_id !== job.claimed_by) throw new ApiError('Job is claimed by another runner', 409, 'job_not_active');

    if (input.action === 'renew') {
      const res = await tx.designJob.updateMany({
        where: { id: jobId, status: { in: ['claimed', 'running'] } },
        data: { status: 'running', lease_until: new Date(Date.now() + JOB_LEASE_SECONDS * 1000) },
      });
      if (res.count !== 1) throw new ApiError('Job is no longer active', 409, 'job_not_active');
      return tx.designJob.findUniqueOrThrow({ where: { id: jobId } });
    }

    await checkLogAsset(tx, job.track_id, input.log_asset_id);

    if (input.action === 'failed') {
      const outcome = await failOrRequeue(scope, job, input.error ?? 'failed', actorId, { cost_usd: input.cost_usd, log_asset_id: input.log_asset_id });
      if (!outcome) throw new ApiError('Job is no longer active', 409, 'job_not_active');
      return tx.designJob.findUniqueOrThrow({ where: { id: jobId } });
    }

    // done
    if (ADOPT_KINDS.includes(job.kind)) throw new ApiError('This job closes when its branch is adopted', 409, 'adopt_pending');
    if (input.result !== undefined && size(input.result) > MAX_JOB_RESULT_BYTES) throw new ApiError('Job result is over 256 KB', 413, 'result_too_large');
    const res = await tx.designJob.updateMany({
      where: { id: jobId, status: { in: ['claimed', 'running'] } },
      data: {
        status: 'done', finished_at: new Date(), lease_until: null, error: null,
        ...(input.result !== undefined ? { result: input.result } : {}),
        ...(input.cost_usd != null ? { cost_usd: input.cost_usd } : {}),
        ...(input.log_asset_id ? { log_asset_id: input.log_asset_id } : {}),
      },
    });
    if (res.count !== 1) throw new ApiError('Job is no longer active', 409, 'job_not_active');
    await onJobDone(scope, job, actorId);
    return tx.designJob.findUniqueOrThrow({ where: { id: jobId } });
  });
  return out;
}

/** Follow-ons and task effects of a job the runner reported done (not an adopting kind). */
async function onJobDone(scope: TrackScope, job: DesignJob, actorId: string): Promise<void> {
  const { tx } = scope;
  const track = await loadTrack(tx, job.track_id);
  switch (job.kind) {
    case 'provision':
      await queueJob(tx, track, 'wireframe', { payload: {}, once: true });
      break;
    case 'research':
      await queueJob(tx, track, 'brief', { payload: {}, taskId: null, once: true, notBefore: new Date(Date.now() + BRIEF_DELAY_MINUTES * 60_000) });
      break;
    case 'launch_readiness':
      await queueJob(tx, track, 'client_review_email', { payload: {}, taskId: null, once: true });
      break;
    default:
      break;
  }
  // "Design research and brief" closes when the brief is published and the outline adopted (SPEC 2.5): the stage
  // machine completes it then, not when the research job alone is done.
  if (job.task_id && job.kind !== 'research') await completeStageTask(job.task_id, actorId, scope);
}
