/**
 * Designer Portal v2: the designer side of the brief and the mood board (SPEC 4.1, 4.3, 4.11 rows 1 to 7).
 * Every function takes the session's track id (the route has already loaded the session for the caller and refused a
 * stranger with 404). Everything that leaves here is an explicit projection; JSON written by the runner (brief body,
 * `extracted`) passes through `stripForbidden`, so a forbidden key can never reach a designer.
 */
import type { DesignReference, DesignTrackAsset, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { FORBIDDEN_PROJECTION_KEYS } from './projections';
import { isUuid } from './helpers';
import { loadTrack, lockTrack, queueJob, trackTx } from './track-core';
import { isBrowserServable, trackAssetView } from './track-assets';

export const REACTIONS = ['useful', 'not_relevant'] as const;
export const MARKUP_SENTIMENTS = ['like', 'dislike', 'note'] as const;
export const MARKUP_CATEGORIES = ['type', 'colour', 'layout', 'density', 'imagery', 'nav', 'decoration', 'motion', 'feature', 'tone', 'other'] as const;
export const REFERENCE_DECISIONS = ['pending', 'yes', 'no'] as const;
export const MAX_LIVE_MARKUPS_PER_REFERENCE = 50;

const FORBIDDEN = new Set<string>(FORBIDDEN_PROJECTION_KEYS);
/** Brief and direction bodies are runner or designer JSON: rename `client` (a forbidden key) and drop any other forbidden key at any depth. */
export function stripForbidden(value: unknown, top = true): unknown {
  if (Array.isArray(value)) return value.map((v) => stripForbidden(v, false));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (top && k === 'client') out.client_name = v;
      else if (!FORBIDDEN.has(k)) out[k] = stripForbidden(v, false);
    }
    return out;
  }
  return value;
}

export type ClientStatement = {
  id: string; quote: string; speaker_name: string; speaker_role: string; source_date: Date; source_kind: string;
  is_paraphrase: boolean; subject: string; category: string; polarity: string; status: string;
};

type NoteRow = Prisma.DesignNoteGetPayload<object>;
export const statementView = (n: NoteRow): ClientStatement => ({
  id: n.id, quote: n.quote, speaker_name: n.speaker_name, speaker_role: n.speaker_role, source_date: n.source_date,
  source_kind: n.source_kind, is_paraphrase: n.is_paraphrase, subject: n.subject, category: n.category, polarity: n.polarity, status: n.status,
});

/** Active design notes of the project's client, as `client_statements` (the only way a note reaches a designer). */
export async function clientStatementsFor(projectId: string): Promise<ClientStatement[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { client_id: true } });
  if (!project?.client_id) return [];
  const notes = await prisma.designNote.findMany({ where: { client_id: project.client_id, status: 'active' }, orderBy: { source_date: 'asc' } });
  return notes.map(statementView);
}

// ---------------------------------------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------------------------------------

/** GET brief: the published brief, the caller's own reactions, `client_statements`, and the assets its cards name. */
export async function readBrief(track: { id: string; project_id: string; brief_id: string | null }, sessionId: string, userId: string) {
  const brief = track.brief_id ? await prisma.designBrief.findUnique({ where: { id: track.brief_id } }) : null;
  const published = brief && brief.status === 'published' ? brief : null;
  let assets: ReturnType<typeof trackAssetView>[] = [];
  let reactions: Array<{ card_id: string; reaction: string; note: string | null }> = [];
  if (published) {
    const ids = new Set<string>();
    const body = published.body as { sections?: Array<{ cards?: Array<{ image_asset_ids?: unknown }> }> };
    for (const s of body.sections ?? []) for (const c of s.cards ?? []) if (Array.isArray(c.image_asset_ids)) for (const id of c.image_asset_ids) if (isUuid(id)) ids.add(id);
    if (ids.size > 0) {
      const rows = await prisma.designTrackAsset.findMany({ where: { id: { in: [...ids] }, track_id: track.id } });
      assets = rows.filter(isBrowserServable).map((a) => trackAssetView(a, sessionId));
    }
    const rs = await prisma.designBriefReaction.findMany({ where: { brief_id: published.id, created_by_id: userId }, orderBy: { created_at: 'asc' } });
    reactions = rs.map((r) => ({ card_id: r.card_id, reaction: r.reaction, note: r.note }));
  }
  return {
    brief: published ? { id: published.id, version: published.version, published_at: published.published_at, body: stripForbidden(published.body) } : null,
    assets,
    reactions,
    client_statements: await clientStatementsFor(track.project_id),
  };
}

/** POST brief/reactions: upsert one reaction of the caller on one card of the published brief. */
export async function upsertReaction(track: { id: string; brief_id: string | null }, userId: string, input: { card_id: string; reaction: string; note?: string }) {
  const brief = track.brief_id ? await prisma.designBrief.findUnique({ where: { id: track.brief_id } }) : null;
  if (!brief || brief.status !== 'published') throw new ApiError('There is no published brief yet', 409, 'no_brief');
  const body = brief.body as { sections?: Array<{ cards?: Array<{ id?: string }> }> };
  const known = (body.sections ?? []).some((s) => (s.cards ?? []).some((c) => c.id === input.card_id));
  if (!known) throw new ApiError('That card is not in the brief', 404, 'unknown_card');
  const data = { reaction: input.reaction, note: input.note ?? null };
  const updated = await prisma.designBriefReaction.updateMany({ where: { brief_id: brief.id, card_id: input.card_id, created_by_id: userId }, data });
  if (updated.count === 0) {
    try {
      await prisma.designBriefReaction.create({ data: { brief_id: brief.id, card_id: input.card_id, created_by_id: userId, ...data } });
    } catch {
      await prisma.designBriefReaction.updateMany({ where: { brief_id: brief.id, card_id: input.card_id, created_by_id: userId }, data });
    }
  }
  return { card_id: input.card_id, reaction: input.reaction, note: data.note };
}

// ---------------------------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------------------------

/**
 * Parse and validate a reference URL server side (nothing is fetched from Citadel). https only, no credentials, a real
 * host name (not an IP literal, localhost or a single label), no port other than 443. The fragment is dropped.
 */
export function parseReferenceUrl(raw: string): string {
  const bad = (why: string) => new ApiError(`That is not a usable web address: ${why}`, 400, 'bad_url');
  const text = raw.trim();
  if (text.length === 0 || text.length > 500) throw bad('it is empty or too long');
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw bad('it could not be read');
  }
  if (u.protocol !== 'https:') throw bad('it must start with https://');
  if (u.username || u.password) throw bad('it must not carry a login');
  if (u.port && u.port !== '443') throw bad('it must use the standard port');
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host) || /^[\d.]+$/.test(host)) throw bad('it must be a site name');
  if (host === 'localhost' || /\.(?:local|localhost|internal|lan|home|test|invalid)$/.test(host)) throw bad('it must be a public site');
  u.hash = '';
  const out = u.toString();
  if (out.length > 500) throw bad('it is too long');
  return out;
}

type RefWithMarkups = DesignReference & { markups: Array<{ id: string; asset_id: string; rect: unknown; sentiment: string; category: string; note: string | null; created_at: Date }> };

function referenceView(r: RefWithMarkups, assets: Map<string, DesignTrackAsset>, rendersByParent: Map<string, DesignTrackAsset[]>, sessionId: string) {
  const one = (id: string | null) => {
    const a = id ? assets.get(id) : undefined;
    return a ? trackAssetView(a, sessionId) : null;
  };
  return {
    id: r.id, source: r.source, url: r.url, title: r.title, why_md: r.why_md, decision: r.decision, decided_at: r.decided_at,
    decision_note: r.decision_note, capture_status: r.capture_status, capture_error: r.capture_error,
    captures: { desktop_fold: one(r.desktop_fold_asset_id), desktop_full: one(r.desktop_full_asset_id), phone_fold: one(r.phone_fold_asset_id), phone_full: one(r.phone_full_asset_id) },
    uploads: r.upload_asset_ids.flatMap((id) => {
      const a = assets.get(id);
      return a ? [{ asset: trackAssetView(a, sessionId), renders: (rendersByParent.get(id) ?? []).map((x) => trackAssetView(x, sessionId)) }] : [];
    }),
    extracted: r.extracted === null ? null : stripForbidden(r.extracted),
    sort_order: r.sort_order,
    markups: r.markups.map((m) => ({ id: m.id, asset_id: m.asset_id, rect: m.rect, sentiment: m.sentiment, category: m.category, note: m.note, created_at: m.created_at })),
  };
}

async function viewsFor(trackId: string, refs: RefWithMarkups[], sessionId: string) {
  const ids = new Set<string>();
  for (const r of refs) {
    for (const id of [r.desktop_fold_asset_id, r.desktop_full_asset_id, r.phone_fold_asset_id, r.phone_full_asset_id]) if (id) ids.add(id);
    for (const id of r.upload_asset_ids) ids.add(id);
  }
  const rows = ids.size ? await prisma.designTrackAsset.findMany({ where: { track_id: trackId, OR: [{ id: { in: [...ids] } }, { parent_asset_id: { in: [...ids] } }] } }) : [];
  const assets = new Map(rows.map((a) => [a.id, a]));
  const renders = new Map<string, DesignTrackAsset[]>();
  for (const a of rows) {
    if (a.kind === 'render' && a.parent_asset_id) renders.set(a.parent_asset_id, [...(renders.get(a.parent_asset_id) ?? []), a]);
  }
  for (const list of renders.values()) list.sort((x, y) => (x.page ?? 0) - (y.page ?? 0));
  return refs.map((r) => referenceView(r, assets, renders, sessionId));
}

const LIVE_MARKUPS = { where: { deleted_at: null }, orderBy: { created_at: 'asc' as const } };

/** GET references: cards with live markups and capture states. */
export async function listReferences(trackId: string, sessionId: string) {
  const refs = await prisma.designReference.findMany({ where: { track_id: trackId }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }], include: { markups: LIVE_MARKUPS } });
  return viewsFor(trackId, refs, sessionId);
}

async function oneReference(trackId: string, id: string, sessionId: string) {
  const r = await prisma.designReference.findFirstOrThrow({ where: { id, track_id: trackId }, include: { markups: LIVE_MARKUPS } });
  return (await viewsFor(trackId, [r], sessionId))[0];
}

/**
 * POST references: `{url}` (parsed and validated here, one `capture` job queued, status `queued`) or `{upload_asset_ids}`
 * (board uploads of this track become one card of source `designer_upload`). A URL already on the track is 409.
 */
export async function addDesignerReference(
  trackId: string, sessionId: string, input: { url?: string; upload_asset_ids?: string[]; title?: string },
) {
  const url = input.url !== undefined ? parseReferenceUrl(input.url) : null;
  const uploadIds = input.upload_asset_ids ? [...new Set(input.upload_asset_ids)] : [];
  const id = await trackTx(async ({ tx }) => {
    await lockTrack(tx, trackId);
    const track = await loadTrack(tx, trackId);
    const last = await tx.designReference.aggregate({ where: { track_id: trackId }, _max: { sort_order: true } });
    const sort_order = (last._max.sort_order ?? -1) + 1;
    if (url) {
      if (await tx.designReference.findFirst({ where: { track_id: trackId, url }, select: { id: true } })) throw new ApiError('That site is already on the board', 409, 'duplicate_url');
      const title = (input.title?.trim() || new URL(url).hostname.replace(/^www\./, '')).slice(0, 200);
      const ref = await tx.designReference.create({ data: { track_id: trackId, source: 'designer_url', url, title, capture_status: 'queued', sort_order } });
      await queueJob(tx, track, 'capture', { payload: { reference_id: ref.id, url }, taskId: null });
      return ref.id;
    }
    const assets = await tx.designTrackAsset.findMany({ where: { id: { in: uploadIds }, track_id: trackId, kind: 'upload', purpose: 'board', source: 'designer' } });
    if (assets.length !== uploadIds.length) throw new ApiError('Every upload must be a board upload of this track', 400, 'bad_upload_ids');
    const taken = await tx.designReference.findFirst({ where: { track_id: trackId, upload_asset_ids: { hasSome: uploadIds } }, select: { id: true } });
    if (taken) throw new ApiError('An upload is already on a board card', 409, 'upload_in_use');
    const first = assets.find((a) => a.id === uploadIds[0]);
    const title = (input.title?.trim() || first?.original_name || 'Uploaded sample').slice(0, 200);
    const ref = await tx.designReference.create({ data: { track_id: trackId, source: 'designer_upload', title, upload_asset_ids: uploadIds, sort_order } });
    return ref.id;
  });
  return oneReference(trackId, id, sessionId);
}

/** PATCH references/:refId: decision, decision note, sort order. 404 for a reference of another track. */
export async function patchReference(
  trackId: string, sessionId: string, refId: string, userId: string,
  input: { decision?: string; decision_note?: string | null; sort_order?: number },
) {
  if (!isUuid(refId)) throw new ApiError('Reference not found', 404, 'not_found');
  const ref = await prisma.designReference.findFirst({ where: { id: refId, track_id: trackId }, select: { id: true } });
  if (!ref) throw new ApiError('Reference not found', 404, 'not_found');
  await prisma.designReference.update({
    where: { id: refId },
    data: {
      ...(input.decision !== undefined ? { decision: input.decision, decided_by_id: input.decision === 'pending' ? null : userId, decided_at: input.decision === 'pending' ? null : new Date() } : {}),
      ...(input.decision_note !== undefined ? { decision_note: input.decision_note } : {}),
      ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
    },
  });
  return oneReference(trackId, refId, sessionId);
}

// ---------------------------------------------------------------------------------------------------------
// Markups
// ---------------------------------------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }

/** Boxes are fractions of the image: each 0 to 1, a real area, and inside the image. */
export function validRect(r: Rect): boolean {
  const inUnit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  return inUnit(r.x) && inUnit(r.y) && inUnit(r.w) && inUnit(r.h) && r.w > 0 && r.h > 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001;
}

/** The image assets a markup on this reference may point at: its captures, its raster uploads and their renders. */
async function markableAssetIds(trackId: string, ref: DesignReference): Promise<Set<string>> {
  const ids = [ref.desktop_fold_asset_id, ref.desktop_full_asset_id, ref.phone_fold_asset_id, ref.phone_full_asset_id, ...ref.upload_asset_ids].filter((x): x is string => !!x);
  if (ids.length === 0) return new Set();
  const rows = await prisma.designTrackAsset.findMany({ where: { track_id: trackId, OR: [{ id: { in: ids } }, { parent_asset_id: { in: ids } }] } });
  return new Set(rows.filter(isBrowserServable).map((a) => a.id));
}

const markupView = (m: { id: string; reference_id: string; asset_id: string; rect: unknown; sentiment: string; category: string; note: string | null; created_at: Date; deleted_at: Date | null }) => ({
  id: m.id, reference_id: m.reference_id, asset_id: m.asset_id, rect: m.rect, sentiment: m.sentiment, category: m.category, note: m.note, created_at: m.created_at, deleted: m.deleted_at !== null,
});

/** POST markups: the reference and the image must belong to this track; at most 50 live boxes a reference (409 `markup_limit`). */
export async function createMarkup(
  trackId: string, userId: string,
  input: { reference_id: string; asset_id: string; rect: Rect; sentiment: string; category: string; note?: string },
) {
  if (!validRect(input.rect)) throw new ApiError('The box must sit inside the image (fractions 0 to 1)', 400, 'bad_rect');
  const ref = await prisma.designReference.findFirst({ where: { id: input.reference_id, track_id: trackId } });
  if (!ref) throw new ApiError('Reference not found', 404, 'not_found');
  if (!(await markableAssetIds(trackId, ref)).has(input.asset_id)) throw new ApiError('That image is not on this card', 400, 'bad_asset');
  return trackTx(async ({ tx }) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`design-markups:${ref.id}`}))`;
    const live = await tx.designMarkup.count({ where: { reference_id: ref.id, deleted_at: null } });
    if (live >= MAX_LIVE_MARKUPS_PER_REFERENCE) throw new ApiError('At most 50 boxes on one card', 409, 'markup_limit');
    const m = await tx.designMarkup.create({
      data: { reference_id: ref.id, asset_id: input.asset_id, rect: input.rect as unknown as Prisma.InputJsonValue, sentiment: input.sentiment, category: input.category, note: input.note ?? null, created_by_id: userId },
    });
    return markupView(m);
  });
}

/** PATCH markups/:markupId: edit, or remove with `{deleted: true}` (undelete with false). 404 for another track's markup. */
export async function patchMarkup(
  trackId: string, markupId: string,
  input: { rect?: Rect; sentiment?: string; category?: string; note?: string | null; deleted?: boolean },
) {
  if (!isUuid(markupId)) throw new ApiError('Markup not found', 404, 'not_found');
  const m = await prisma.designMarkup.findFirst({ where: { id: markupId, reference: { track_id: trackId } } });
  if (!m) throw new ApiError('Markup not found', 404, 'not_found');
  if (input.rect && !validRect(input.rect)) throw new ApiError('The box must sit inside the image (fractions 0 to 1)', 400, 'bad_rect');
  return trackTx(async ({ tx }) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`design-markups:${m.reference_id}`}))`;
    if (input.deleted === false && m.deleted_at !== null) {
      const live = await tx.designMarkup.count({ where: { reference_id: m.reference_id, deleted_at: null } });
      if (live >= MAX_LIVE_MARKUPS_PER_REFERENCE) throw new ApiError('At most 50 boxes on one card', 409, 'markup_limit');
    }
    const updated = await tx.designMarkup.update({
      where: { id: m.id },
      data: {
        ...(input.rect ? { rect: input.rect as unknown as Prisma.InputJsonValue } : {}),
        ...(input.sentiment !== undefined ? { sentiment: input.sentiment } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.deleted !== undefined ? { deleted_at: input.deleted ? (m.deleted_at ?? new Date()) : null } : {}),
      },
    });
    return markupView(updated);
  });
}
