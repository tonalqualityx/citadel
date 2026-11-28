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
 *   refine        -> rest_build     the designer taps "Infer the rest"
 *   home_build | refine | rest_build | review -> same stage   she adds more of her own designs, or an "Infer the rest" runs
 *                                     beside the stage (tapped in home_build, rest_build or review, or tapped while a build
 *                                     ran and queued when it ended)
 *
 * The designer chooses how the home build starts when she signs (`start` in the home_build payload: a starting point from
 * the inspiration files, or her own design as drawn). "Infer the rest" and "add more of my designs" queue a `rest_build`
 * job whose payload names its start (`infer_rest` or `own_design`); neither ever moves the stage backwards. The payload
 * contract the runner reads is in the project folder (design-track-start-choice, work/1-portal-contract.md).
 *
 * `cancelled` has no route in v2. The live session moves to the next designer stage task inside the transaction that
 * adopts the home build (-> refine task) and the rest build (-> review task): see moveTrackSession (W1.6).
 */
import type { DesignJobKind, DesignTrack, DesignTrackStage, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { appendWorkerEvents } from './events';
import {
  addInternalComment, clearBusy, completeStageTask, findTaskByTag, loadTrack, lockTrack, queueJob, setBusy, trackTx,
  type Tx, type TrackScope,
} from './track-core';
import { moveTrackSession } from './track-session';
import { DESIGN_FILE_SOURCES, isUsableDesignFile } from './reference-role';
import { isBrowserServable } from './track-assets';

export const TRACK_STAGES: readonly DesignTrackStage[] = ['research', 'art_direction', 'home_build', 'refine', 'rest_build', 'review', 'done', 'cancelled'];

export type TrackTrigger =
  | 'brief_and_outline' | 'direction_signed' | 'home_build_adopted' | 'home_ready' | 'rest_build_adopted' | 'finish_green' | 'direction_rebuild'
  | 'infer_rest' | 'designs_added';

/** Who may cause each move (SPEC 2.5). Anything not listed is illegal. A move may have more than one trigger. */
export const TRACK_TRANSITIONS: Readonly<Record<DesignTrackStage, Readonly<Partial<Record<DesignTrackStage, readonly TrackTrigger[]>>>>> = {
  research: { art_direction: ['brief_and_outline'] },
  art_direction: { home_build: ['direction_signed'] },
  home_build: { refine: ['home_build_adopted'], home_build: ['direction_rebuild', 'infer_rest', 'designs_added'] },
  refine: { rest_build: ['home_ready', 'infer_rest'], home_build: ['direction_rebuild'], refine: ['designs_added', 'infer_rest'] },
  rest_build: { review: ['rest_build_adopted'], rest_build: ['infer_rest', 'designs_added'] },
  review: { done: ['finish_green'], home_build: ['direction_rebuild'], review: ['infer_rest', 'designs_added'] },
  done: {},
  cancelled: {},
};

/** The stages where a build has started: "Infer the rest" and "add more of my designs" are open in each. */
export const BUILD_STAGES: readonly DesignTrackStage[] = ['home_build', 'refine', 'rest_build', 'review'];

/** How a build starts (the `start` of a home_build or rest_build payload). */
export type BuildStart = 'inspiration' | 'own_design' | 'infer_rest';
/** The two starts the designer chooses between when the home build is queued. */
export const HOME_STARTS = ['inspiration', 'own_design'] as const;
export type HomeStart = (typeof HOME_STARTS)[number];

export function canMove(from: DesignTrackStage, to: DesignTrackStage): boolean {
  return (TRACK_TRANSITIONS[from]?.[to]?.length ?? 0) > 0;
}

/** Pure check of one move (409 `illegal_transition` otherwise), like the session table in sessions.ts. */
export function assertMove(from: DesignTrackStage, to: DesignTrackStage, trigger: TrackTrigger): void {
  if (!TRACK_TRANSITIONS[from]?.[to]?.includes(trigger)) {
    throw new ApiError(`Track cannot move from ${from} to ${to} on ${trigger}`, 409, 'illegal_transition');
  }
}

/** Compare and set on the stage; a concurrent mover loses with 409. */
async function moveStage(tx: Tx, track: DesignTrack, to: DesignTrackStage, trigger: TrackTrigger, extra: { finished_at?: Date } = {}): Promise<void> {
  assertMove(track.stage, to, trigger);
  if (track.stage === to) return; // a move to the same stage (a rebuild, "infer the rest", added designs) keeps it
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
      project_id: track.project_id, is_deleted: false, status: { notIn: ['abandoned', 'triage'] },
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
  /** Runs in the same transaction, after the jobs are queued (the art direction is frozen here, so a failure undoes the whole move). */
  onQueued?: (scope: TrackScope, result: HomeBuildResult) => Promise<void>;
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
  const result = { buildJobId: build!.id, moduleJobIds, clientEmailJobId: mail!.id };
  if (input.onQueued) await input.onQueued(scope, result);
  return result;
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
  if (track.stage !== 'home_build') { // a rebuild or a hand edit already moved it
    await queueNextBuild(scope, trackId);
    return false;
  }
  await moveStage(tx, track, 'refine', 'home_build_adopted');
  await moveTrackSession(tx, track, 'design-stage:refine');
  await queueNextBuild(scope, trackId);
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
 * A rest_build adopt is done: its task (when it has one) is completed by Bast and busy is cleared. In rest_build the track
 * moves to review, with one DesignPageReview per built page and one requirement item per page on the review task. In
 * review (an "infer the rest" or an added-designs build) the new pages join the review the same way and the stage stays.
 * In home_build or refine the stage stays and the pages are reviewed when the track reaches review. Designs added while
 * this build ran are queued next, then an "Infer the rest" tapped while it ran (queueNextBuild).
 */
export async function onRestBuildAdopted(
  scope: TrackScope, trackId: string, job: { id: string; task_id: string | null }, pages: BuiltPage[], actorId: string,
): Promise<boolean> {
  const { tx } = scope;
  await lockTrack(tx, trackId);
  const track = await loadTrack(tx, trackId);
  if (job.task_id) await completeStageTask(job.task_id, actorId, scope);
  await clearBusy(tx, trackId, job.id);
  if (track.stage === 'review') {
    await addPageReviews(scope, track, job, pages, actorId);
    await queueNextBuild(scope, trackId);
    return false;
  }
  if (track.stage !== 'rest_build') {
    await queueNextBuild(scope, trackId);
    return false;
  }
  await moveStage(tx, track, 'review', 'rest_build_adopted');
  await moveTrackSession(tx, track, 'design-stage:review');
  // Pages built by an earlier rest_build that finished before the track reached rest_build (an added-designs build in
  // refine) are reviewed too.
  const earlier = (await builtPages(tx, trackId)).filter((p) => p.path !== '/');
  await addPageReviews(scope, track, job, [...pages, ...earlier], actorId);
  await queueNextBuild(scope, trackId);
  return true;
}

/** One DesignPageReview and one review-task requirement per page not reviewed yet. */
async function addPageReviews(
  scope: TrackScope, track: DesignTrack, job: { task_id: string | null }, pages: BuiltPage[], actorId: string,
): Promise<void> {
  const { tx } = scope;
  const reviewTask = await findTaskByTag(tx, track.project_id, 'design-stage:review');
  const existing = new Set((await tx.designPageReview.findMany({ where: { track_id: track.id }, select: { page_path: true } })).map((p) => p.page_path));
  const fresh = pages.filter((p, i) => !existing.has(p.path) && pages.findIndex((q) => q.path === p.path) === i);
  const items: Array<{ id: string; text: string; completed: boolean; sort_order: number }> = [];
  const base = Array.isArray(reviewTask?.requirements) ? (reviewTask!.requirements as unknown[]).length : 0;
  for (const [i, p] of fresh.entries()) {
    const reqId = `page-${crypto.randomUUID().slice(0, 8)}`;
    items.push({ id: reqId, text: `Review ${p.title} (${p.path})`, completed: false, sort_order: base + i + 1 });
    await tx.designPageReview.create({ data: { track_id: track.id, page_path: p.path, title: p.title.slice(0, 200), requirement_id: reqId } });
  }
  if (reviewTask && items.length > 0) {
    const prior = Array.isArray(reviewTask.requirements) ? (reviewTask.requirements as unknown[]) : [];
    await tx.task.update({ where: { id: reviewTask.id }, data: { requirements: [...prior, ...items] as never } });
  } else if (!reviewTask) {
    await commentMissingTag(scope, track, actorId, job.task_id,
      'The design track moved to review, but no task in this project carries the tag "design-stage:review", so the page checklist has nowhere to go. Check the task tags.');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// "Infer the rest" and "add more of my designs" (any build stage)
// ---------------------------------------------------------------------------------------------------------------

const BUILD_JOB_KINDS: DesignJobKind[] = ['home_build', 'rest_build'];
const ACTIVE: Array<'queued' | 'claimed' | 'running'> = ['queued', 'claimed', 'running'];
/** A build payload names at most this many references and pages (the per-track Figma cap is 200; uploads add 100). */
const MAX_PAYLOAD_IDS = 400;
const MAX_PAYLOAD_PAGES = 500;

function payloadObject(payload: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

/** The `start` a build payload names, or null for a payload from before the start choice. */
export function payloadStart(payload: Prisma.JsonValue | null | undefined): BuildStart | null {
  const s = payloadObject(payload).start;
  return s === 'inspiration' || s === 'own_design' || s === 'infer_rest' ? s : null;
}

function payloadReferenceIds(payload: Prisma.JsonValue | null | undefined): string[] {
  const ids = payloadObject(payload).design_reference_ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}

function resultPages(result: Prisma.JsonValue | null | undefined): BuiltPage[] {
  const pages = payloadObject(result).pages;
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((p) => {
    const o = payloadObject(p as Prisma.JsonValue);
    if (typeof o.path !== 'string' || !o.path.startsWith('/')) return [];
    return [{ path: o.path, title: (typeof o.title === 'string' && o.title) || o.path }];
  });
}

/** Every page the track's finished builds made (adopt results of done builds, then the review rows), first title wins. */
export async function builtPages(tx: Tx, trackId: string): Promise<BuiltPage[]> {
  const out = new Map<string, string>();
  const jobs = await tx.designJob.findMany({
    where: { track_id: trackId, kind: { in: BUILD_JOB_KINDS }, status: 'done' }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], select: { result: true },
  });
  for (const j of jobs) for (const p of resultPages(j.result)) if (!out.has(p.path)) out.set(p.path, p.title);
  const reviews = await tx.designPageReview.findMany({ where: { track_id: trackId }, orderBy: { created_at: 'asc' }, select: { page_path: true, title: true } });
  for (const r of reviews) if (!out.has(r.page_path)) out.set(r.page_path, r.title);
  return [...out].slice(0, MAX_PAYLOAD_PAGES).map(([path, title]) => ({ path, title }));
}

/**
 * The designer's usable design files on the track, in board order: a Figma frame that was captured, or an upload with a
 * picture that can be shown, not set aside (`reference-role.ts`, the same rule the board and the worker use).
 */
export async function usableDesignReferenceIds(tx: Tx, trackId: string): Promise<string[]> {
  const refs = await tx.designReference.findMany({
    where: { track_id: trackId, source: { in: [...DESIGN_FILE_SOURCES] }, decision: { not: 'no' } },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    select: { id: true, source: true, decision: true, capture_status: true, upload_asset_ids: true },
  });
  const uploadIds = refs.flatMap((r) => r.upload_asset_ids);
  const assets = uploadIds.length === 0 ? [] : await tx.designTrackAsset.findMany({
    where: { track_id: trackId, OR: [{ id: { in: uploadIds } }, { parent_asset_id: { in: uploadIds }, kind: 'render' }] },
    select: { id: true, kind: true, content_type: true, status: true, parent_asset_id: true },
  });
  const view = (a: (typeof assets)[number]) => ({ url: isBrowserServable(a) ? a.id : null });
  return refs.filter((r) => isUsableDesignFile({
    source: r.source, decision: r.decision, capture_status: r.capture_status,
    uploads: r.upload_asset_ids.flatMap((id) => {
      const a = assets.find((x) => x.id === id);
      return a ? [{ asset: view(a), renders: assets.filter((x) => x.parent_asset_id === id).map(view) }] : [];
    }),
  })).map((r) => r.id).slice(0, MAX_PAYLOAD_IDS);
}

/**
 * Design files the designer added after the home build started that no build has taken yet. The designs on the board
 * when the latest home build was queued are its starting set (followed, or deliberately set aside for the inspiration
 * start). A design counts as taken when a build payload names it (a build that failed for good included, so a failing
 * design is never queued again by itself), or when it was on the board before a build other than "infer the rest"
 * started (that build read every design on the board, including the frames a pasted Figma link brought in; an added-designs
 * build reads them because its list is refreshed when it is claimed, `refreshBuildPayloadAtClaim`). `exceptJobId` leaves
 * one build out, for that refresh.
 */
export async function addedDesignIds(tx: Tx, trackId: string, opts: { exceptJobId?: string } = {}): Promise<string[]> {
  const builds = await tx.designJob.findMany({
    where: { track_id: trackId, kind: { in: BUILD_JOB_KINDS }, ...(opts.exceptJobId ? { id: { not: opts.exceptJobId } } : {}) },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { kind: true, status: true, payload: true, created_at: true, started_at: true },
  });
  const homes = builds.filter((b) => b.kind === 'home_build');
  if (homes.length === 0) return [];
  let since = homes[homes.length - 1].created_at;
  const named = new Set<string>();
  for (const b of builds) {
    if (b.status === 'cancelled') continue;
    for (const id of payloadReferenceIds(b.payload)) named.add(id);
    if (payloadStart(b.payload) !== 'infer_rest' && b.started_at && b.status !== 'failed' && b.started_at > since) since = b.started_at;
  }
  const refs = await tx.designReference.findMany({
    where: { track_id: trackId, source: { in: [...DESIGN_FILE_SOURCES] }, decision: { not: 'no' }, created_at: { gt: since } },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }], select: { id: true },
  });
  return refs.map((r) => r.id).filter((id) => !named.has(id)).slice(0, MAX_PAYLOAD_IDS);
}

async function activeBuildCount(tx: Tx, trackId: string): Promise<number> {
  return tx.designJob.count({ where: { track_id: trackId, kind: { in: BUILD_JOB_KINDS }, status: { in: ACTIVE } } });
}

/**
 * Designs added in a build stage are built as drawn: one `rest_build` with `start: own_design` naming them. Called in the
 * caller's transaction under the track lock, when a design is added and after every build adopt. Nothing is queued while a
 * build runs (the adopt that ends it calls this again), outside a build stage, or when nothing new was added. The stage
 * never moves. The job carries the rest build's recipe task only in rest_build; elsewhere it runs beside the stage.
 * Returns the queued job id, or null.
 */
export async function queueAddedDesigns(scope: TrackScope, trackId: string): Promise<string | null> {
  const { tx } = scope;
  const track = await loadTrack(tx, trackId);
  if (!BUILD_STAGES.includes(track.stage) || track.busy_job_id !== null) return null;
  if ((await activeBuildCount(tx, trackId)) > 0) return null;
  const ids = await addedDesignIds(tx, trackId);
  if (ids.length === 0) return null;
  assertMove(track.stage, track.stage, 'designs_added');
  const payload = { start: 'own_design', design_reference_ids: ids, built_pages: await builtPages(tx, trackId) };
  const job = await queueJob(tx, track, 'rest_build', { payload: payload as never, ...(track.stage === 'rest_build' ? {} : { taskId: null }) });
  await setBusy(tx, trackId, job!.id);
  return job!.id;
}

export interface InferRestResult {
  /** The queued job, or null when a build is running and the request is held until it ends. */
  jobId: string | null;
  stage: DesignTrackStage;
  /** True when the request is held: it is queued when the running build ends. */
  afterBuild: boolean;
}

/** One `rest_build` with `start: infer_rest`, naming the pages already built and her design files. Busy is set. */
async function queueInferJob(scope: TrackScope, track: DesignTrack, stage: DesignTrackStage): Promise<string> {
  const { tx } = scope;
  const payload = { start: 'infer_rest', built_pages: await builtPages(tx, track.id), design_reference_ids: await usableDesignReferenceIds(tx, track.id) };
  const job = await queueJob(tx, track, 'rest_build', { payload: payload as never, ...(stage === 'rest_build' ? {} : { taskId: null }) });
  await tx.designTrack.update({ where: { id: track.id }, data: { busy_job_id: job!.id, infer_requested_at: null } });
  return job!.id;
}

/**
 * The designer taps "Infer the rest" (any build stage). One `rest_build` with `start: infer_rest`, naming the pages already
 * built and her design files, so the runner builds only pages nobody has drawn or built, from her approved pages and
 * library. In refine this is the move to the rest of the site (her refine task is completed, as with "Home is ready"); in
 * home_build, rest_build and review the stage stays. While a build runs the request is held on the track
 * (`infer_requested_at`) and queued when that build ends (`queueNextBuild`); a second tap while held changes nothing.
 */
export async function inferRest(trackId: string, designerId: string): Promise<InferRestResult> {
  const out = await trackTx(async (scope): Promise<InferRestResult> => {
    const { tx } = scope;
    await lockTrack(tx, trackId);
    const track = await loadTrack(tx, trackId);
    if (!BUILD_STAGES.includes(track.stage)) throw new ApiError(`"Infer the rest" is not open in ${track.stage}`, 409, 'illegal_transition');
    if (track.busy_job_id !== null || (await activeBuildCount(tx, trackId)) > 0) {
      assertMove(track.stage, track.stage, 'infer_rest');
      if (!track.infer_requested_at) await tx.designTrack.update({ where: { id: trackId }, data: { infer_requested_at: new Date() } });
      return { jobId: null, stage: track.stage, afterBuild: true };
    }
    const to: DesignTrackStage = track.stage === 'refine' ? 'rest_build' : track.stage;
    await moveStage(tx, track, to, 'infer_rest');
    if (track.stage === 'refine') await completeStageTaskByTag(scope, track, 'design-stage:refine', designerId);
    return { jobId: await queueInferJob(scope, track, to), stage: to, afterBuild: false };
  });
  if (!out.afterBuild) await recordTrackStage(trackId, { stage: out.stage, busy: true, line: INFER_LINE });
  return out;
}

/**
 * After a build ends (every home_build and rest_build adopt): designs she added while it ran are built first
 * (`queueAddedDesigns`); otherwise an "Infer the rest" she tapped while it ran is queued now. A held request runs beside
 * the stage, in refine too: it never completes her refine task for her. Returns the queued job id, or null.
 */
export async function queueNextBuild(scope: TrackScope, trackId: string): Promise<string | null> {
  const added = await queueAddedDesigns(scope, trackId);
  if (added) return added;
  const { tx } = scope;
  const track = await loadTrack(tx, trackId);
  if (!track.infer_requested_at) return null;
  if (!BUILD_STAGES.includes(track.stage)) {
    await tx.designTrack.update({ where: { id: trackId }, data: { infer_requested_at: null } });
    return null;
  }
  if (track.busy_job_id !== null || (await activeBuildCount(tx, trackId)) > 0) return null;
  assertMove(track.stage, track.stage, 'infer_rest');
  return queueInferJob(scope, track, track.stage);
}

/**
 * A build is claimed (`claimJob`, in its transaction): its lists are brought up to the moment the runner starts. An
 * added-designs build (`start: own_design`) names every design added and not taken by another build, so a second upload
 * that arrived after it was queued is built with it. An "Infer the rest" build gets the pages built and her design files
 * as they are now. Any other payload is left alone. Returns the payload to store, or null for no change.
 */
export async function refreshBuildPayloadAtClaim(
  tx: Tx, job: { id: string; track_id: string; kind: DesignJobKind; payload: Prisma.JsonValue | null },
): Promise<Prisma.InputJsonValue | null> {
  if (job.kind !== 'rest_build') return null;
  const start = payloadStart(job.payload);
  const base = payloadObject(job.payload);
  if (start === 'own_design') {
    const ids = [...new Set([...payloadReferenceIds(job.payload), ...(await addedDesignIds(tx, job.track_id, { exceptJobId: job.id }))])].slice(0, MAX_PAYLOAD_IDS);
    return { ...base, design_reference_ids: ids, built_pages: await builtPages(tx, job.track_id) } as unknown as Prisma.InputJsonValue;
  }
  if (start === 'infer_rest') {
    return { ...base, built_pages: await builtPages(tx, job.track_id), design_reference_ids: await usableDesignReferenceIds(tx, job.track_id) } as unknown as Prisma.InputJsonValue;
  }
  return null;
}

/** The status lines of these builds; the same words as `busyLineFor` in track-session.ts (a test holds them equal). */
export const INFER_LINE = 'Bast is building the pages nobody has drawn yet';
export const ADDED_DESIGNS_LINE = 'Bast is building your new designs';

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
