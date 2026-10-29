/**
 * Designer Portal D11: Drive folder ids and the session's `client_files` listing.
 * Route-free helpers shared by the admin folder routes and Apply.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';

/** Drive ids are 20 to 100 characters of letters, digits, underscore and hyphen. */
export const DRIVE_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;
export const driveFolderBodySchema = z
  .object({
    drive_folder_id: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().regex(DRIVE_ID_RE, 'Not a Drive folder id').nullable()),
  })
  .strict();

/** Ids in the newest `client_files` event of the session (payload `{folder_id, items:[{id,...}]}`), or null before any listing. */
export async function latestClientFileIds(sessionId: string, db: Pick<PrismaClient, 'designEvent'> = defaultDb): Promise<Set<string> | null> {
  const ev = await db.designEvent.findFirst({ where: { session_id: sessionId, kind: 'client_files' }, orderBy: { seq: 'desc' }, select: { payload: true } });
  if (!ev) return null;
  const items = (ev.payload as { items?: unknown } | null)?.items;
  const ids = new Set<string>();
  if (Array.isArray(items)) for (const it of items) if (it && typeof (it as { id?: unknown }).id === 'string') ids.add((it as { id: string }).id);
  return ids;
}
