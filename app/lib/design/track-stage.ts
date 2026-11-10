/**
 * Designer Portal v2: the server stage machine (SPEC 2.5). Every transition is server-side, in one transaction
 * with its task effects, under the track's advisory lock, and moves the stage by compare and set.
 *
 *   research      -> art_direction  the brief is published AND the wireframe adopt is done (either order)
 *   art_direction -> home_build     the designer signs the direction
 *   home_build    -> refine         the home_build adopt is done
 *   refine        -> rest_build     the designer taps "Home is ready"
 *   rest_build    -> review         the rest_build adopt is done
 *   review        -> done           finish_gates done and green
 *   refine | review | home_build (build failed for good) -> home_build   revise direction, "rebuild the home page"
 *
 * `cancelled` has no route in v2. The live session moves to the next designer stage task inside the transaction that
 * adopts the home build (-> refine task) and the rest build (-> review task): see moveTrackSession (W1.6).
 */
import type { DesignJobKind, DesignTrack, DesignTrackStage } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { appendWorkerEvents } from './events';
import {
  addInternalComment, clearBusy, completeStageTask, findTaskByTag, loadTrack, lockTrack, queueJob, setBusy, trackTx,
  type Tx, type TrackScope,
} from './track-core';
import { moveTrackSession } from './track-session';

export const TRACK_STAGES: readonly DesignTrackStage[] = ['research', 'art_direction', 'home_build', 'refine', 'rest_build', 'review', 'done', 'cancelled'];

export type TrackTrigger = 'brief_and_outline' | 'direction_signed' | 'home_build_adopted' | 'home_ready' | 'rest_build_adopted' | 'finish_green' | 'direction_rebuild';

/** Who may cause each move (SPEC 2.5). Anything not listed is illegal. */
export const TRACK_TRANSITIONS: Readonly<Record<DesignTrackStage, Readonly<Partial<Record<DesignTrackStage, TrackTrigger>>>>> = {
  research: { art_direction: 'brief_and_outline' },
  art_direction: { home_build: 'direction_signed' },
  home_build: { refine: 'home_build_adopted', home_build: 'direction_rebuild' },
  refine: { rest_build: 'home_ready', home_build: 'direction_rebuild' },
  rest_build: { review: 'rest_build_adopted' },
  review: { done: 'finish_green', home_build: 'direction_rebuild' },
  done: {},
  cancelled: {},
};

export function canMove(from: DesignTrackStage, to: DesignTrackStage): boolean {
  return TRACK_TRANSITIONS[from]?.[to] !== undefined;
}

/** Pure check of one move (409 `illegal_transition` otherwise), like the session table in sessions.ts. */
export function assertMove(from: DesignTrackStage, to: DesignTrackStage, trigger: TrackTrigger): void {
  if (TRACK_TRANSITIONS[from]?.[to] !== trigger) {
    throw new ApiError(`Track cannot move from ${from} to ${to} on ${trigger}`, 409, 'illegal_transition');
  }
}

/** Compare and set on the stage; a concurrent mover loses with 409. */
async function moveStage(tx: Tx, track: DesignTrack, to: DesignTrackStage, trigger: TrackTrigger, extra: { finished_at?: Date } = {}): Promise<void> {
  assertMove(track.stage, to, trigger);
  if (track.stage === to) return; // home_build -> home_build (rebuild) keeps the stage
  const res = await tx.designTrack.updateMany({ where: { id: track.id, stage: track.stage }, data: { stage: to, ...extra } });
  if (res.count !== 1) throw new ApiError('Track changed state; reload and retry', 409, 'state_conflict');
}

/**
 * Complete the stage task carrying `tag`. A task that is not found (tags edited by hand, a project made outside the
 * wizard) never blocks the move: Citadel comments naming the missing tag on the track's other stage tasks and on the
 * Bast-run task that triggered it (SPEC 2.5).
 */
export async function completeStageTaskByTag(
  scope: TrackScope, track: { project_id: string }, tag: string, approverId: string, triggerTaskId?: string | null,
): Promise<string | null> {
  const task = await findTaskByTag(scope.tx, track.project_id, tag);
  if (task) {
    await completeStageTask(task.id, approverId, scope);
    return task.id;
  }
  await commentMissingTag(scope, track, approverId, triggerTaskId,
    `The design track moved on, but no task in this project carries the tag "${tag}", so nothing was completed for it. Check the task tags.`);
  return null;
}


/** Comment on the track's other stage tasks and the triggering Bast-run task (SPEC 2.5). */
async function commentMissingTag(scope: TrackScope, track: { project_id: string }, actorId: string, triggerTaskId: string | null | undefined, text: string): Promise<void> {
  const others = await scope.tx.task.findMany({
    where: {
      project_id: track.project_id, is_deleted: false, status: { not: 'abandoned' },
      OR: ['art_direction', 'refine', 'review'].map((s) => ({ tags: { has: `design-stage:${s}` } })),
    },
    select: { id: true },
  });
  const ids = new Set(others.map((o) => o.id));
  if (triggerTaskId) ids.add(triggerTaskId);
  for (const id of ids) await addInternalComment(scope.tx, id, actorId, text);
}

/** A track_stage status line for a live session (SPEC 3.4). Best effort, after the commit: a feed line never fails a transition. */
export async function recordTrackStage(trackId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const live = await prisma.designSession.findFirst({ where: { track_id: trackId, status: { notIn: ['closed', 'abandoned'] } }, select: { id: true } });
    if (!live) return;
    await appendWorkerEvents(live.id, { events: [{ role: 'system', kind: 'track_stage', payload: payload as never }] });
  } catch (e) {
    console.error('track_stage event failed', e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// research -> art_direction
// ---------------------------------------------------------------------------------------------------------------

/**
 * The brief is published AND the wireframe adopt is done, in either order. Called after each. Moves the track to
 * art_direction and completes the Bot tasks for provision, research and outline (approved by the Bast actor).
 * Returns true when the move happened.
 */
export async function maybeEnterArtDirection(scope: TrackScope, trackId: string, actorId: string): Promise<boolean> {
  const { tx } = scope;
  await lockTrack(tx, trackId);
  const track = await loadTrack(tx, trackId);
  if (track.stage !== 'research' || !track.brief_id) return false;
  const brief = await tx.designBrief.findUnique({ where: { id: track.brief_id }, select: { status: true } });
  if (brief?.status !== 'published') return false;
  const wireframe = await tx.designJob.findFirst({ where: { track_id: trackId, kind: 'wireframe', status: 'done' } });
  if (!wireframe) return false;
  await moveStage(tx, track, 'art_direction', 'brief_and_outline');
  for (const kind of ['provision', 'research', 'wireframe'] as DesignJobKind[]) {
    const job = await tx.designJob.findFirst({ where: { track_id: trackId, kind, task_id: { not: null } }, orderBy: { created_at: 'asc' }, select: { task_id: true } });
    if (job?.task_id) await completeStageTask(job.task_id, actorId, scope);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// art_direction -> home_build (and the rebuild moves back to it)
// ---------------------------------------------------------------------------------------------------------------

export interface HomeBuildInput {
  /** The designer who signed (approves her own stage task). */
  designerId: string;
  /** The stage whose task the designer finished; art_direction on first sign-off, none on a rebuild. */
  completeTag?: string | null;
  /** One `module` job per `features[].build_as = module`; each object becomes that job's payload. */
  modules?: Array<Record<string, unknown>>;
  /** Payload of the `client_brief_email` job (carries the signed art direction id). */
  clientEmailPayload?: Record<string, unknown>;
  /** Payload of the home_build job (the signed art direction id and the mode). */
  buildPayload?: Record<string, unknown>;
}

export interface HomeBuildResult {
  buildJobId: string;
  moduleJobIds: string[];
  clientEmailJobId: string;
}

async function queueHomeBuild(scope: TrackScope, track: DesignTrack, input: HomeBuildInput): Promise<HomeBuildResult> {
  const { tx } = scope;
  const build = await queueJob(tx, track, 'home_build', { payload: (input.buildPayload ?? {}) as never });
  await setBusy(tx, track.id, build!.id);
  const moduleJobIds: string[] = [];
  for (const m of input.modules ?? []) {
    const j = await queueJob(tx, track, 'module', { payload: m as never, taskId: null });
    moduleJobIds.push(j!.id);
  }
  const mail = await queueJob(tx, track, 'client_brief_email', { payload: (input.clientEmailPayload ?? {}) as never, taskId: null });
  return { buildJobId: build!.id, moduleJobIds, clientEmailJobId: mail!.id };
}

/**
 * art_direction -> home_build: the designer signed the direction. Completes the art direction task (by the designer),
 * sets busy, queues `home_build`, one `module` per module feature, and `client_brief_email`.
 */
export async function signDirection(trackId: string, input: HomeBuildInput): Promise<HomeBuildResult> {
  const out = await trackTx(async (scope) => {
    await lockTrack(scope.tx, trackId);
    const track = await loadTrack(scope.tx, trackId);
    await moveStage(scope.tx, track, 'home_build', 'direction_signed');
    await completeStageTaskByTag(scope, track, 'design-stage:art_direction', input.designerId);
    return queueHomeBuild(scope, track, input);
  });
  await recordTrackStage(trackId, { stage: 'home_build', busy: true, line: 'Bast is building the home page' });
  return out;
}

/**
 * Revise direction, "rebuild the home page" (SPEC 2.5): allowed in refine and review, and in home_build only when the
 * build job has failed for good (and none is active). Stage home_build, busy set, a new home_build job.
 */
export async function rebuildHome(trackId: string, input: Omit<HomeBuildInput, 'completeTag'>): Promise<HomeBuildResult> {
  const out = await trackTx(async (scope) => {
    await lockTrack(scope.tx, trackId);
    const track = await loadTrack(scope.tx, trackId);
    if (track.stage === 'home_build') {
      const active = await scope.tx.designJob.count({ where: { track_id: trackId, kind: 'home_build', status: { in: ['queued', 'claimed', 'running'] } } });
      const failed = await scope.tx.designJob.count({ where: { track_id: trackId, kind: 'home_build', status: 'failed' } });
      if (active > 0 || failed === 0) throw new ApiError('The home build has not failed', 409, 'illegal_transition');
    }
    await moveStage(scope.tx, track, 'home_build', 'direction_rebuild');
    return queueHomeBuild(scope, track, input);
  });
  await recordTrackStage(trackId, { stage: 'home_build', busy: true, line: 'Bast is rebuilding the home page' });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// home_build -> refine
// ---------------------------------------------------------------------------------------------------------------

/** The home_build adopt is done: build task completed by Bast, the track moves to refine, busy cleared. */
export async function onHomeBuildAdopted(scope: TrackScope, trackId: string, job: { id: string; task_id: string | null }, actorId: string): Promise<boolean> {
  const { tx } = scope;
  await lockTrack(tx, trackId);
  const track = await loadTrack(tx, trackId);
  if (job.task_id) await completeStageTask(job.task_id, actorId, scope);
  await clearBusy(tx, trackId, job.id);
  if (track.stage !== 'home_build') return false; // a rebuild or a hand edit already moved it
  await moveStage(tx, track, 'refine', 'home_build_adopted');
  await moveTrackSession(tx, track, 'design-stage:refine');
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// refine -> rest_build
// ---------------------------------------------------------------------------------------------------------------

/** The designer taps "Home is ready": refine task completed by her, busy set, `rest_build` queued. */
export async function homeReady(trackId: string, designerId: string): Promise<{ jobId: string }> {
  const out = await trackTx(async (scope) => {
    await lockTrack(scope.tx, trackId);
    const track = await loadTrack(scope.tx, trackId);
    await moveStage(scope.tx, track, 'rest_build', 'home_ready');
    await completeStageTaskByTag(scope, track, 'design-stage:refine', designerId);
    const job = await queueJob(scope.tx, track, 'rest_build', { payload: {} });
    await setBusy(scope.tx, trackId, job!.id);
    return { jobId: job!.id };
  });
  await recordTrackStage(trackId, { stage: 'rest_build', busy: true, line: 'Bast is building the remaining pages' });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// rest_build -> review
// ---------------------------------------------------------------------------------------------------------------

export interface BuiltPage {
  path: string;
  title: string;
}

/**
 * The rest_build adopt is done: rest task completed by Bast; one DesignPageReview per page of the adopt result; one
 * requirement item per page on the review task; the track moves to review; busy cleared.
 */
export async function onRestBuildAdopted(
  scope: TrackScope, trackId: string, job: { id: string; task_id: string | null }, pages: BuiltPage[], actorId: string,
): Promise<boolean> {
  const { tx } = scope;
  await lockTrack(tx, trackId);
  const track = await loadTrack(tx, trackId);
  if (job.task_id) await completeStageTask(job.task_id, actorId, scope);
  await clearBusy(tx, trackId, job.id);
  if (track.stage !== 'rest_build') return false;
  await moveStage(tx, track, 'review', 'rest_build_adopted');
  await moveTrackSession(tx, track, 'design-stage:review');

  const reviewTask = await findTaskByTag(tx, track.project_id, 'design-stage:review');
  const existing = new Set((await tx.designPageReview.findMany({ where: { track_id: trackId }, select: { page_path: true } })).map((p) => p.page_path));
  const fresh = pages.filter((p, i) => !existing.has(p.path) && pages.findIndex((q) => q.path === p.path) === i);
  const items: Array<{ id: string; text: string; completed: boolean; sort_order: number }> = [];
  const base = Array.isArray(reviewTask?.requirements) ? (reviewTask!.requirements as unknown[]).length : 0;
  for (const [i, p] of fresh.entries()) {
    const reqId = `page-${crypto.randomUUID().slice(0, 8)}`;
    items.push({ id: reqId, text: `Review ${p.title} (${p.path})`, completed: false, sort_order: base + i + 1 });
    await tx.designPageReview.create({ data: { track_id: trackId, page_path: p.path, title: p.title.slice(0, 200), requirement_id: reqId } });
  }
  if (reviewTask && items.length > 0) {
    const prior = Array.isArray(reviewTask.requirements) ? (reviewTask.requirements as unknown[]) : [];
    await tx.task.update({ where: { id: reviewTask.id }, data: { requirements: [...prior, ...items] as never } });
  } else if (!reviewTask) {
    await commentMissingTag(scope, track, actorId, job.task_id,
      'The design track moved to review, but no task in this project carries the tag "design-stage:review", so the page checklist has nowhere to go. Check the task tags.');
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// review -> done
// ---------------------------------------------------------------------------------------------------------------

/**
 * finish_gates done and green: the review task is completed by the designer, the track is done, and `launch_readiness`
 * is queued. The caller has already checked that the head did not move.
 */
export async function onFinishGreen(scope: TrackScope, trackId: string, designerId: string): Promise<boolean> {
  const { tx } = scope;
  await lockTrack(tx, trackId);
  const track = await loadTrack(tx, trackId);
  if (track.stage !== 'review') return false;
  await moveStage(tx, track, 'done', 'finish_green', { finished_at: new Date() });
  await completeStageTaskByTag(scope, track, 'design-stage:review', designerId);
  await queueJob(tx, track, 'launch_readiness', { payload: {}, once: true });
  return true;
}
