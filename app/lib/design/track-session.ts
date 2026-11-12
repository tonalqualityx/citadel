/**
 * Designer Portal v2: sessions on a design track (SPEC 2.3, 2.2, 3.4, 3.5; PLAN W1.6).
 *
 * - `stageTaskTagFor`: which designer stage task a track's session points at, by track stage.
 * - `moveTrackSession`: inside the stage-transition transaction, move the track's one live session to the next stage
 *   task: set `task_id`, release the claim `design:<old task8>`, claim the new task with holder `design:<new task8>`
 *   and the v1 lease, stop the auto timer (the next presence ping starts a new entry on the new task).
 * - `assertTrackWritable`: the route answers `409 track_busy` / `409 track_done` (never session statuses).
 * - Read views of a session's track for the designer projection and the worker.
 */
import type { DesignTrack, DesignTrackStage, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { claimTask } from '@/lib/tasks/claims';
import { designClaimHolder } from './helpers';
import { stopTimer } from './timer';
import { findTaskByTag, type Tx } from './track-core';

export const STAGE_TAG_PREFIX = 'design-stage:';
export const RUNNER_TAG = 'design-runner';
export const OPEN_TRACK_STAGES_EXCLUDED: DesignTrackStage[] = ['done', 'cancelled'];
/** Same lease as sessions.ts CLAIM_TTL_SECONDS (kept literal here so sessions.ts can import this file without a cycle). */
const CLAIM_TTL_SECONDS = 1800;

export const isStageTask = (tags: readonly string[] | null | undefined): boolean => (tags ?? []).some((t) => t.startsWith(STAGE_TAG_PREFIX));
export const isRunnerTask = (tags: readonly string[] | null | undefined): boolean => (tags ?? []).includes(RUNNER_TAG);

/** The designer stage task a session points at while the track is in `stage` (SPEC 2.3). */
export function stageTaskTagFor(stage: DesignTrackStage): string {
  switch (stage) {
    case 'refine':
    case 'rest_build':
      return `${STAGE_TAG_PREFIX}refine`;
    case 'review':
    case 'done':
      return `${STAGE_TAG_PREFIX}review`;
    default:
      return `${STAGE_TAG_PREFIX}art_direction`; // research, art_direction, home_build, cancelled
  }
}

type Db = Pick<PrismaClient, 'designTrack'>;

/**
 * 409 `track_busy` while a build job holds the track, 409 `track_done` once it is finished (SPEC 2.2, 2.3). A session
 * with no track is never held. Call after the session is loaded for the caller (404 for strangers comes first).
 */
export async function assertTrackWritable(
  session: { track_id: string | null },
  opts: { busy?: boolean; done?: boolean },
  db: Db = prisma,
): Promise<void> {
  if (!session.track_id) return;
  const track = await db.designTrack.findUnique({ where: { id: session.track_id }, select: { stage: true, busy_job_id: true } });
  if (!track) return;
  if (opts.done && track.stage === 'done') throw new ApiError('The design review is finished; this is closed for changes', 409, 'track_done');
  if (opts.busy && track.busy_job_id) throw new ApiError('Bast is building; try again when the build finishes', 409, 'track_busy');
}

/**
 * Move the track's live session to the stage task tagged `tag`, in the caller's transaction. Does nothing when there
 * is no live session, no such task, or the session is already on it. Never throws on a missing task or a taken one.
 */
export async function moveTrackSession(tx: Tx, track: Pick<DesignTrack, 'id' | 'project_id'>, tag: string): Promise<boolean> {
  const live = await tx.designSession.findFirst({ where: { track_id: track.id, status: { notIn: ['closed', 'abandoned'] } }, select: { id: true, task_id: true } });
  if (!live) return false;
  const target = await findTaskByTag(tx, track.project_id, tag);
  if (!target || target.id === live.task_id) return false;
  // The v1 per-task index allows one live session per task: never collide with another one.
  const other = await tx.designSession.findFirst({ where: { task_id: target.id, status: { notIn: ['closed', 'abandoned'] }, id: { not: live.id } }, select: { id: true } });
  if (other) return false;

  const old = await tx.task.findUnique({ where: { id: live.task_id }, select: { claim_holder: true } });
  if (old?.claim_holder === designClaimHolder(live.task_id)) {
    await tx.task.updateMany({
      where: { id: live.task_id, claim_holder: designClaimHolder(live.task_id) },
      data: { claim_holder: null, claim_token: null, claimed_at: null, lease_until: null },
    });
  }
  await tx.designSession.update({ where: { id: live.id }, data: { task_id: target.id } });
  await claimTask({ taskId: target.id, holder: designClaimHolder(target.id), ttlSeconds: CLAIM_TTL_SECONDS }, tx as never);
  // Stop the auto entry so the next presence ping starts a fresh one on the new task.
  await stopTimer({ id: live.id }, tx as unknown as PrismaClient);
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------------------

/** What the designer's session projection carries for a tracked session (SPEC 3.5). */
export interface SessionTrackView {
  id: string;
  stage: string;
  busy: boolean;
  busy_line: string | null;
  preview_alias: string;
  preview_url: string | null;
  finish: { green: boolean; finished_at: Date | null } | null;
}

export function busyLineFor(kind: string | null | undefined): string | null {
  if (kind === 'home_build') return 'Bast is building the home page';
  if (kind === 'rest_build') return 'Bast is building the remaining pages';
  return kind ? 'Bast is building' : null;
}

/** The track view for a session row, or null when it has no track. */
export async function loadSessionTrackView(
  session: { track_id: string | null },
  db: Pick<PrismaClient, 'designTrack' | 'designJob'> = prisma,
): Promise<SessionTrackView | null> {
  if (!session.track_id) return null;
  const t = await db.designTrack.findUnique({ where: { id: session.track_id } });
  if (!t) return null;
  const job = t.busy_job_id ? await db.designJob.findUnique({ where: { id: t.busy_job_id }, select: { kind: true } }) : null;
  return {
    id: t.id,
    stage: t.stage,
    busy: t.busy_job_id !== null,
    busy_line: t.busy_job_id ? busyLineFor(job?.kind) ?? 'Bast is building' : null,
    preview_alias: t.preview_alias,
    preview_url: t.preview_url,
    finish: t.finish_result !== null ? { green: t.stage === 'done', finished_at: t.finished_at } : null,
  };
}

/** What the daemon is told about a tracked session (SPEC 2.4): `{id, slug, branch, preview_alias, stage, busy}`. */
export interface WorkerTrackView {
  id: string;
  slug: string;
  branch: string;
  preview_alias: string;
  stage: string;
  busy: boolean;
}

export const workerTrackView = (t: Pick<DesignTrack, 'id' | 'slug' | 'branch' | 'preview_alias' | 'stage' | 'busy_job_id'>): WorkerTrackView => ({
  id: t.id, slug: t.slug, branch: t.branch, preview_alias: t.preview_alias, stage: t.stage, busy: t.busy_job_id !== null,
});

/** Worker track views by track id for the sessions given (one query). */
export async function loadWorkerTracks(
  sessions: ReadonlyArray<{ track_id: string | null }>,
  db: Db = prisma,
): Promise<Map<string, WorkerTrackView>> {
  const ids = [...new Set(sessions.map((s) => s.track_id).filter((x): x is string => !!x))];
  const out = new Map<string, WorkerTrackView>();
  if (ids.length === 0) return out;
  const rows = await db.designTrack.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, branch: true, preview_alias: true, stage: true, busy_job_id: true } });
  for (const r of rows) out.set(r.id, workerTrackView(r));
  return out;
}
