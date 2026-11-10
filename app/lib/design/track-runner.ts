/**
 * Designer Portal v2: the runner's reads and writes that are not job or adopt mechanics (SPEC 6.1a): candidates, track
 * start, the track read with its includes, references, briefs, imports, and the recipients Citadel computes.
 */
import { Prisma } from '@prisma/client';
import type { DesignTrack } from '@prisma/client';
import crypto from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { briefBodySchema, MAX_BRIEF_BYTES } from './brief-schema';
import { loadTrack, lockTrack, queueJob, trackTx, type Tx } from './track-core';
import { maybeEnterArtDirection } from './track-stage';
import { statementScope, statementView, type ClientStatement } from './track-board';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** 16 characters of lowercase base32 from a cryptographic source: 80 bits (SPEC 2.2). Lowercase only, `[a-z2-7]{16}`. */
export function newSlug(): string {
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => B32[b & 31]).join('');
}

export function trackView(t: DesignTrack) {
  return {
    id: t.id, site_id: t.site_id, project_id: t.project_id, round: t.round, slug: t.slug, stage: t.stage, branch: t.branch,
    preview_alias: t.preview_alias, preview_url: t.preview_url, preview_sha: t.preview_sha, head_sha: t.head_sha,
    brief_id: t.brief_id, art_direction_id: t.art_direction_id, busy_job_id: t.busy_job_id, finish_command_id: t.finish_command_id,
    finish_result: t.finish_result, finished_at: t.finished_at, created_at: t.created_at, updated_at: t.updated_at,
  };
}

type Readiness = 'bast_enabled_false' | 'design_portal_enabled_false' | 'site_not_configured' | null;

async function siteReadiness(db: Tx | typeof prisma, site: { id: string; bast_enabled: boolean; design_portal_enabled: boolean }): Promise<Readiness> {
  if (!site.bast_enabled) return 'bast_enabled_false';
  if (!site.design_portal_enabled) return 'design_portal_enabled_false';
  const w = await db.designWorkerState.findUnique({ where: { id: 1 }, select: { configured_site_ids: true } });
  if (!w?.configured_site_ids.includes(site.id)) return 'site_not_configured';
  return null;
}

const SITE_SELECT = { id: true, design_path: true, bast_enabled: true, design_portal_enabled: true } as const;

/** The tasks the runner may start tracks from, plus design-import tasks on tracked projects (SPEC 6.1a). */
export async function listCandidates() {
  const tasks = await prisma.task.findMany({
    where: {
      is_deleted: false, status: 'not_started', project_id: { not: null },
      OR: [{ tags: { has: 'design-job:provision' } }, { tags: { has: 'design-job:research' } }],
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, tags: true, project_id: true, site_id: true, project: { select: { site_id: true } } },
    take: 200,
  });
  const out: Array<Record<string, unknown>> = [];
  for (const t of tasks) {
    const siteId = t.site_id ?? t.project?.site_id ?? null;
    if (!siteId) continue;
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: SITE_SELECT });
    if (!site || site.design_path !== 'portal') continue;
    out.push({
      task_id: t.id, title: t.title, kind: t.tags.includes('design-job:provision') ? 'provision' : 'research',
      site_id: site.id, project_id: t.project_id, blocked_reason: await siteReadiness(prisma, site),
    });
  }
  const imports = await prisma.task.findMany({
    where: {
      is_deleted: false, status: { notIn: ['done', 'abandoned'] }, tags: { has: 'design-import' }, project_id: { not: null },
      design_imports: { none: {} },
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, project_id: true, site_id: true, project: { select: { site_id: true } } },
    take: 200,
  });
  for (const t of imports) {
    const track = await prisma.designTrack.findFirst({ where: { project_id: t.project_id!, stage: { not: 'cancelled' } }, orderBy: { round: 'desc' } });
    if (!track) continue;
    const site = await prisma.site.findUnique({ where: { id: track.site_id }, select: SITE_SELECT });
    if (!site) continue;
    out.push({
      task_id: t.id, title: t.title, kind: 'import', site_id: site.id, project_id: t.project_id, track_id: track.id,
      blocked_reason: await siteReadiness(prisma, site),
    });
  }
  return out;
}

/**
 * POST /runner/tracks {task_id}: the site's open track (200), or a new one (201) that queues `provision` and
 * `research`. The task must be tagged design-job:provision or design-job:research on a site with design_path portal
 * that is ready (409 `site_not_ready` names the reason). One open track per site is a database fact.
 */
export async function startTrack(taskId: string): Promise<{ track: DesignTrack; created: boolean }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, is_deleted: true, tags: true, project_id: true, site_id: true, project: { select: { site_id: true } } },
  });
  if (!task || task.is_deleted) throw new ApiError('Task not found', 404, 'not_found');
  if (!task.project_id || !(task.tags.includes('design-job:provision') || task.tags.includes('design-job:research'))) {
    throw new ApiError('This task does not start a design track', 409, 'not_candidate');
  }
  const siteId = task.site_id ?? task.project?.site_id ?? null;
  const site = siteId ? await prisma.site.findUnique({ where: { id: siteId }, select: SITE_SELECT }) : null;
  if (!site || site.design_path !== 'portal') throw new ApiError('The site is not on the portal design path', 409, 'site_not_ready');
  const projectId = task.project_id;
  return trackTx(async ({ tx }) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`design-track-start:${site.id}`}))`;
    const open = await tx.designTrack.findFirst({ where: { site_id: site.id, stage: { notIn: ['done', 'cancelled'] } } });
    if (open) return { track: open, created: false };
    const reason = await siteReadiness(tx, site);
    if (reason) throw new ApiError(`The site is not ready: ${reason}`, 409, 'site_not_ready');
    const last = await tx.designTrack.aggregate({ where: { site_id: site.id }, _max: { round: true } });
    const slug = newSlug();
    const track = await tx.designTrack.create({
      data: { site_id: site.id, project_id: projectId, round: (last._max.round ?? 0) + 1, slug, branch: `design/t-${slug}`, preview_alias: `design-t-${slug}` },
    });
    await queueJob(tx, track, 'provision', { payload: {} });
    await queueJob(tx, track, 'research', { payload: {} });
    return { track, created: true };
  });
}

export const TRACK_INCLUDES = ['brief', 'references', 'direction', 'client_statements', 'brand_profile', 'pages', 'imports', 'recipients'] as const;
export type TrackInclude = (typeof TRACK_INCLUDES)[number];

export function parseIncludes(raw: string | null): TrackInclude[] {
  if (!raw) return [];
  const want = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = want.filter((w) => !(TRACK_INCLUDES as readonly string[]).includes(w));
  if (bad.length > 0) throw new ApiError(`Unknown include: ${bad.join(', ')}`, 400, 'bad_include');
  return [...new Set(want)] as TrackInclude[];
}

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
const siteDomain = (url: string | null) => {
  try { return new URL(url ?? '').hostname.replace(/\.$/, '').replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};

/**
 * May a contact on `emailDomain` be a fallback recipient for a site on `host`? Only the site's own host or a subdomain
 * of it. The other direction (a site on a subdomain of the contact's domain) is left out: without a public suffix list
 * it cannot tell `example.com` from `co.uk`, so such a contact needs an explicit grant (W6.1 F9).
 */
export function fallbackDomainOk(host: string, emailDomain: string): boolean {
  if (!host || !emailDomain || !host.includes('.')) return false;
  return emailDomain === host || emailDomain.endsWith(`.${host}`);
}

/**
 * The authorized recipients of a client email, computed here and never by the runner (SPEC 6.1a): contacts of the
 * project's client, not deleted, holding a ProjectContact grant on the project with role owner or member; when the
 * project has no grants at all, the client's contacts with can_initiate_work. A recipient whose email domain differs
 * from the site's is included only with an explicit grant; a site with no URL has no fallback recipients at all.
 */
export async function computeRecipients(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { client_id: true, site: { select: { url: true } } } });
  if (!project?.client_id) return [];
  const grants = await prisma.projectContact.findMany({
    where: { project_id: projectId },
    select: { role: true, contact: { select: { id: true, name: true, email: true, is_deleted: true, client_id: true } } },
  });
  const out: Array<{ contact_id: string; name: string | null; email: string; basis: 'grant' | 'client_fallback' }> = [];
  for (const g of grants) {
    const c = g.contact;
    if (c.is_deleted || c.client_id !== project.client_id) continue;
    if (g.role === 'owner' || g.role === 'member') out.push({ contact_id: c.id, name: c.name, email: c.email, basis: 'grant' });
  }
  if (grants.length === 0) {
    const host = siteDomain(project.site?.url ?? null);
    // A site with no usable address has no domain to check against: no fallback recipients (explicit grants only).
    if (!host) return out;
    const contacts = await prisma.clientContact.findMany({
      where: { client_id: project.client_id, is_deleted: false, can_initiate_work: true },
      select: { id: true, name: true, email: true },
      orderBy: { created_at: 'asc' },
    });
    for (const c of contacts) {
      const d = domainOf(c.email);
      if (!fallbackDomainOk(host, d)) continue; // other domain: explicit grant only
      out.push({ contact_id: c.id, name: c.name, email: c.email, basis: 'client_fallback' });
    }
  }
  return out;
}

/** Runner view of a design note: the designer shape plus the three fields the research and brief jobs need. */
export type RunnerStatement = ClientStatement & { superseded_by_id: string | null; reference_url: string | null; source_ref: string };

/**
 * Runner-only `client_statements` (SPEC 4.1, 6.2): the client's notes with status `active` or `superseded` (never
 * `withdrawn` or anything else). Order: `source_date` ascending, then `created_at`, then `id`. A superseded note is
 * placed under the note that replaced it by grouping on `superseded_by_id` (the replacing note's `id`); the order itself
 * is chronological and stable. The designer-facing `clientStatementsFor` is separate and stays active-only. Scoped like
 * it: the track's site and project, or notes recorded with no site or project (W6.2 F7).
 */
export async function runnerStatementsFor(projectId: string, siteId: string): Promise<RunnerStatement[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { client_id: true } });
  if (!project?.client_id) return [];
  const notes = await prisma.designNote.findMany({
    where: { client_id: project.client_id, status: { in: ['active', 'superseded'] }, ...statementScope(projectId, siteId) },
    orderBy: [{ source_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
  });
  return notes.map((n) => ({ ...statementView(n), superseded_by_id: n.superseded_by_id, reference_url: n.reference_url, source_ref: n.source_ref }));
}

/**
 * The BrandProfile of the project's client, or null. Returned: the design-language fields only (`voice_profile`,
 * `brand_tokens`, `figma_url`, `component_library_ref`). Left out: `id`, `client_id`, `site_id` (ids), `notes`
 * (internal), `is_deleted` and the timestamps. A soft-deleted profile counts as none. Only the client-owned profile is
 * read; a site-owned profile is not.
 */
export async function runnerBrandProfileFor(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { client_id: true } });
  if (!project?.client_id) return null;
  const b = await prisma.brandProfile.findFirst({ where: { client_id: project.client_id, is_deleted: false } });
  return b ? { voice_profile: b.voice_profile, brand_tokens: b.brand_tokens, figma_url: b.figma_url, component_library_ref: b.component_library_ref } : null;
}

/** The track row plus any of the requested includes. */
/** The name of the client that owns the track's project, else its site; null when neither has one. Runner view only. */
export async function clientNameFor(projectId: string, siteId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { client: { select: { name: true } } } });
  if (project?.client?.name) return project.client.name;
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { client: { select: { name: true } } } });
  return site?.client?.name ?? null;
}

export async function readTrack(trackId: string, includes: TrackInclude[]) {
  const track = await loadTrack(prisma, trackId);
  // client_name rides on the runner's track read only (never in trackView, which the claim and start routes share).
  const out: Record<string, unknown> = { track: { ...trackView(track), client_name: await clientNameFor(track.project_id, track.site_id) } };
  for (const inc of includes) {
    switch (inc) {
      case 'brief': {
        const b = track.brief_id ? await prisma.designBrief.findUnique({ where: { id: track.brief_id } }) : null;
        out.brief = b ? { id: b.id, version: b.version, status: b.status, body: b.body, published_at: b.published_at } : null;
        break;
      }
      case 'references':
        out.references = await prisma.designReference.findMany({ where: { track_id: trackId }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] });
        break;
      case 'direction': {
        const d = track.art_direction_id
          ? await prisma.designArtDirection.findUnique({ where: { id: track.art_direction_id } })
          : await prisma.designArtDirection.findFirst({ where: { track_id: trackId }, orderBy: { version: 'desc' } });
        out.direction = d ? { id: d.id, version: d.version, status: d.status, body: d.body, signed_at: d.signed_at } : null;
        break;
      }
      case 'client_statements':
        out.client_statements = await runnerStatementsFor(track.project_id, track.site_id);
        break;
      case 'brand_profile':
        out.brand_profile = await runnerBrandProfileFor(track.project_id);
        break;
      case 'pages':
        out.pages = await prisma.designPageReview.findMany({ where: { track_id: trackId }, orderBy: { page_path: 'asc' } });
        break;
      case 'imports':
        out.imports = await prisma.designImport.findMany({ where: { track_id: trackId }, orderBy: { created_at: 'asc' } });
        break;
      case 'recipients':
        out.recipients = await computeRecipients(track.project_id);
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// references
// ---------------------------------------------------------------------------------------------------------------

export interface ReferenceInput {
  source: 'bast_pick' | 'client_named' | 'indelible_site';
  url?: string;
  title: string;
  why_md?: string;
}

/**
 * Up to 20 Bast picks or client-named sites in one call. A URL already on the track is skipped (the partial unique
 * index is the backstop). Citadel queues one `capture` job per new reference with a URL.
 */
export async function addReferences(trackId: string, items: ReferenceInput[]) {
  return trackTx(async ({ tx }) => {
    await lockTrack(tx, trackId);
    const track = await loadTrack(tx, trackId);
    const last = await tx.designReference.aggregate({ where: { track_id: trackId }, _max: { sort_order: true } });
    let order = (last._max.sort_order ?? -1) + 1;
    const created = [];
    const skipped: string[] = [];
    for (const it of items) {
      if (it.url) {
        const dup = await tx.designReference.findFirst({ where: { track_id: trackId, url: it.url }, select: { id: true } });
        if (dup) { skipped.push(it.url); continue; }
      }
      const ref = await tx.designReference.create({
        data: {
          track_id: trackId, source: it.source, url: it.url ?? null, title: it.title, why_md: it.why_md ?? null,
          sort_order: order++, capture_status: it.url ? 'queued' : 'none',
        },
      });
      if (it.url) await queueJob(tx, track, 'capture', { payload: { reference_id: ref.id, url: it.url }, taskId: null });
      created.push(ref);
    }
    return { references: created, skipped };
  });
}

export interface CaptureResult {
  capture_status: 'captured' | 'failed' | 'blocked';
  capture_error?: string;
  desktop_fold_asset_id?: string;
  desktop_full_asset_id?: string;
  phone_fold_asset_id?: string;
  phone_full_asset_id?: string;
  extracted?: Prisma.InputJsonValue;
}

/** PATCH /runner/references/:id: the capture result. Asset ids must be assets of the reference's own track. */
export async function recordCapture(referenceId: string, input: CaptureResult) {
  const ref = await prisma.designReference.findUnique({ where: { id: referenceId } });
  if (!ref) throw new ApiError('Reference not found', 404, 'not_found');
  const assetIds = [input.desktop_fold_asset_id, input.desktop_full_asset_id, input.phone_fold_asset_id, input.phone_full_asset_id].filter((x): x is string => !!x);
  if (assetIds.length > 0) {
    const n = await prisma.designTrackAsset.count({ where: { id: { in: assetIds }, track_id: ref.track_id } });
    if (n !== new Set(assetIds).size) throw new ApiError('An asset id is not an asset of this track', 400, 'bad_asset');
  }
  if (input.extracted !== undefined && Buffer.byteLength(JSON.stringify(input.extracted), 'utf8') > 16 * 1024) {
    throw new ApiError('extracted is over 16 KB', 413, 'extracted_too_large');
  }
  return prisma.designReference.update({
    where: { id: referenceId },
    data: {
      capture_status: input.capture_status,
      capture_error: input.capture_status === 'captured' ? null : (input.capture_error ?? null),
      ...(input.desktop_fold_asset_id ? { desktop_fold_asset_id: input.desktop_fold_asset_id } : {}),
      ...(input.desktop_full_asset_id ? { desktop_full_asset_id: input.desktop_full_asset_id } : {}),
      ...(input.phone_fold_asset_id ? { phone_fold_asset_id: input.phone_fold_asset_id } : {}),
      ...(input.phone_full_asset_id ? { phone_full_asset_id: input.phone_full_asset_id } : {}),
      ...(input.extracted !== undefined ? { extracted: input.extracted } : {}),
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// briefs
// ---------------------------------------------------------------------------------------------------------------

/**
 * Publish a brief that passes the zod schema of SPEC 4.1: supersedes the previous version, points the track at it, and
 * (research stage) checks whether the track can enter art direction (the wireframe adopt may already be done).
 */
export async function publishBrief(trackId: string, input: { body: unknown; job_id?: string }, actorId: string) {
  const body = briefBodySchema.parse(input.body);
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BRIEF_BYTES) throw new ApiError('Brief is over 512 KB', 413, 'brief_too_large');
  return trackTx(async (scope) => {
    const { tx } = scope;
    await lockTrack(tx, trackId);
    const track = await loadTrack(tx, trackId);
    if (track.stage !== 'research' && track.stage !== 'art_direction') throw new ApiError(`A brief cannot be published in ${track.stage}`, 409, 'illegal_stage');
    if (input.job_id) {
      const job = await tx.designJob.findFirst({ where: { id: input.job_id, track_id: trackId, kind: 'brief' }, select: { id: true } });
      if (!job) throw new ApiError('job_id is not a brief job of this track', 400, 'bad_job');
    }
    const last = await tx.designBrief.aggregate({ where: { track_id: trackId }, _max: { version: true } });
    await tx.designBrief.updateMany({ where: { track_id: trackId, status: 'published' }, data: { status: 'superseded' } });
    const brief = await tx.designBrief.create({
      data: { track_id: trackId, version: (last._max.version ?? 0) + 1, status: 'published', body: body as Prisma.InputJsonValue, job_id: input.job_id ?? null, published_at: new Date() },
    });
    await tx.designTrack.update({ where: { id: trackId }, data: { brief_id: brief.id } });
    const entered = await maybeEnterArtDirection(scope, trackId, actorId);
    return { brief, entered_art_direction: entered };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// imports
// ---------------------------------------------------------------------------------------------------------------

export interface ImportInput {
  task_id: string;
  template_page_path: string;
  source_paths: string[];
  mapping_path?: string;
  expected_count: number;
  required_for_launch?: boolean;
}

/** Register a DesignImport from a `design-import` task of the track's own project; one per task. */
export async function registerImport(trackId: string, input: ImportInput) {
  const track = await loadTrack(prisma, trackId);
  const task = await prisma.task.findFirst({
    where: { id: input.task_id, project_id: track.project_id, is_deleted: false, tags: { has: 'design-import' } },
    select: { id: true },
  });
  if (!task) throw new ApiError('Task is not a design-import task of this project', 404, 'not_found');
  try {
    return await prisma.designImport.create({
      data: {
        track_id: trackId, task_id: task.id, template_page_path: input.template_page_path, source_paths: input.source_paths,
        mapping_path: input.mapping_path ?? null, expected_count: input.expected_count, required_for_launch: input.required_for_launch ?? true,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ApiError('This task already has an import', 409, 'import_exists');
    throw e;
  }
}
