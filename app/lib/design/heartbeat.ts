/**
 * Designer Portal: the worker heartbeat (design 7.3, 8.8). Writes the DesignWorkerState singleton including both
 * per-site JSON maps (site_main_roles, site_live_urls), bumps last_heartbeat_at on the listed live sessions and
 * renews their task claims, then runs the D10 timer lapse sweep.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { renewHolder } from '@/lib/tasks/claims';
import { designClaimHolder, isUuid } from './helpers';
import { normalizeMainRole } from './publish-policy';
import { sweepLapsedTimers as sweepLapsed } from './timer';
import { CLAIM_TTL_SECONDS, isTerminalStatus } from './sessions';

export interface HeartbeatInput {
  version?: string;
  sdk_version?: string;
  paused?: boolean;
  pause_reason?: string | null;
  configured_site_ids: string[];
  /** {<site id>: role} (bare strings) */
  site_main_roles?: Record<string, string>;
  /** {<site id>: https url} */
  site_live_urls?: Record<string, string>;
  sessions?: { id: string; alive?: boolean; status?: string }[];
}

/** D10 timer lapse sweep: stops design-timer entries whose presence is older than the lapse, at the last presence. */
export async function sweepLapsedTimers(db: PrismaClient = defaultDb): Promise<void> {
  await sweepLapsed(new Date(), db);
}

export async function recordHeartbeat(input: HeartbeatInput, db: PrismaClient = defaultDb): Promise<{ ok: true; renew_claims: string[] }> {
  const now = new Date();
  const sessions = (input.sessions ?? []).filter((s) => isUuid(s.id));
  const liveCount = sessions.filter((s) => s.alive !== false).length;
  const roles: Record<string, string> = {};
  for (const [id, role] of Object.entries(input.site_main_roles ?? {})) roles[id] = normalizeMainRole(role);
  const urls: Record<string, string> = {};
  for (const [id, url] of Object.entries(input.site_live_urls ?? {})) if (typeof url === 'string') urls[id] = url;

  const data = {
    last_heartbeat_at: now,
    version: input.version ?? null,
    sdk_version: input.sdk_version ?? null,
    paused: input.paused ?? false,
    pause_reason: input.paused ? (input.pause_reason ?? null) : null,
    configured_site_ids: input.configured_site_ids.filter(isUuid),
    site_main_roles: roles,
    site_live_urls: urls,
    live_sessions: liveCount,
  };
  await db.designWorkerState.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });

  const ids = sessions.map((s) => s.id);
  const rows = ids.length
    ? await db.designSession.findMany({ where: { id: { in: ids } }, select: { id: true, task_id: true, status: true } })
    : [];
  const live = rows.filter((r) => !isTerminalStatus(r.status));
  if (live.length > 0) {
    await db.designSession.updateMany({ where: { id: { in: live.map((r) => r.id) } }, data: { last_heartbeat_at: now } });
  }
  const renew: string[] = [];
  for (const r of live) {
    const n = await renewHolder({ holder: designClaimHolder(r.task_id), ttlSeconds: CLAIM_TTL_SECONDS }, db);
    if (n > 0) renew.push(r.task_id);
  }
  await sweepLapsedTimers(db);
  return { ok: true, renew_claims: renew };
}
