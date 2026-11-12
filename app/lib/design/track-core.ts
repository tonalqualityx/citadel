/**
 * Designer Portal v2: shared plumbing for the track engine (SPEC 2.5, 6.1a).
 *
 * - `trackTx` runs a transition in one transaction and, after it commits, runs the dependency unblock for every task
 *   the transaction completed (`unblockEligibleDependents` reads through the shared client, so it must see the commit).
 * - `completeStageTask` is the one helper that completes a task for the stage machine: `done` AND `approved`, then
 *   the existing unblock step. It reuses lib/services/dependencies.ts; nothing there is forked.
 * - Job queueing, task lookup by tag, comments and tags for parked jobs.
 */
import { Prisma } from '@prisma/client';
import type { DesignJob, DesignJobKind, DesignTrack, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { CLEAR_CLAIM_DATA } from '@/lib/tasks/claims';
import { unblockEligibleDependents } from '@/lib/services/dependencies';
import { closeAsksForTask } from '@/lib/work/ask-closure';

export type Tx = Prisma.TransactionClient;

/** A transaction plus the ids of the tasks it completed (unblocked after commit). */
export interface TrackScope {
  tx: Tx;
  done: Set<string>;
}

export const JOB_ATTEMPT_LIMIT = 2;
export const JOB_LEASE_SECONDS = 10 * 60;
export const BRIEF_DELAY_MINUTES = 20;
export const NEEDS_MIKE_TAG = 'needs-mike';
/** Kinds whose job closes only when the daemon adopts the job branch (SPEC 6.1a). */
export const ADOPT_KINDS: readonly DesignJobKind[] = ['wireframe', 'home_build', 'rest_build', 'module', 'bulk_import', 'fact_fix'];
/** Kinds that carry a recipe task found by the tag `design-job:<kind>` in the track's project. */
export const TASK_JOB_KINDS: readonly DesignJobKind[] = ['provision', 'research', 'wireframe', 'home_build', 'rest_build', 'launch_readiness'];
export const BUILD_KINDS: readonly DesignJobKind[] = ['home_build', 'rest_build'];
export const ACTIVE_JOB_STATUSES = ['queued', 'claimed', 'running'] as const;

/** Run `fn` in one transaction; after it commits, unblock the dependants of every task it completed. */
export async function trackTx<T>(fn: (scope: TrackScope) => Promise<T>, db: PrismaClient = prisma): Promise<T> {
  const done = new Set<string>();
  const out = await db.$transaction((tx) => fn({ tx, done }), { timeout: 30_000, maxWait: 10_000 });
  for (const id of done) await unblockEligibleDependents(id);
  return out;
}

/** Serialise everything that moves one track. */
export async function lockTrack(tx: Tx, trackId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`design-track:${trackId}`}))`;
}

export async function loadTrack(tx: Tx | PrismaClient, trackId: string): Promise<DesignTrack> {
  const t = await tx.designTrack.findUnique({ where: { id: trackId } });
  if (!t) throw new ApiError('Track not found', 404, 'not_found');
  return t;
}

/** A task by tag within a project: not deleted, not abandoned, oldest first (SPEC 2.3). */
export async function findTaskByTag(tx: Tx | PrismaClient, projectId: string, tag: string) {
  return tx.task.findFirst({
    where: { project_id: projectId, tags: { has: tag }, is_deleted: false, status: { not: 'abandoned' } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, status: true, tags: true, assignee_id: true, requirements: true },
  });
}

/**
 * Complete a task for the stage machine (SPEC 2.5): status done, approved true, approved_at now, approved_by the
 * approver, then `unblockEligibleDependents`, which honours `dependencies_ordering_only`. Inside a transaction pass
 * the scope: the update joins it and the unblock runs after commit. Idempotent: a task already done and approved
 * is left alone. Returns true when this call changed the task.
 */
export async function completeStageTask(taskId: string, approverId: string, scope?: TrackScope): Promise<boolean> {
  const db: Tx | PrismaClient = scope ? scope.tx : prisma;
  const now = new Date();
  const res = await db.task.updateMany({
    where: { id: taskId, is_deleted: false, status: { not: 'abandoned' }, OR: [{ status: { not: 'done' } }, { approved: false }] },
    data: { status: 'done', approved: true, approved_at: now, approved_by_id: approverId, completed_at: now, ...CLEAR_CLAIM_DATA },
  });
  if (res.count === 0) return false;
  // Work stage A (main): every write of a done task status closes the task's linked email asks. Inside a track
  // transaction it joins that transaction, like the status write; on its own a failure is logged, never thrown.
  type AskDb = Parameters<typeof closeAsksForTask>[0];
  if (scope) await closeAsksForTask(scope.tx as unknown as AskDb, taskId, 'done', { now });
  else await closeAsksForTask(prisma as unknown as AskDb, taskId, 'done', { now }).catch((e: unknown) => console.error('closeAsksForTask failed for stage task', taskId, e));
  if (scope) scope.done.add(taskId);
  else await unblockEligibleDependents(taskId);
  return true;
}

/** Internal comment on a task (team notes are never shown to clients). */
export async function addInternalComment(tx: Tx, taskId: string, userId: string, content: string): Promise<void> {
  await tx.comment.create({ data: { task_id: taskId, user_id: userId, content: content.slice(0, 10_000), is_internal: true } });
}

export async function addTaskTag(tx: Tx, taskId: string, tag: string): Promise<void> {
  const t = await tx.task.findUnique({ where: { id: taskId }, select: { tags: true } });
  if (!t || t.tags.includes(tag)) return;
  await tx.task.update({ where: { id: taskId }, data: { tags: [...t.tags, tag] } });
}

/** The last 1,500 characters of an error: the tail is where the failure is. */
export const errorTail = (e: string | null | undefined): string => (e ?? '').slice(-1500);

/**
 * Queue a job. A job kind with a recipe task finds it by tag `design-job:<kind>` in the track's project unless
 * `taskId` is given (a bulk import carries its own task). `queueOnce` skips the queue when the track already has a
 * job of that kind that is queued, claimed, running or done (follow-ons must not double up).
 */
export async function queueJob(
  tx: Tx,
  track: { id: string; project_id: string },
  kind: DesignJobKind,
  opts: { payload?: Prisma.InputJsonValue; notBefore?: Date | null; taskId?: string | null; once?: boolean } = {},
): Promise<DesignJob | null> {
  if (opts.once) {
    const existing = await tx.designJob.findFirst({ where: { track_id: track.id, kind, status: { in: ['queued', 'claimed', 'running', 'done'] } } });
    if (existing) return null;
  }
  let taskId = opts.taskId ?? null;
  if (taskId === null && opts.taskId === undefined && TASK_JOB_KINDS.includes(kind)) {
    taskId = (await findTaskByTag(tx, track.project_id, `design-job:${kind}`))?.id ?? null;
  }
  try {
    return await tx.designJob.create({
      data: { track_id: track.id, kind, task_id: taskId, payload: opts.payload ?? {}, not_before: opts.notBefore ?? null },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError('A build job is already running on this track', 409, 'build_running');
    }
    throw e;
  }
}

/** Set busy in the transaction that queues a build job. */
export async function setBusy(tx: Tx, trackId: string, jobId: string): Promise<void> {
  await tx.designTrack.update({ where: { id: trackId }, data: { busy_job_id: jobId } });
}

/** Clear busy only when it still points at this job. */
export async function clearBusy(tx: Tx, trackId: string, jobId: string): Promise<void> {
  await tx.designTrack.updateMany({ where: { id: trackId, busy_job_id: jobId }, data: { busy_job_id: null } });
}
