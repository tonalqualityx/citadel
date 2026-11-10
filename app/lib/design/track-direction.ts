/**
 * Designer Portal v2: the art direction record (SPEC 4.4, 2.5, 4.11 rows 10 to 13).
 *
 * - `directionBodySchema` is the record of 4.4. Free text is named `detail`, never `notes` (a forbidden projection key);
 *   the schema is strict, so an unknown key, `notes` included, is a 400.
 * - A draft is edited with a JSON merge patch (null removes a key, objects merge, arrays are replaced) and
 *   `base_version`: 409 `version_moved` on a stale base, 409 `direction_signed` when the current version is signed.
 * - A draft has two writers (the designer's form and the design worker), and `version` does not move while a draft is
 *   edited, so every view carries a `revision` that moves on every write. A write names the revision it read
 *   (`base_revision`) and is a compare-and-swap on it; sign freezes only the revision it validated, which must be the
 *   one the designer's screen showed.
 * - Signing freezes the draft, in the same transaction as the stage effects of `signDirection` / `rebuildHome`
 *   (track-stage.ts); revising makes a new draft from the signed body.
 */
import { z } from 'zod';
import type { DesignArtDirection, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { appendWorkerEvents } from './events';
import { loadTrack, lockTrack, queueJob, trackTx, type TrackScope } from './track-core';
import { rebuildHome, signDirection, type HomeBuildInput } from './track-stage';
import { clientStatementsFor, stripForbidden } from './track-board';

export const MAX_DIRECTION_BYTES = 128 * 1024;

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const str = (n: number) => z.string().max(n);
const list = (n: number, item: z.ZodType<string> = str(200)) => z.array(item).max(n);
const detail = str(2000);
const uuid = z.string().uuid();

const fontPick = z.object({ family: str(100).min(1), source: z.enum(['brand', 'designer', 'reference-derived']).optional(), why: str(500).optional() }).strict();
const link = z.object({ label: str(80), url: str(300) }).strict();

export const directionBodySchema = z.object({
  summary: z.string().refine((s) => words(s) <= 120, 'summary is at most 120 words'),
  feel: z.object({ words: list(12, str(40)), register: z.enum(['quiet', 'bold']), detail }).partial().strict(),
  type: z.object({ display: fontPick, body: fontPick, detail }).partial().strict(),
  colour: z.object({ brand_tokens_kept: list(30, str(80)), accent_job: str(300), grounds: list(20, str(80)), avoid: list(20, str(80)) }).partial().strict(),
  imagery: z.object({ kind: z.enum(['photo', 'illustration', 'mixed']), treatment: str(500), subjects: str(500), avoid: str(500) }).partial().strict(),
  layout: z.object({ density: z.enum(['airy', 'balanced', 'dense']), detail }).partial().strict(),
  nav: z.object({
    desktop: z.object({
      pattern: z.enum(['inline', 'centered_logo', 'split', 'mega']), items: z.array(link).max(30), cta: link, utility: list(10, str(30)), sticky: z.boolean(),
    }).partial().strict(),
    mobile: z.object({
      pattern: z.enum(['drawer_right', 'drawer_left', 'full_screen', 'bottom_bar']), trigger: z.enum(['icon_with_label', 'icon']),
      always_visible: list(10, str(30)), cta_in_drawer: z.boolean(), sticky: z.boolean(),
    }).partial().strict(),
  }).partial().strict(),
  container: z.object({
    max_content_px: z.number().int().min(320).max(3840), method: z.enum(['padding_cap', 'max_width']), wide_px: z.number().int().min(320).max(3840),
    full_bleed: list(20, str(40)),
    gutters_px: z.object({ phone: z.number().int().min(0).max(200), tablet: z.number().int().min(0).max(200), desktop: z.number().int().min(0).max(200) }).partial().strict(),
    measure_px: z.number().int().min(200).max(1400), why: str(1000),
  }).partial().strict(),
  features: z.array(z.object({
    id: str(40).min(1), name: str(120), what: str(1000), pages: list(20, str(200)), build_as: z.enum(['new_component', 'variant', 'module']),
    references: list(20, uuid), a11y: str(500),
  }).partial().required({ id: true, name: true, build_as: true }).strict()).max(20),
  flair: z.array(z.object({
    id: str(40).min(1), kind: z.enum(['semi_transparent_ground', 'angled_edge', 'overlap', 'illustration_behind', 'texture', 'pattern', 'other']),
    where: str(300), intensity: z.enum(['subtle', 'medium', 'strong']), phone: z.enum(['keep', 'reduce', 'hide']), references: list(20, uuid), detail,
  }).partial().required({ id: true, kind: true }).strict()).max(20),
  motion: z.object({ level: z.enum(['none', 'subtle', 'some']), detail }).partial().strict(),
  taken_from_references: z.array(z.object({ reference_id: uuid, property: str(300).min(1), markup_ids: list(20, uuid).optional() }).strict()).max(50),
  client_requests: z.array(z.object({ design_note_id: uuid, how_honoured: str(1000) }).strict()).max(100),
  avoid: list(30),
  open_questions: list(30, str(500)),
}).partial().strict();

export type DirectionBody = z.infer<typeof directionBodySchema>;

const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** How deep a patch's objects may nest. The record itself is at most four levels deep; this only stops abuse. */
export const MAX_PATCH_DEPTH = 12;

/**
 * JSON merge patch (RFC 7386): null removes a key, objects merge, everything else replaces. Refuses prototype keys and
 * objects nested deeper than `MAX_PATCH_DEPTH` (400 `bad_patch`, before the schema runs and before the stack can blow).
 */
export function mergePatch(target: unknown, patch: unknown, depth = 1): unknown {
  if (!isObject(patch)) return patch;
  if (depth > MAX_PATCH_DEPTH) throw new ApiError('That patch is nested too deeply', 400, 'bad_patch');
  const base: Record<string, unknown> = isObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (DANGEROUS.has(k)) throw new ApiError('That patch carries a reserved key', 400, 'bad_patch');
    if (v === null) delete base[k];
    else base[k] = mergePatch(base[k], v, depth + 1);
  }
  return base;
}

/**
 * The revision of a direction row: an OPAQUE token. Callers echo it back as `base_revision` and compare it for
 * equality; they never parse it or order it. Today it is the row's `updated_at` as an ISO string, and every write to a
 * draft moves `updated_at` strictly forward (`nextUpdatedAt`) under the track lock. Nothing else formats it.
 */
export function directionRevision(d: Pick<DesignArtDirection, 'updated_at'>): string {
  return d.updated_at.toISOString();
}

/** The `updated_at` a write sets: now, or one millisecond past the row's current value, so two writes in the same millisecond still get two revisions. */
export function nextUpdatedAt(current: Date | null | undefined): Date {
  return new Date(Math.max(Date.now(), (current?.getTime() ?? 0) + 1));
}

/** The top-level sections of the record a patch names; anything else (a no-op `null` for an unknown key) is never echoed. */
function patchedSections(patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter((k) => Object.prototype.hasOwnProperty.call(directionBodySchema.shape, k));
}

/** What the designer sees of a direction version: no `client_email_*`, no signer id (SPEC 3.5). */
export function directionView(d: DesignArtDirection) {
  return {
    id: d.id, version: d.version, status: d.status, revision: directionRevision(d), body: stripForbidden(d.body), drafted_by: d.drafted_by, signed_at: d.signed_at,
    created_at: d.created_at, updated_at: d.updated_at,
  };
}

/** The version the designer works on: the open draft, else the latest signed one, else null. */
async function currentDirection(trackId: string, db: Pick<typeof prisma, 'designArtDirection'> = prisma): Promise<DesignArtDirection | null> {
  const draft = await db.designArtDirection.findFirst({ where: { track_id: trackId, status: 'draft' } });
  if (draft) return draft;
  return db.designArtDirection.findFirst({ where: { track_id: trackId, status: 'signed' }, orderBy: { version: 'desc' } });
}

/** Active `require` or `avoid` notes of the client that the body answers in neither `client_requests` nor `open_questions`. */
export async function missingClientRequests(projectId: string, body: DirectionBody | null) {
  const statements = (await clientStatementsFor(projectId)).filter((n) => n.polarity === 'require' || n.polarity === 'avoid');
  const honoured = new Set((body?.client_requests ?? []).map((r) => r.design_note_id));
  const questions = body?.open_questions ?? [];
  return statements.filter((n) => !honoured.has(n.id) && !questions.some((q) => q.includes(n.id)));
}

/** Why a body cannot be signed yet: nav (desktop and mobile) and container must be filled. */
export function signGaps(body: DirectionBody): string[] {
  const gaps: string[] = [];
  if (!body.nav?.desktop?.pattern) gaps.push('nav.desktop');
  if (!body.nav?.mobile?.pattern) gaps.push('nav.mobile');
  if (!body.container?.max_content_px) gaps.push('container');
  return gaps;
}

export async function readDirection(track: { id: string; project_id: string }) {
  const current = await currentDirection(track.id);
  const parsed = current ? directionBodySchema.safeParse(current.body) : null;
  const body = parsed?.success ? parsed.data : null;
  const lastSigned = await prisma.designArtDirection.findFirst({ where: { track_id: track.id, status: 'signed' }, orderBy: { version: 'desc' }, select: { id: true, version: true, signed_at: true } });
  return {
    direction: current ? directionView(current) : null,
    signed: lastSigned,
    missing_client_requests: await missingClientRequests(track.project_id, body),
    sign_gaps: body ? signGaps(body) : ['nav.desktop', 'nav.mobile', 'container'],
  };
}

/** A best-effort feed line: system role, kind `art_direction`, only when the track has a live session (SPEC 3.4). */
async function recordDirectionEvent(trackId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const live = await prisma.designSession.findFirst({ where: { track_id: trackId, status: { notIn: ['closed', 'abandoned'] } }, select: { id: true } });
    if (!live) return;
    await appendWorkerEvents(live.id, { events: [{ role: 'system', kind: 'art_direction', payload: payload as never }] });
  } catch (e) {
    console.error('art_direction event failed', e);
  }
}

/** PATCH art-direction: merge `patch` into the open draft (or start version 1 in art_direction). */
export async function patchDirection(trackId: string, designerId: string, input: { patch: Record<string, unknown>; base_version: number; base_revision?: string }) {
  return patchDirectionAs(trackId, { draftedBy: 'designer', by: designerId }, input);
}

/**
 * The one implementation behind the designer PATCH and the worker PATCH (SPEC 5.1), so both get the same schema, size
 * cap and stage rules. The worker may omit `base_version` ("the version I just read"); the designer always sends it.
 * `base_revision` is the revision the caller read: on an existing draft the worker must send it and the designer
 * should (optional only so older callers keep working); a mismatch is 409 `version_moved`. Creating version 1 takes no
 * revision. The write is a compare-and-swap on the revision read under the lock. Nothing here signs or revises.
 */
export async function patchDirectionAs(
  trackId: string,
  actor: { draftedBy: 'designer' | 'worker'; by: string },
  input: { patch: Record<string, unknown>; base_version?: number; base_revision?: string },
) {
  const signedMessage = actor.draftedBy === 'worker' ? 'This version is signed; the designer revises it to change it' : 'This version is signed; revise the direction to edit it';
  const movedMessage = actor.draftedBy === 'worker' ? 'The art direction changed; read it again' : 'The art direction changed; reload';
  const out = await trackTx(async ({ tx }) => {
    await lockTrack(tx, trackId);
    const track = await loadTrack(tx, trackId);
    const draft = await tx.designArtDirection.findFirst({ where: { track_id: trackId, status: 'draft' } });
    if (!draft) {
      const signed = await tx.designArtDirection.findFirst({ where: { track_id: trackId, status: 'signed' }, orderBy: { version: 'desc' } });
      if (signed) throw new ApiError(signedMessage, 409, 'direction_signed');
      if (track.stage !== 'art_direction') throw new ApiError('There is no art direction to edit at this stage', 409, 'illegal_transition');
      if ((input.base_version ?? 0) !== 0) throw new ApiError(movedMessage, 409, 'version_moved');
      if (input.base_revision !== undefined) throw new ApiError(movedMessage, 409, 'version_moved');
      const body = directionBodySchema.parse(mergePatch({}, input.patch));
      assertSize(body);
      const created = await tx.designArtDirection.create({
        data: { track_id: trackId, version: 1, status: 'draft', body: body as Prisma.InputJsonValue, drafted_by: actor.draftedBy, updated_at: nextUpdatedAt(null) },
      });
      return { row: created, fields: patchedSections(input.patch) };
    }
    if (input.base_version !== undefined && draft.version !== input.base_version) throw new ApiError(movedMessage, 409, 'version_moved');
    if (input.base_revision === undefined ? actor.draftedBy === 'worker' : input.base_revision !== directionRevision(draft)) {
      throw new ApiError(movedMessage, 409, 'version_moved');
    }
    const merged = directionBodySchema.parse(mergePatch(draft.body, input.patch));
    assertSize(merged);
    const res = await tx.designArtDirection.updateMany({
      where: { id: draft.id, status: 'draft', version: draft.version, updated_at: draft.updated_at },
      data: { body: merged as Prisma.InputJsonValue, drafted_by: actor.draftedBy, updated_at: nextUpdatedAt(draft.updated_at) },
    });
    if (res.count !== 1) throw new ApiError(movedMessage, 409, 'version_moved');
    const row = await tx.designArtDirection.findUniqueOrThrow({ where: { id: draft.id } });
    return { row, fields: patchedSections(input.patch) };
  });
  await recordDirectionEvent(trackId, { version: out.row.version, status: 'draft', fields: out.fields, by: actor.by });
  return directionView(out.row);
}

function assertSize(body: unknown): void {
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_DIRECTION_BYTES) throw new ApiError('The art direction is over 128 KB', 413, 'direction_too_large');
}

/** Top-level sections that differ between two bodies, for the plain-language line a refinement carries. */
function changedSections(before: unknown, after: unknown): string[] {
  const a = isObject(before) ? before : {};
  const b = isObject(after) ? after : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export type SignMode = 'refinements' | 'rebuild';

/**
 * POST art-direction/sign. Stage art_direction: freezes the draft and runs the first sign-off (home build, modules, brief
 * email). Later versions (refine, review, or a failed home build) ask `mode`: `rebuild` queues a new home build,
 * `refinements` (default) keeps the stage and appends one designer text event with the difference. Each signed version
 * queues its own `client_brief_email`.
 *
 * `base_revision` is the revision the designer's screen showed. The draft is read and validated here, outside the lock,
 * and everything below (gaps, client requests, modules, the email and build payloads, the refinement text) comes from
 * that one row. `freeze` then signs only if the row still holds that revision, under the lock every writer takes, so a
 * write that lands between the read and the freeze makes the whole move 409 `version_moved` and nothing is queued.
 */
export async function signArtDirection(trackId: string, designerId: string, input: { base_version: number; base_revision: string; mode?: SignMode }) {
  const track = await loadTrack(prisma, trackId);
  const draft = await prisma.designArtDirection.findFirst({ where: { track_id: trackId, status: 'draft' } });
  if (!draft) {
    const signed = await prisma.designArtDirection.findFirst({ where: { track_id: trackId, status: 'signed' }, select: { id: true } });
    if (signed) throw new ApiError('This version is already signed', 409, 'direction_signed');
    throw new ApiError('There is no art direction draft to sign', 409, 'no_draft');
  }
  if (draft.version !== input.base_version || directionRevision(draft) !== input.base_revision) throw new ApiError('The art direction changed; reload', 409, 'version_moved');
  const parsed = directionBodySchema.safeParse(draft.body);
  if (!parsed.success) throw new ApiError('The art direction draft is not valid', 409, 'direction_incomplete');
  const body = parsed.data;
  const gaps = signGaps(body);
  if (gaps.length > 0) throw new ApiError(`Fill in ${gaps.join(', ')} before signing`, 409, 'direction_incomplete');
  const missing = await missingClientRequests(track.project_id, body);
  if (missing.length > 0) throw new ApiError(`${missing.length} client request(s) are not answered yet`, 409, 'client_requests_missing');

  const mode: SignMode = input.mode ?? 'refinements';
  const prior = await prisma.designArtDirection.findFirst({ where: { track_id: trackId, status: 'signed' }, orderBy: { version: 'desc' } });
  const modules = (body.features ?? []).filter((f) => f.build_as === 'module').map((f) => ({ art_direction_id: draft.id, feature_id: f.id, name: f.name, what: f.what ?? null, pages: f.pages ?? [], a11y: f.a11y ?? null }));
  const common: Omit<HomeBuildInput, 'designerId'> = {
    modules,
    clientEmailPayload: { art_direction_id: draft.id, version: draft.version },
    buildPayload: { art_direction_id: draft.id, version: draft.version, mode: track.stage === 'art_direction' ? 'first' : 'rebuild' },
    onQueued: (scope, r) => freeze(scope, { trackId, draftId: draft.id, version: draft.version, updatedAt: draft.updated_at, designerId, emailJobId: r.clientEmailJobId }),
  };

  let jobs: { build_job_id: string | null; client_email_job_id: string };
  let stage: string;
  if (track.stage === 'art_direction') {
    const r = await signDirection(trackId, { designerId, completeTag: 'design-stage:art_direction', ...common });
    jobs = { build_job_id: r.buildJobId, client_email_job_id: r.clientEmailJobId };
    stage = 'home_build';
  } else if (mode === 'rebuild' && ['refine', 'review', 'home_build'].includes(track.stage)) {
    const r = await rebuildHome(trackId, { designerId, ...common });
    jobs = { build_job_id: r.buildJobId, client_email_job_id: r.clientEmailJobId };
    stage = 'home_build';
  } else if (mode === 'refinements' && ['refine', 'review'].includes(track.stage)) {
    const diff = changedSections(prior?.body, draft.body);
    jobs = await trackTx(async (scope) => {
      await lockTrack(scope.tx, trackId);
      const fresh = await loadTrack(scope.tx, trackId);
      if (fresh.stage !== track.stage) throw new ApiError('Track changed state; reload and retry', 409, 'state_conflict');
      const mail = await queueJob(scope.tx, fresh, 'client_brief_email', { payload: common.clientEmailPayload as never, taskId: null });
      await freeze(scope, { trackId, draftId: draft.id, version: draft.version, updatedAt: draft.updated_at, designerId, emailJobId: mail!.id });
      await appendRefinementEvent(scope, trackId, designerId, draft.id, draft.version, body.summary, diff);
      return { build_job_id: null, client_email_job_id: mail!.id };
    });
    stage = track.stage;
  } else {
    throw new ApiError(`The direction cannot be signed in ${track.stage} that way`, 409, 'illegal_transition');
  }
  await recordDirectionEvent(trackId, { version: draft.version, status: 'signed', mode: track.stage === 'art_direction' ? 'first' : mode });
  const row = await prisma.designArtDirection.findUniqueOrThrow({ where: { id: draft.id } });
  return { direction: directionView(row), stage, ...jobs };
}

/**
 * Freeze the draft in the caller's transaction: signed, supersede the earlier signed version, point the track at it.
 * Only the revision that was validated (`updatedAt`) is frozen; the caller holds the track lock, which every draft
 * writer takes, so the row cannot move between this check and the commit.
 */
async function freeze(scope: TrackScope, a: { trackId: string; draftId: string; version: number; updatedAt: Date; designerId: string; emailJobId: string }): Promise<void> {
  const { tx } = scope;
  const res = await tx.designArtDirection.updateMany({
    where: { id: a.draftId, status: 'draft', version: a.version, updated_at: a.updatedAt },
    data: { status: 'signed', signed_by_id: a.designerId, signed_at: new Date(), client_email_job_id: a.emailJobId, client_email_status: 'queued' },
  });
  if (res.count !== 1) {
    const now = await tx.designArtDirection.findUnique({ where: { id: a.draftId }, select: { status: true } });
    if (now && now.status !== 'draft') throw new ApiError('This version is already signed', 409, 'direction_signed');
    throw new ApiError('The art direction changed; reload', 409, 'version_moved');
  }
  await tx.designArtDirection.updateMany({ where: { track_id: a.trackId, status: 'signed', id: { not: a.draftId } }, data: { status: 'superseded' } });
  await tx.designTrack.update({ where: { id: a.trackId }, data: { art_direction_id: a.draftId } });
}

/** One designer `text` event, authored by the designer, so the worker picks the difference up as a normal message (SPEC 2.5). */
async function appendRefinementEvent(scope: TrackScope, trackId: string, designerId: string, directionId: string, version: number, summary: string | undefined, diff: string[]): Promise<void> {
  const { tx } = scope;
  const live = await tx.designSession.findFirst({ where: { track_id: trackId, status: { notIn: ['closed', 'abandoned'] } }, select: { id: true } });
  if (!live) return;
  const text = [
    `The art direction was revised and signed as version ${version}. Apply the difference to the current build as refinements; do not rebuild the home page.`,
    diff.length ? `Changed: ${diff.join(', ')}.` : '',
    summary ? `Direction in short: ${summary}` : '',
  ].filter(Boolean).join(' ').slice(0, 8000);
  const rows = await tx.$queryRaw<{ last_seq: number }[]>`UPDATE design_sessions SET last_seq = last_seq + 1 WHERE id = ${live.id}::uuid RETURNING last_seq`;
  await tx.designEvent.create({
    data: { session_id: live.id, seq: rows[0].last_seq, role: 'designer', kind: 'text', payload: { text }, author_id: designerId, client_ref: `art-direction:${directionId}` },
  });
}

/**
 * POST art-direction/revise: a new draft (the signed body, version + 1). Allowed in refine and review, and in home_build
 * only when the build job has failed for good (SPEC 2.5).
 */
export async function reviseDirection(trackId: string, designerId: string) {
  const row = await trackTx(async ({ tx }) => {
    await lockTrack(tx, trackId);
    const track = await loadTrack(tx, trackId);
    if (!['refine', 'review', 'home_build'].includes(track.stage)) throw new ApiError('The direction cannot be revised at this stage', 409, 'illegal_transition');
    if (track.stage === 'home_build') {
      const active = await tx.designJob.count({ where: { track_id: trackId, kind: 'home_build', status: { in: ['queued', 'claimed', 'running'] } } });
      const failed = await tx.designJob.count({ where: { track_id: trackId, kind: 'home_build', status: 'failed' } });
      if (active > 0 || failed === 0) throw new ApiError('The home build has not failed', 409, 'illegal_transition');
    }
    if (await tx.designArtDirection.findFirst({ where: { track_id: trackId, status: 'draft' }, select: { id: true } })) {
      throw new ApiError('There is already an open draft', 409, 'draft_exists');
    }
    const signed = await tx.designArtDirection.findFirst({ where: { track_id: trackId, status: 'signed' }, orderBy: { version: 'desc' } });
    if (!signed) throw new ApiError('There is no signed direction to revise', 409, 'no_signed_direction');
    const last = await tx.designArtDirection.aggregate({ where: { track_id: trackId }, _max: { version: true } });
    return tx.designArtDirection.create({
      data: {
        track_id: trackId, version: (last._max.version ?? signed.version) + 1, status: 'draft', body: signed.body as Prisma.InputJsonValue, drafted_by: 'designer',
        // strictly after the signed row, so a revision read before the sign can never match the new draft
        updated_at: nextUpdatedAt(signed.updated_at),
      },
    });
  });
  await recordDirectionEvent(trackId, { version: row.version, status: 'draft', revised: true, by: designerId });
  return directionView(row);
}
