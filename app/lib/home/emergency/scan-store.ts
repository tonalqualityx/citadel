/**
 * Home screen Slice 6c: the database side of the outside scan.
 *
 * Writes only the owner's home_emergency_watch rows (the request marks and the result) and, for a site that answered
 * again, one keeper line in home_actions. It never writes a Task, EmailAsk, Site or Client row and never requests any
 * site: it hands the machine a host (from a Site record of an active client) and stores what the machine reports.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { appendHomeAction, type HomeDb } from '../state';
import { hasSecurityTag } from '../rules';
import { parseSiteItemKey, siteHostOf, siteItemKey, type SiteHost } from './site';
import {
  neutraliseSummary,
  outsideCheckHandledLine,
  SCAN_ACTION,
  SCAN_AFTER_CLOSE_MS,
  SCAN_ANSWER_WINDOW_MS,
  SCAN_REPEAT_MS,
  selectScans,
  type PlannedScan,
  type ScanBody,
  type ScanCandidate,
} from './scan';

export interface WireScan {
  key: string;
  host: string;
  /** The last stored scan_json of the same site, or null the first time. */
  previous: Record<string, unknown> | null;
}

/** The owner's switch. A missing row means off. */
export async function loadOutsideScan(db: HomeDb, ownerId: string): Promise<boolean> {
  const row = await db.homeKeeperSettings.findUnique({ where: { user_id: ownerId }, select: { outside_scan: true } });
  return row?.outside_scan === true;
}

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Everything that could be scanned now, before the 6-hour, noise and count rules. Reads only. */
async function loadCandidates(db: HomeDb, ownerId: string, itemKeys: readonly string[], now: Date): Promise<ScanCandidate[]> {
  const out: ScanCandidate[] = [];

  // A site that answers again: its incident closed a moment ago, and its row was on the screen until then.
  const closed = await db.homeSiteIncident.findMany({
    where: {
      user_id: ownerId,
      close_reason: { in: ['answered', 'watchdog_closed'] },
      closed_at: { gte: new Date(now.getTime() - SCAN_AFTER_CLOSE_MS) },
    },
    select: { site_id: true, closed_at: true },
    orderBy: { closed_at: 'desc' },
    take: 50,
  });
  if (closed.length > 0) {
    const rows = await db.homeEmergencyWatch.findMany({
      where: { user_id: ownerId, item_key: { in: closed.map((c) => siteItemKey(c.site_id)) } },
    });
    const byKey = new Map(rows.map((r) => [r.item_key, r]));
    for (const c of closed) {
      if (!c.closed_at) continue;
      const row = byKey.get(siteItemKey(c.site_id));
      if (!row || !row.cleared_at) continue; // never on the screen, or on it again now
      if (row.first_seen_at.getTime() > c.closed_at.getTime()) continue;
      if (row.cleared_at.getTime() < c.closed_at.getTime() - 60_000) continue; // it left the screen for another reason
      if (row.scan_requested_at && row.scan_requested_at.getTime() >= c.closed_at.getTime()) continue; // already handed out for this close
      out.push({ key: row.item_key, site_id: c.site_id, reason: 'answers_again', since: c.closed_at });
    }
  }

  // A security task that has a site, while it is in Needs you now, once per landing.
  const taskIds = itemKeys.filter((k) => k.startsWith('task:')).map((k) => k.slice(5));
  if (taskIds.length > 0) {
    const tasks = await db.task.findMany({
      where: { id: { in: taskIds }, site_id: { not: null }, is_deleted: false },
      select: { id: true, site_id: true, tags: true },
    });
    const secure = tasks.filter((t) => t.site_id && hasSecurityTag(t.tags));
    if (secure.length > 0) {
      const rows = await db.homeEmergencyWatch.findMany({
        where: { user_id: ownerId, cleared_at: null, item_key: { in: secure.map((t) => `task:${t.id}`) } },
      });
      const byKey = new Map(rows.map((r) => [r.item_key, r]));
      for (const t of secure) {
        const row = byKey.get(`task:${t.id}`);
        if (!row) continue;
        if (row.scan_requested_at && row.scan_requested_at.getTime() >= row.first_seen_at.getTime()) continue;
        out.push({ key: row.item_key, site_id: t.site_id as string, reason: 'security_task', since: row.first_seen_at });
      }
    }
  }
  return out;
}

async function loadLastRequested(db: HomeDb, ownerId: string, siteIds: readonly string[], now: Date): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (siteIds.length === 0) return map;
  const rows = await db.homeEmergencyWatch.findMany({
    where: { user_id: ownerId, scan_site_id: { in: [...siteIds] }, scan_requested_at: { gte: new Date(now.getTime() - SCAN_REPEAT_MS) } },
    select: { scan_site_id: true, scan_requested_at: true },
  });
  for (const r of rows) {
    if (!r.scan_site_id || !r.scan_requested_at) continue;
    const cur = map.get(r.scan_site_id);
    if (!cur || r.scan_requested_at > cur) map.set(r.scan_site_id, r.scan_requested_at);
  }
  return map;
}

/**
 * The scans a real run would hand out now, with nothing written. [] when the switch is off. `sites` is the active-client
 * Site list (the only source of a host); `itemKeys` are the keys in the owner's Needs you now.
 */
export async function previewScans(
  db: HomeDb,
  ownerId: string,
  itemKeys: readonly string[],
  sites: readonly SiteHost[],
  now: Date
): Promise<PlannedScan[]> {
  if (!(await loadOutsideScan(db, ownerId))) return [];
  const candidates = await loadCandidates(db, ownerId, itemKeys, now);
  if (candidates.length === 0) return [];
  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const lastRequested = await loadLastRequested(db, ownerId, Array.from(new Set(candidates.map((c) => c.site_id))), now);
  return selectScans({ candidates, sites: siteMap, lastRequested, now });
}

/** Hand out the scans due now and mark each requested (compare and set, so two runs never both get one). Call after trackWatch. */
export async function claimScans(
  db: HomeDb,
  ownerId: string,
  itemKeys: readonly string[],
  sites: readonly SiteHost[],
  now: Date
): Promise<WireScan[]> {
  const planned = await previewScans(db, ownerId, itemKeys, sites, now);
  const out: WireScan[] = [];
  for (const p of planned) {
    const row = await db.homeEmergencyWatch.findUnique({
      where: { user_id_item_key: { user_id: ownerId, item_key: p.key } },
      select: { id: true, scan_requested_at: true },
    });
    if (!row) continue;
    const prev = await db.homeEmergencyWatch.findFirst({
      where: { user_id: ownerId, scan_site_id: p.site_id, scan_at: { not: null }, scan_json: { not: Prisma.DbNull } },
      orderBy: { scan_at: 'desc' },
      select: { scan_json: true },
    });
    const won = await db.homeEmergencyWatch.updateMany({
      where: { id: row.id, user_id: ownerId, scan_requested_at: row.scan_requested_at },
      data: { scan_requested_at: now, scan_site_id: p.site_id },
    });
    if (won.count !== 1) continue;
    out.push({ key: p.key, host: p.host, previous: asRecord(prev?.scan_json) });
  }
  return out;
}

export interface ScanRecorded {
  recorded: boolean;
}

/**
 * Store the machine's result. Ignored (recorded false) when the key was not requested, the request is older than a day, or
 * it was already answered. For a site that answered again, also writes one keeper line, because its row is gone.
 * The caller has checked the summary (scanBodySchema); markup is neutralised here as well.
 */
export async function recordScan(db: PrismaClient, ownerId: string, body: ScanBody, now: Date, timeZone: string): Promise<ScanRecorded> {
  return db.$transaction(async (tx) => {
    const row = await tx.homeEmergencyWatch.findUnique({ where: { user_id_item_key: { user_id: ownerId, item_key: body.key } } });
    const req = row?.scan_requested_at ?? null;
    if (!row || !req) return { recorded: false };
    if (now.getTime() - req.getTime() > SCAN_ANSWER_WINDOW_MS) return { recorded: false };
    if (row.scan_at && row.scan_at.getTime() >= req.getTime()) return { recorded: false };
    const summary = neutraliseSummary(body.summary);
    if (summary === '') return { recorded: false };
    const won = await tx.homeEmergencyWatch.updateMany({
      where: { id: row.id, user_id: ownerId, scan_requested_at: req, OR: [{ scan_at: null }, { scan_at: { lt: req } }] },
      data: { scan_at: now, scan_summary: summary, scan_json: body.findings as Prisma.InputJsonValue },
    });
    if (won.count !== 1) return { recorded: false };
    const siteId = parseSiteItemKey(body.key);
    if (siteId) {
      const site = await tx.site.findUnique({ where: { id: siteId }, select: { url: true } });
      const host = siteHostOf(site?.url);
      if (host) {
        await appendHomeAction(tx, ownerId, {
          item_key: body.key,
          action: SCAN_ACTION,
          source: 'keeper',
          before: null,
          after: { line: outsideCheckHandledLine(host, summary, now, timeZone), details: [host] },
        });
      }
    }
    return { recorded: true };
  });
}

/** The owner's stored results that still belong on a row: the item is in Needs you now and the scan came after it landed. */
export async function loadOutsideChecks(db: HomeDb, ownerId: string): Promise<Array<{ item_key: string; summary: string; at: Date }>> {
  const rows = await db.homeEmergencyWatch.findMany({
    where: { user_id: ownerId, cleared_at: null, scan_at: { not: null }, scan_summary: { not: null } },
    select: { item_key: true, first_seen_at: true, scan_at: true, scan_summary: true },
    take: 100,
  });
  const out: Array<{ item_key: string; summary: string; at: Date }> = [];
  for (const r of rows) {
    if (!r.scan_at || !r.scan_summary || r.scan_at.getTime() < r.first_seen_at.getTime()) continue;
    out.push({ item_key: r.item_key, summary: r.scan_summary, at: r.scan_at });
  }
  return out;
}
