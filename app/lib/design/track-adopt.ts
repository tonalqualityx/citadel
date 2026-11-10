/**
 * Designer Portal v2: adopt and finish (SPEC 2.2, 2.4, 6.1a).
 *
 * The runner asks for an adopt through POST /api/design/runner/tracks/:id/adopt; Citadel builds the `adopt_branch`
 * command payload from the track and job rows and takes only `job_id`, `job_branch` and `expected_base` from the
 * runner. The daemon completes the command through PATCH /api/design/worker/commands/:id; `applyAdoptCompletion`
 * and `applyFinishCompletion` run in the same transaction as that completion and carry the stage effects.
 */
import type { DesignCommand, DesignJob, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { ADOPT_KINDS, completeStageTask, loadTrack, lockTrack, trackTx, type TrackScope } from './track-core';
import { failOrRequeue } from './track-jobs';
import { maybeEnterArtDirection, onFinishGreen, onHomeBuildAdopted, onRestBuildAdopted } from './track-stage';

export const BASE_RE = /^[0-9a-f]{40}$/;
export const jobBranchRe = (slug: string) => new RegExp(`^design/t-${slug}-job-[0-9]{1,4}$`);

/** Command results for these verbs carry a page list or per-page gate results, so they get 256 KB instead of 8 KB. */
export const TRACK_COMMAND_RESULT_BYTES = 256 * 1024;
export const TRACK_COMMAND_VERBS = ['adopt_branch', 'finish_gates'] as const;
export const isTrackVerb = (verb: string): boolean => (TRACK_COMMAND_VERBS as readonly string[]).includes(verb);

/** What the daemon reports when an adopt is done (SPEC 2.4 step 5). */
export const adoptResultSchema = z.object({
  head_sha: z.string().regex(/^[0-9a-f]{7,64}$/),
  preview_url: z.string().url().max(300).startsWith('https://'),
  preview_sha: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
  pages: z.array(z.object({ path: z.string().min(1).max(300).startsWith('/'), title: z.string().max(200).optional() }).passthrough()).max(2000).default([]),
}).passthrough();
export type AdoptResult = z.infer<typeof adoptResultSchema>;

export interface AdoptInput {
  job_id: string;
  job_branch: string;
  expected_base: string;
}

/**
 * The adopt route's work: validates the job against the track and creates the `adopt_branch` command (session-less,
 * created by the runner's user). The job must be claimed or running and of an adopting kind; `job_branch` must be
 * `design/t-<slug>-job-<n>` for THIS track; `expected_base` is 40 hex characters. A job that already has a pending or
 * claimed adopt command returns that command (created false). Moves the job to running.
 */
export async function createAdoptCommand(trackId: string, input: AdoptInput, runnerUserId: string): Promise<{ command: DesignCommand; created: boolean }> {
  return trackTx(async ({ tx }) => {
    await lockTrack(tx, trackId);
    const track = await loadTrack(tx, trackId);
    const job = await tx.designJob.findFirst({ where: { id: input.job_id, track_id: trackId } });
    if (!job) throw new ApiError('Job not found', 404, 'not_found');
    if (!ADOPT_KINDS.includes(job.kind)) throw new ApiError(`A ${job.kind} job does not adopt a branch`, 409, 'bad_job_kind');
    if (job.status !== 'claimed' && job.status !== 'running') throw new ApiError(`Job is ${job.status}`, 409, 'job_not_active');
    if (!jobBranchRe(track.slug).test(input.job_branch)) throw new ApiError('job_branch does not belong to this track', 400, 'bad_job_branch');
    if (!BASE_RE.test(input.expected_base)) throw new ApiError('expected_base must be 40 hex characters', 400, 'bad_expected_base');
    if (job.command_id) {
      const prior = await tx.designCommand.findUnique({ where: { id: job.command_id } });
      if (prior && (prior.status === 'pending' || prior.status === 'claimed')) return { command: prior, created: false };
    }
    const command = await tx.designCommand.create({
      data: {
        session_id: null,
        verb: 'adopt_branch',
        created_by_id: runnerUserId,
        payload: {
          track_id: track.id, site_id: track.site_id, job_id: job.id, job_kind: job.kind, branch: track.branch,
          preview_alias: track.preview_alias, job_branch: input.job_branch, expected_base: input.expected_base,
        },
      },
    });
    await tx.designJob.update({ where: { id: job.id }, data: { command_id: command.id, status: 'running' } });
    return { command, created: true };
  });
}

const payloadOf = (cmd: { payload: Prisma.JsonValue }): Record<string, unknown> =>
  cmd.payload && typeof cmd.payload === 'object' && !Array.isArray(cmd.payload) ? (cmd.payload as Record<string, unknown>) : {};

const failReason = (cmd: DesignCommand): string => {
  const r = cmd.result && typeof cmd.result === 'object' && !Array.isArray(cmd.result) ? (cmd.result as Record<string, unknown>).reason : null;
  return typeof r === 'string' && r ? r : cmd.error ?? 'failed';
};

/**
 * An `adopt_branch` command reached done or failed (called inside the completing transaction, with the completed row).
 * failed: the job goes back to the queue with attempts left, or fails for good and parks (`conflict` reruns the job on
 * the new head). done: the track takes the new head and preview, the job is done, and the stage effects of its kind run.
 */
export async function applyAdoptCompletion(scope: TrackScope, cmd: DesignCommand): Promise<void> {
  const { tx } = scope;
  const p = payloadOf(cmd);
  const trackId = typeof p.track_id === 'string' ? p.track_id : null;
  const jobId = typeof p.job_id === 'string' ? p.job_id : null;
  if (!trackId || !jobId) return;
  const job = await tx.designJob.findUnique({ where: { id: jobId } });
  if (!job || job.track_id !== trackId || job.command_id !== cmd.id) return; // stale or foreign command

  if (cmd.status === 'failed') {
    await failOrRequeue(scope, job, `adopt_failed: ${failReason(cmd)}`, cmd.created_by_id);
    return;
  }

  const parsed = adoptResultSchema.safeParse(cmd.result);
  if (!parsed.success) {
    await failOrRequeue(scope, job, 'adopt_failed: bad_adopt_result', cmd.created_by_id);
    return;
  }
  const result = parsed.data;
  await lockTrack(tx, trackId);
  await tx.designTrack.update({
    where: { id: trackId },
    data: { head_sha: result.head_sha, preview_url: result.preview_url, ...(result.preview_sha ? { preview_sha: result.preview_sha } : {}) },
  });
  const closed = await tx.designJob.updateMany({
    where: { id: job.id, status: { in: ['queued', 'claimed', 'running'] } },
    data: { status: 'done', finished_at: new Date(), lease_until: null, claimed_by: null, error: null, result: result as Prisma.InputJsonValue },
  });
  if (closed.count !== 1) return;
  await afterAdopt(scope, job, result, cmd.created_by_id);
}

async function afterAdopt(scope: TrackScope, job: DesignJob, result: AdoptResult, actorId: string): Promise<void> {
  const pages = result.pages.map((pg) => ({ path: pg.path, title: (typeof pg.title === 'string' && pg.title) || pg.path }));
  switch (job.kind) {
    case 'wireframe':
      // The outline task closes with the other Bot tasks when the track enters art direction.
      await maybeEnterArtDirection(scope, job.track_id, actorId);
      break;
    case 'home_build':
      await onHomeBuildAdopted(scope, job.track_id, job, actorId);
      break;
    case 'rest_build':
      await onRestBuildAdopted(scope, job.track_id, job, pages, actorId);
      break;
    default: {
      // module, bulk_import, fact_fix: they run beside the designer and move no stage; they close their task.
      if (job.task_id) await completeStageTask(job.task_id, actorId, scope);
    }
  }
}

/** Every per-page result green (or an explicit `green: true`). */
export function isFinishGreen(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  if (typeof r.green === 'boolean') return r.green;
  const rows = Array.isArray(r.results) ? r.results : Array.isArray(r.pages) ? r.pages : null;
  return rows !== null && rows.length > 0 && rows.every((x) => x && typeof x === 'object' && (x as Record<string, unknown>).ok === true);
}

/**
 * A `finish_gates` command reached done or failed (inside the completing transaction). The result is stored on the
 * track; the review -> done transition applies only when every result is green AND the head has not moved since the
 * command was built. Returns true when the track finished.
 */
export async function applyFinishCompletion(scope: TrackScope, cmd: DesignCommand): Promise<boolean> {
  const { tx } = scope;
  const p = payloadOf(cmd);
  const trackId = typeof p.track_id === 'string' ? p.track_id : null;
  if (!trackId) return false;
  await lockTrack(tx, trackId);
  const track = await loadTrack(tx, trackId);
  if (track.finish_command_id !== cmd.id) return false; // stale: a newer finish replaced it
  const stored = (cmd.status === 'done' ? cmd.result : { green: false, error: cmd.error ?? 'failed' }) ?? { green: false };
  await tx.designTrack.update({ where: { id: trackId }, data: { finish_result: stored as Prisma.InputJsonValue } });
  if (cmd.status !== 'done' || !isFinishGreen(cmd.result)) return false;
  const built = typeof p.head_sha === 'string' ? p.head_sha : null;
  const reported = cmd.result && typeof cmd.result === 'object' ? (cmd.result as Record<string, unknown>).head_sha : null;
  const expected = built ?? (typeof reported === 'string' ? reported : null);
  if (expected !== null && track.head_sha !== expected) return false;
  return onFinishGreen(scope, trackId, cmd.created_by_id);
}

