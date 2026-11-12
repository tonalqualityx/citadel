/**
 * Designer Portal v2 e2e fixture (W4.6): what the Brief, Board and Direction specs add on top of the v1 world.
 *
 * Everything is tagged through the v1 world (same client, sites, projects, designers), so `teardownWorld` removes it in
 * the order SPEC 3.2 gives: the v2 rows hang off the tracks of the world's sites, and the notes off its client.
 * No product code is imported except the public API; rows are written with Prisma the way a daemon or the runner
 * would leave them (a tracked task, an open track, a published brief, references, notes, a draft direction).
 */
import crypto from 'node:crypto';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { TINY_PNG, type DesignWorld, type Task } from './design-portal-fixture';
import { BASE_URL, routePreview } from './design-helpers';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export interface V2Track {
  trackId: string;
  slug: string;
  /** The designer stage task (tag design-stage:art_direction) a designer opens the track from. */
  artTask: Task;
}

/** A tracked task on project A plus an open track on site A (stage art_direction by default). */
export async function seedV2Track(world: DesignWorld, opts: { stage?: 'research' | 'art_direction' | 'refine' | 'review' } = {}): Promise<V2Track> {
  const { prisma, tag } = world;
  const art = await prisma.task.create({
    data: {
      title: `Direct the look ${tag}`, client_id: world.clientId, project_id: world.projectA.id, site_id: world.siteA.id,
      status: 'not_started', tags: ['design-stage:art_direction'],
    },
  });
  const slug = Array.from(crypto.randomBytes(16), (b) => B32[b % 32]).join('');
  const track = await prisma.designTrack.create({
    data: {
      site_id: world.siteA.id, project_id: world.projectA.id, round: 1, slug, stage: opts.stage ?? 'art_direction',
      branch: `design/t-${slug}`, preview_alias: `design-t-${slug}`,
    },
  });
  return { trackId: track.id, slug, artTask: { id: art.id, title: art.title } };
}

/** A design note of the world's client (what the client said). `require` and `avoid` ones must be answered before sign-off. */
export async function seedNote(
  world: DesignWorld,
  n: { key: string; quote: string; polarity: 'require' | 'avoid' | 'like' | 'dislike' | 'idea' | 'neutral'; subject?: string; paraphrase?: boolean },
): Promise<string> {
  const row = await world.prisma.designNote.create({
    data: {
      client_id: world.clientId, project_id: world.projectA.id, site_id: world.siteA.id, source_kind: 'meeting',
      source_ref: `dpe2e-${world.tag}-${n.key}`, source_date: new Date('2026-10-14T15:00:00Z'), speaker_name: 'Pat Client', speaker_role: 'client',
      quote: n.quote, quote_sha: crypto.createHash('sha256').update(n.quote).digest('hex'), is_paraphrase: n.paraphrase ?? false,
      category: 'layout', polarity: n.polarity, subject: n.subject ?? 'photos', confidence: 0.9, extracted_by: 'dpe2e',
    },
  });
  return row.id;
}

export interface BriefCardSeed {
  id: string; headline: string; summary: string; detail_md?: string; confidence?: 'confirmed' | 'evidenced' | 'inferred';
  sources?: Array<Record<string, unknown>>;
}

/** A published brief on the track (what the brief job leaves). Returns the brief id. */
export async function seedBrief(
  world: DesignWorld, trackId: string, sections: Array<{ id: string; title: string; cards: BriefCardSeed[] }>, oneLine = 'A plain, sturdy site for people who work with their hands.',
): Promise<string> {
  const body = {
    version: 1, client: `DPE2E ${world.tag} Co`, one_line: oneLine,
    sections: sections.map((s) => ({
      ...s,
      cards: s.cards.map((c) => ({ image_asset_ids: [], detail_md: '', sources: [], confidence: 'evidenced', ...c })),
    })),
  };
  const brief = await world.prisma.designBrief.create({ data: { track_id: trackId, version: 1, status: 'published', body: body as never, published_at: new Date() } });
  await world.prisma.designTrack.update({ where: { id: trackId }, data: { brief_id: brief.id } });
  return brief.id;
}

/** A draft art direction (version 1) on the track, written the way the design worker leaves one. */
export async function seedDirection(world: DesignWorld, trackId: string, body: Record<string, unknown>): Promise<{ id: string; revision: string }> {
  const row = await world.prisma.designArtDirection.create({ data: { track_id: trackId, version: 1, status: 'draft', body: body as never, drafted_by: 'worker' } });
  return { id: row.id, revision: row.updated_at.toISOString() };
}

/** The revision token of the track's open draft (an opaque string the routes compare for equality). */
export async function draftRevision(world: DesignWorld, trackId: string): Promise<{ version: number; revision: string }> {
  const d = await world.prisma.designArtDirection.findFirstOrThrow({ where: { track_id: trackId, status: 'draft' } });
  return { version: d.version, revision: d.updated_at.toISOString() };
}

/**
 * Puts one real PNG into the (fake) object store through the real upload route as the designer, then promotes the row to a
 * captured reference shot (kind ref_fold, ready), the way the runner leaves one after a `capture` job. Returns the asset id.
 */
export async function seedCapturedShot(world: DesignWorld, designerRequest: APIRequestContext, sessionId: string, trackId: string): Promise<string> {
  const res = await designerRequest.post(`/api/design/sessions/${sessionId}/uploads`, {
    multipart: { file: { name: 'shot.png', mimeType: 'image/png', buffer: TINY_PNG }, purpose: 'board' },
  });
  expect(res.status(), 'the designer upload that stands in for a capture').toBe(201);
  const { asset } = (await res.json()) as { asset: { id: string } };
  await world.prisma.designTrackAsset.update({ where: { id: asset.id }, data: { kind: 'ref_fold', purpose: null, status: 'ready', source: 'runner', viewport_w: 1280 } });
  void trackId;
  return asset.id;
}

export interface ReferenceSeed {
  title: string; source?: 'bast_pick' | 'client_named' | 'indelible_site'; url?: string | null; why_md?: string;
  desktopFoldAssetId?: string | null; sort_order: number;
}

export async function seedReference(world: DesignWorld, trackId: string, r: ReferenceSeed): Promise<string> {
  const row = await world.prisma.designReference.create({
    data: {
      track_id: trackId, source: r.source ?? 'bast_pick', url: r.url ?? null, title: r.title, why_md: r.why_md ?? null,
      capture_status: r.desktopFoldAssetId ? 'captured' : 'none', desktop_fold_asset_id: r.desktopFoldAssetId ?? null, sort_order: r.sort_order,
    },
  });
  return row.id;
}

/** The sendgrid integration must be absent or off in the e2e database: mail then never leaves the machine. */
export async function assertNoRealMail(world: DesignWorld): Promise<void> {
  const sendgrid = await world.prisma.integration.findUnique({ where: { provider: 'sendgrid' } });
  if (sendgrid?.is_active) throw new Error('The e2e database has an active sendgrid integration: refusing to run a spec that triggers mail');
}

declare global {
  interface Window {
    __dpMessages?: Array<{ origin: string; data: unknown }>;
  }
}

/**
 * A context for the designer: the fake preview host, an init script that records every message the preview frame
 * receives (the fixture preview page does not record on its own), and optionally the clipboard.
 */
export async function newV2Context(browser: Browser, storageState: string, previewPort: number, opts: { clipboard?: boolean } = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState, ...(opts.clipboard ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  await routePreview(context, previewPort);
  await context.addInitScript(() => {
    if (!/\.dpe2e\.pages\.dev$/.test(location.hostname)) return;
    window.__dpMessages = [];
    window.addEventListener('message', (e) => { window.__dpMessages?.push({ origin: e.origin, data: e.data }); });
  });
  return context;
}

/** The messages the preview frame has received so far. */
export async function previewMessages(page: Page): Promise<Array<{ origin: string; data: unknown }>> {
  const frame = page.frames().find((f) => /\.dpe2e\.pages\.dev$/.test(new URL(f.url() || 'about:blank').hostname));
  if (!frame) return [];
  return frame.evaluate(() => window.__dpMessages ?? []);
}

/** The tab (Brief, Board, Direction) of the workspace dock, opened. The dock may be collapsed to its pill first. */
export async function openDockTab(page: Page, name: 'Brief' | 'Board' | 'Direction'): Promise<void> {
  const pill = page.getByTestId('chat-pill');
  if (await pill.isVisible()) await pill.click();
  await expect(page.getByTestId('chat-dock')).toBeVisible();
  await page.getByRole('tab', { name }).click();
}
