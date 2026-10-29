/**
 * Designer Portal: asset storage (design 6 DesignAsset, 7.3 POST worker/sessions/:id/assets).
 * Bytes live in private storage under `portal-private/design/<session>/<asset>`; the row's storage_key is the
 * `design/<session>/<asset>` part the design names. PNG for images (magic bytes checked), text/plain for logs
 * and diffs. Caps: 4 MB per image, 1 MB per text, 200 assets per session per day.
 */
import crypto from 'crypto';
import type { DesignAsset, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { PRIVATE_PREFIX, getPrivateObject, putPrivateObject } from '@/lib/services/s3';
import { isUuid } from './helpers';

export const ASSET_KINDS = ['crop', 'before', 'after', 'gate_log', 'diff'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_ASSETS_PER_SESSION_PER_DAY = 200;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_KINDS: readonly string[] = ['gate_log', 'diff'];

export function isPng(buf: Buffer): boolean {
  return buf.length > PNG_MAGIC.length && buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

/** Decide the content type from the kind and the bytes; throws 400/413 on a bad file. */
export function validateAssetBytes(kind: string, buf: Buffer): 'image/png' | 'text/plain' {
  if (!(ASSET_KINDS as readonly string[]).includes(kind)) throw new ApiError('Unknown asset kind', 400, 'bad_kind');
  if (buf.length === 0) throw new ApiError('Empty file', 400, 'empty_file');
  if (TEXT_KINDS.includes(kind)) {
    if (buf.length > MAX_TEXT_BYTES) throw new ApiError('Text asset is over 1 MB', 413, 'asset_too_large');
    if (buf.includes(0)) throw new ApiError('Text asset must be plain text', 400, 'bad_content');
    return 'text/plain';
  }
  if (buf.length > MAX_IMAGE_BYTES) throw new ApiError('Image is over 4 MB', 413, 'asset_too_large');
  if (!isPng(buf)) throw new ApiError('Images must be PNG', 400, 'not_png');
  return 'image/png';
}

export function storageKeyFor(sessionId: string, assetId: string): string {
  return `design/${sessionId}/${assetId}`;
}

export interface StoreDeps {
  put?: (key: string, body: Buffer, type: string) => Promise<void>;
  get?: (key: string) => Promise<Buffer>;
}

export async function storeAsset(
  input: { sessionId: string; kind: string; bytes: Buffer; width?: number | null },
  db: PrismaClient = defaultDb,
  deps: StoreDeps = {},
): Promise<DesignAsset> {
  if (!isUuid(input.sessionId)) throw new ApiError('Session not found', 404, 'not_found');
  const contentType = validateAssetBytes(input.kind, input.bytes);
  const width = input.width ?? null;
  if (width !== null && (!Number.isInteger(width) || width < 1 || width > 10000)) throw new ApiError('Bad width', 400, 'bad_width');
  const session = await db.designSession.findUnique({ where: { id: input.sessionId }, select: { id: true } });
  if (!session) throw new ApiError('Session not found', 404, 'not_found');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.designAsset.count({ where: { session_id: input.sessionId, created_at: { gte: since } } });
  if (recent >= MAX_ASSETS_PER_SESSION_PER_DAY) throw new ApiError('Too many assets for this session today', 429, 'asset_quota');
  const id = crypto.randomUUID();
  const key = storageKeyFor(input.sessionId, id);
  await (deps.put ?? putPrivateObject)(PRIVATE_PREFIX + key, input.bytes, contentType);
  return db.designAsset.create({
    data: { id, session_id: input.sessionId, kind: input.kind, content_type: contentType, bytes: input.bytes.length, width, storage_key: key },
  });
}

/** Load an asset's bytes, only if it belongs to the session. */
export async function readAsset(
  sessionId: string,
  assetId: string,
  db: Pick<PrismaClient, 'designAsset'> = defaultDb,
  deps: StoreDeps = {},
): Promise<{ asset: DesignAsset; bytes: Buffer }> {
  if (!isUuid(sessionId) || !isUuid(assetId)) throw new ApiError('Asset not found', 404, 'not_found');
  const asset = await db.designAsset.findFirst({ where: { id: assetId, session_id: sessionId } });
  if (!asset) throw new ApiError('Asset not found', 404, 'not_found');
  const bytes = await (deps.get ?? getPrivateObject)(PRIVATE_PREFIX + asset.storage_key);
  return { asset, bytes };
}

/** True when every id is an asset of the session. */
export async function assetsBelongToSession(sessionId: string, ids: string[], db: Pick<PrismaClient, 'designAsset'> = defaultDb): Promise<boolean> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return true;
  if (!uniq.every(isUuid)) return false;
  return (await db.designAsset.count({ where: { session_id: sessionId, id: { in: uniq } } })) === uniq.length;
}
