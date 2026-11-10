/**
 * Designer Portal v2: track assets, the storage, upload validation and serving rules of SPEC 3.3.
 *
 * - The type of every file comes from its BYTES (`sniffFile`, `pdfHasActiveContent`, `sanitizeFilename`, `serveHeaders`
 *   from lib/services/uploads.ts are reused); the declared name and content type are ignored.
 * - Designer uploads, by purpose: `board` PNG JPEG WebP GIF and PDF without active content; `image` PNG JPEG WebP;
 *   `decor` PNG WebP and SVG. 25 MB, 1 MB for an SVG. SVG goes through a first filter for `decor` only; the real
 *   sanitiser runs on the box. Originals start `pending` and a `process_upload` job is queued.
 * - Serving to a browser: only the image kinds, plus raster upload originals. PDF and SVG originals and job logs are
 *   never served by any Citadel route. Rasters carry `nosniff` and the sandbox CSP (`serveHeaders`).
 * - `storage_key` never leaves the server.
 */
import crypto from 'crypto';
import type { DesignTrackAsset } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { PRIVATE_PREFIX, getPrivateObject, putPrivateObject } from '@/lib/services/s3';
import { pdfHasActiveContent, sanitizeFilename, serveHeaders, sha256, sniffFile } from '@/lib/services/uploads';
import { isUuid } from './helpers';
import { loadTrack, lockTrack, queueJob, trackTx } from './track-core';

export const UPLOAD_PURPOSES = ['board', 'image', 'decor'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_SVG_BYTES = 1024 * 1024;
/** A declared content-length above the cap plus this slack is refused (413) before the body is read. */
export const UPLOAD_BODY_SLACK = 64 * 1024;
export const MAX_UPLOADS_PER_TRACK = 100;
export const MAX_UPLOAD_BYTES_PER_TRACK = 1024 * 1024 * 1024;
export const MAX_UPLOADS_PER_MINUTE = 20;
export const MAX_RUNNER_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_RUNNER_LOG_BYTES = 1024 * 1024;

export const RUNNER_ASSET_KINDS = ['ref_fold', 'ref_full', 'brief_image', 'render', 'spot_shot', 'job_log'] as const;
export type RunnerAssetKind = (typeof RUNNER_ASSET_KINDS)[number];

/** Content types a browser may be served (raster images only). */
export const SERVABLE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Kinds a browser may be served, subject to the content type check above (an `upload` also needs a raster type). */
export const SERVABLE_KINDS: readonly string[] = ['ref_fold', 'ref_full', 'brief_image', 'render', 'approval_shot', 'spot_shot', 'upload'];

const ALLOWED: Record<UploadPurpose, readonly string[]> = {
  board: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
  image: ['image/png', 'image/jpeg', 'image/webp'],
  decor: ['image/png', 'image/webp'],
};

export interface StoreDeps {
  put?: (key: string, body: Buffer, type: string) => Promise<void>;
  get?: (key: string) => Promise<Buffer>;
}

export const trackStorageKey = (trackId: string, assetId: string): string => `design/tracks/${trackId}/${assetId}`;

// ---------------------------------------------------------------------------------------------------------
// SVG first filter (decor only). A first filter, not the control: the sanitiser on the box is the control.
// ---------------------------------------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { colon: ':', tab: '', newline: '', nbsp: ' ' };

/** Decode character references so `jav&#x61;script:` and `&colon;` cannot hide a token from the checks. */
function decodeReferences(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d{1,7});?/g, (_m, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => (n.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[n.toLowerCase()] : m));
}
function safeChar(code: number): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** Why this SVG is refused, or null when it passes the first filter. */
export function svgFirstFilter(buf: Buffer): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return 'The SVG is not valid UTF-8 text.';
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('\u0000')) return 'The SVG is not plain text.';
  // The root element must be svg: skip an XML declaration, comments and whitespace before it.
  const head = text.replace(/^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*/i, '');
  if (!/^<svg(?=[\s/>])/.test(head)) return 'The root element must be svg.';
  for (const variant of [text, decodeReferences(text)]) {
    if (/<!DOCTYPE/i.test(variant)) return 'SVG with a DOCTYPE is not accepted.';
    if (/<!ENTITY/i.test(variant)) return 'SVG with an entity is not accepted.';
    if (/<\s*script/i.test(variant)) return 'SVG with a script is not accepted.';
    if (/foreignObject/i.test(variant)) return 'SVG with foreignObject is not accepted.';
    if (/[\s"'/]on[\w:.-]*\s*=/i.test(variant)) return 'SVG with an event attribute is not accepted.';
    if (/javascript\s*:/i.test(variant)) return 'SVG with a javascript: link is not accepted.';
    const hrefs = variant.matchAll(/(?:^|[\s"'/:])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
    for (const m of hrefs) {
      const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!value.startsWith('#')) return 'SVG links may only point inside the file (#fragment).';
    }
  }
  return null;
}

/** True when the bytes begin like markup (after a BOM and whitespace): the `decor` SVG path runs before sniffing. */
function looksLikeMarkup(buf: Buffer): boolean {
  const head = buf.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  return head.startsWith('<');
}

// ---------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------

export interface ValidatedUpload {
  content_type: string;
  ext: string;
  filename: string;
  bytes: number;
  sha256: string;
  format: 'raster' | 'pdf' | 'svg';
}

/** Designer upload validation by purpose (SPEC 3.3). Throws 400/413 ApiErrors; never trusts the name or declared type. */
export function validateDesignerUpload(purpose: UploadPurpose, buf: Buffer, declaredName: string): ValidatedUpload {
  if (buf.length === 0) throw new ApiError('That file is empty', 400, 'empty_file');
  if (purpose === 'decor' && looksLikeMarkup(buf)) {
    if (buf.length > MAX_SVG_BYTES) throw new ApiError('An SVG is at most 1 MB', 413, 'asset_too_large');
    const why = svgFirstFilter(buf);
    if (why) throw new ApiError(why, 400, 'bad_svg');
    return { content_type: 'image/svg+xml', ext: 'svg', filename: sanitizeFilename(declaredName, 'svg'), bytes: buf.length, sha256: sha256(buf), format: 'svg' };
  }
  if (buf.length > MAX_UPLOAD_BYTES) throw new ApiError('That file is over 25 MB', 413, 'asset_too_large');
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-' && pdfHasActiveContent(buf)) {
    throw new ApiError('That PDF contains active content and is not accepted', 400, 'active_content');
  }
  const sniffed = sniffFile(buf, declaredName);
  if (!sniffed.ok) throw new ApiError(sniffed.reason, 400, 'bad_type');
  const t = sniffed.type;
  if (!ALLOWED[purpose].includes(t.content_type)) {
    throw new ApiError(`A ${t.ext.toUpperCase()} file is not accepted for ${purpose}`, 400, 'bad_type');
  }
  return {
    content_type: t.content_type, ext: t.ext, filename: sanitizeFilename(declaredName, t.ext), bytes: buf.length, sha256: sha256(buf),
    format: t.content_type === 'application/pdf' ? 'pdf' : 'raster',
  };
}

/** Width and height of a PNG or WebP from its header, else null (the runner re-encodes everything it uploads). */
export function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && buf[20] === 0x2f) {
      const b = buf.subarray(21, 25);
      return { width: 1 + (b[0] | ((b[1] & 0x3f) << 8)), height: 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10)) };
    }
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

export interface ValidatedRunnerAsset {
  content_type: string;
  filename: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
}

/** Runner uploads (SPEC 3.3): PNG or WebP at most 20 MB (already re-encoded), or `job_log` text at most 1 MB. */
export function validateRunnerAsset(kind: RunnerAssetKind, buf: Buffer, declaredName: string): ValidatedRunnerAsset {
  if (buf.length === 0) throw new ApiError('That file is empty', 400, 'empty_file');
  if (kind === 'job_log') {
    if (buf.length > MAX_RUNNER_LOG_BYTES) throw new ApiError('A job log is at most 1 MB', 413, 'asset_too_large');
    if (buf.includes(0)) throw new ApiError('A job log must be plain text', 400, 'bad_content');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      throw new ApiError('A job log must be UTF-8 text', 400, 'bad_content');
    }
    return { content_type: 'text/plain', filename: sanitizeFilename(declaredName, 'txt'), bytes: buf.length, sha256: sha256(buf), width: null, height: null };
  }
  if (buf.length > MAX_RUNNER_IMAGE_BYTES) throw new ApiError('An image is at most 20 MB', 413, 'asset_too_large');
  const sniffed = sniffFile(buf, declaredName);
  if (!sniffed.ok) throw new ApiError(sniffed.reason, 400, 'bad_type');
  if (sniffed.type.content_type !== 'image/png' && sniffed.type.content_type !== 'image/webp') {
    throw new ApiError('Runner images must be PNG or WebP', 400, 'bad_type');
  }
  const dims = imageDimensions(buf);
  return {
    content_type: sniffed.type.content_type, filename: sanitizeFilename(declaredName, sniffed.type.ext), bytes: buf.length,
    sha256: sha256(buf), width: dims?.width ?? null, height: dims?.height ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------------------------------------

type AssetFacts = Pick<DesignTrackAsset, 'kind' | 'content_type' | 'status'>;

/** May any Citadel designer route serve this asset's bytes to a browser? PDF and SVG originals and job logs never. */
export function isBrowserServable(a: AssetFacts): boolean {
  if (!SERVABLE_KINDS.includes(a.kind)) return false;
  if (!SERVABLE_IMAGE_TYPES.includes(a.content_type.toLowerCase())) return false;
  if (a.status === 'rejected') return false;
  return true;
}

/** The designer projection of a track asset (SPEC 3.5): no storage key, no hash, no creator. */
export function trackAssetView(a: DesignTrackAsset, sessionId: string) {
  return {
    id: a.id, kind: a.kind, content_type: a.content_type, width: a.width, height: a.height, page: a.page, page_path: a.page_path,
    viewport_w: a.viewport_w, status: a.status, reject_reason: a.reject_reason,
    url: isBrowserServable(a) ? `/api/design/sessions/${sessionId}/track-assets/${a.id}` : null,
  };
}

/** What the runner is told about an asset it stored (no storage key). */
export const runnerAssetView = (a: DesignTrackAsset) => ({
  id: a.id, track_id: a.track_id, kind: a.kind, parent_asset_id: a.parent_asset_id, purpose: a.purpose, status: a.status,
  content_type: a.content_type, bytes: a.bytes, sha256: a.sha256, width: a.width, height: a.height, page: a.page,
  page_path: a.page_path, viewport_w: a.viewport_w,
});

/** The reasons the runner may give when it rejects an upload. Mirrors REJECT_MESSAGES in design-track/upload_handler.py. */
export const UPLOAD_REJECT_CODES = [
  'too_many_pixels', 'not_an_image', 'type_not_allowed', 'pdf_failed', 'svg_refused', 'svg_failed', 'timeout', 'too_large', 'processing_failed',
] as const;
export type UploadRejectCode = (typeof UPLOAD_REJECT_CODES)[number];

/** A plain sentence for a designer, per reject code (the board shows it). */
export const UPLOAD_REJECT_SENTENCES: Record<UploadRejectCode, string> = {
  too_many_pixels: 'This image is bigger than we can handle. Please make it smaller and upload it again.',
  not_an_image: 'We could not read this file as an image or a PDF.',
  type_not_allowed: 'We do not accept this kind of file here.',
  pdf_failed: 'We could not turn this PDF into pictures.',
  svg_refused: 'We could not accept this SVG because it holds things an upload may not, such as scripts, links or other files.',
  svg_failed: 'We could not draw this SVG.',
  timeout: 'This file took too long to open.',
  too_large: 'This file, or the picture made from it, is too large.',
  processing_failed: 'We could not open this file.',
};

/**
 * The runner rejects a pending upload (SPEC 6.1a): one conditional update, so two concurrent calls cannot both write.
 * pending becomes rejected with the reason; already rejected is returned unchanged (the stored reason stays); ready is
 * 409 already_ready; a non-upload is 409 not_upload; an asset of another track is 404.
 */
export async function rejectUpload(trackId: string, assetId: string, reason: UploadRejectCode): Promise<DesignTrackAsset> {
  if (!isUuid(trackId) || !isUuid(assetId)) throw notFound();
  const asset = await prisma.designTrackAsset.findFirst({ where: { id: assetId, track_id: trackId } });
  if (!asset) throw notFound();
  if (asset.kind !== 'upload') throw new ApiError('Only an upload can be rejected', 409, 'not_upload');
  const done = await prisma.designTrackAsset.updateMany({
    where: { id: assetId, track_id: trackId, kind: 'upload', status: 'pending' },
    data: { status: 'rejected', reject_reason: reason },
  });
  const now = await prisma.designTrackAsset.findFirst({ where: { id: assetId, track_id: trackId } });
  if (!now) throw notFound();
  if (done.count === 1 || now.status === 'rejected') return now;
  throw new ApiError('That upload is already ready', 409, 'already_ready');
}

// ---------------------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------------------

/**
 * Store a designer upload: limits checked under the track's lock (100 per track, 1 GB per track, 20 a minute), the
 * original stored `pending`, a `process_upload` job queued, all in one transaction.
 */
export async function storeDesignerUpload(
  input: { trackId: string; userId: string; purpose: UploadPurpose; name: string; bytes: Buffer },
  deps: StoreDeps = {},
): Promise<DesignTrackAsset> {
  const v = validateDesignerUpload(input.purpose, input.bytes, input.name);
  return trackTx(async ({ tx }) => {
    await lockTrack(tx, input.trackId);
    const track = await loadTrack(tx, input.trackId);
    const used = await tx.designTrackAsset.aggregate({ where: { track_id: track.id, kind: 'upload', source: 'designer' }, _count: { _all: true }, _sum: { bytes: true } });
    if (used._count._all >= MAX_UPLOADS_PER_TRACK) throw new ApiError('This track already has 100 uploads', 409, 'upload_limit');
    if ((used._sum.bytes ?? 0) + v.bytes > MAX_UPLOAD_BYTES_PER_TRACK) throw new ApiError('This track is over its 1 GB of uploads', 409, 'upload_bytes_limit');
    const recent = await tx.designTrackAsset.count({ where: { track_id: track.id, kind: 'upload', source: 'designer', created_at: { gt: new Date(Date.now() - 60_000) } } });
    if (recent >= MAX_UPLOADS_PER_MINUTE) throw new ApiError('At most 20 uploads a minute; wait a moment and try again', 429, 'rate_limited', 'uploads_per_minute');
    const id = crypto.randomUUID();
    const key = trackStorageKey(track.id, id);
    await (deps.put ?? putPrivateObject)(PRIVATE_PREFIX + key, input.bytes, v.content_type);
    const asset = await tx.designTrackAsset.create({
      data: {
        id, track_id: track.id, kind: 'upload', purpose: input.purpose, status: 'pending', content_type: v.content_type, bytes: v.bytes,
        sha256: v.sha256, original_name: v.filename, storage_key: key, source: 'designer', created_by_id: input.userId,
      },
    });
    await queueJob(tx, track, 'process_upload', { payload: { asset_id: id, purpose: input.purpose, content_type: v.content_type }, taskId: null });
    return asset;
  });
}

export interface RunnerAssetInput {
  trackId: string;
  userId: string;
  kind: RunnerAssetKind;
  name: string;
  bytes: Buffer;
  parentAssetId?: string | null;
  page?: number | null;
  pagePath?: string | null;
  viewportW?: number | null;
}

/** Store a runner asset (capture, render, brief image, spot shot or job log). A render marks its pending upload ready. */
export async function storeRunnerAsset(input: RunnerAssetInput, deps: StoreDeps = {}): Promise<DesignTrackAsset> {
  const v = validateRunnerAsset(input.kind, input.bytes, input.name);
  return trackTx(async ({ tx }) => {
    await lockTrack(tx, input.trackId);
    const track = await loadTrack(tx, input.trackId);
    let parentId: string | null = null;
    if (input.kind === 'render') {
      if (!input.parentAssetId || !isUuid(input.parentAssetId)) throw new ApiError('A render needs the upload it came from (parent_asset_id)', 400, 'bad_parent');
      const parent = await tx.designTrackAsset.findFirst({ where: { id: input.parentAssetId, track_id: track.id, kind: 'upload' }, select: { id: true } });
      if (!parent) throw new ApiError('parent_asset_id is not an upload of this track', 400, 'bad_parent');
      parentId = parent.id;
    }
    const id = crypto.randomUUID();
    const key = trackStorageKey(track.id, id);
    await (deps.put ?? putPrivateObject)(PRIVATE_PREFIX + key, input.bytes, v.content_type);
    const asset = await tx.designTrackAsset.create({
      data: {
        id, track_id: track.id, kind: input.kind, parent_asset_id: parentId, status: 'ready', content_type: v.content_type, bytes: v.bytes,
        sha256: v.sha256, width: v.width, height: v.height, page: input.page ?? null, page_path: input.pagePath ?? null,
        viewport_w: input.viewportW ?? null, original_name: v.filename, storage_key: key, source: 'runner', created_by_id: input.userId,
      },
    });
    if (parentId) await tx.designTrackAsset.updateMany({ where: { id: parentId, status: 'pending' }, data: { status: 'ready' } });
    return asset;
  });
}

// ---------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------

const notFound = () => new ApiError('Asset not found', 404, 'not_found');

async function loadBytes(asset: DesignTrackAsset, deps: StoreDeps): Promise<Buffer> {
  try {
    return await (deps.get ?? getPrivateObject)(PRIVATE_PREFIX + asset.storage_key);
  } catch {
    throw notFound();
  }
}

/** A track asset a browser may be served, with its bytes and headers; 404 for anything else (never a 403). */
export async function readServableAsset(trackId: string, assetId: string, deps: StoreDeps = {}): Promise<{ bytes: Buffer; headers: Record<string, string> }> {
  if (!isUuid(trackId) || !isUuid(assetId)) throw notFound();
  const asset = await prisma.designTrackAsset.findFirst({ where: { id: assetId, track_id: trackId } });
  if (!asset || !isBrowserServable(asset)) throw notFound();
  const bytes = await loadBytes(asset, deps);
  const headers = serveHeaders({ content_type: asset.content_type, filename: asset.original_name ?? `asset.${asset.content_type.split('/')[1] ?? 'bin'}`, size_bytes: bytes.length });
  return { bytes, headers };
}

/** The machine read: any asset of the track as application/octet-stream (the runner and the daemon). */
export async function readAssetForMachine(trackId: string, assetId: string, deps: StoreDeps = {}): Promise<{ bytes: Buffer; headers: Record<string, string> }> {
  if (!isUuid(trackId) || !isUuid(assetId)) throw notFound();
  const asset = await prisma.designTrackAsset.findFirst({ where: { id: assetId, track_id: trackId } });
  if (!asset) throw notFound();
  const bytes = await loadBytes(asset, deps);
  return {
    bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'attachment; filename="asset.bin"',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Design-Asset-Kind': asset.kind,
      'X-Design-Asset-Type': asset.content_type,
    },
  };
}
