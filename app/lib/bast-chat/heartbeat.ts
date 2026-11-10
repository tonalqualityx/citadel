/**
 * Bast chat: the daemon heartbeat and the worker status the panel reads.
 *
 * `recordHeartbeat` writes the BastChatWorkerState singleton, then marks stale waiting messages expired and
 * closes conversations idle for 4 hours. It runs no purge: nothing is deleted.
 * Offline means no heartbeat for 45 seconds.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { cleanLine } from './card-context';
import { closeIdleConversations } from './events';
import { expireStaleMessages } from './inbox';
import { getSettings } from './settings';

export const OFFLINE_AFTER_SECONDS = 45;

/** Matches HeartbeatBody in the machine's types.ts. */
export const heartbeatSchema = z.object({
  version: z.string().max(40),
  sdk_version: z.string().max(40),
  paused: z.boolean(),
  pause_reason: z.string().max(200).optional(),
  live_conversations: z.array(z.object({ id: z.string().uuid(), alive: z.boolean(), status: z.string().max(20).optional() })).max(50),
  isolation: z.object({ ok: z.boolean(), at: z.string().max(40).optional() }).nullable(),
  auth_state: z.enum(['token', 'login', 'failed']),
});
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

export async function recordHeartbeat(input: HeartbeatInput, now: Date = new Date(), db: PrismaClient = defaultDb): Promise<{ ok: true }> {
  const live = input.live_conversations.filter((c) => c.alive).length;
  const data = {
    last_heartbeat_at: now,
    version: input.version,
    sdk_version: input.sdk_version,
    paused: input.paused,
    pause_reason: input.paused && input.pause_reason ? cleanLine(input.pause_reason, 100) : null,
    auth_state: input.auth_state,
    live_conversations: live,
    isolation_ok_at: input.isolation?.ok ? now : null,
  };
  await db.bastChatWorkerState.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  const settings = await getSettings(db);
  await expireStaleMessages(settings.stale_after_minutes, now, db);
  await closeIdleConversations(now, db);
  return { ok: true };
}

export interface WorkerStatus {
  online: boolean;
  paused: boolean;
  pause_reason: string | null;
  auth_state: 'token' | 'login' | 'failed' | null;
  isolation_ok: boolean;
  live_conversations: number;
  last_heartbeat_at: Date | null;
}

export async function workerStatus(now: Date = new Date(), db: Pick<PrismaClient, 'bastChatWorkerState'> = defaultDb): Promise<WorkerStatus> {
  const r = await db.bastChatWorkerState.findUnique({ where: { id: 1 } });
  const last = r?.last_heartbeat_at ?? null;
  const auth = r?.auth_state;
  const online = !!last && now.getTime() - last.getTime() <= OFFLINE_AFTER_SECONDS * 1000;
  return {
    online,
    // A stopped machine is offline, not paused (its last heartbeat said paused on a clean stop).
    paused: online && (r?.paused ?? false),
    pause_reason: online ? (r?.pause_reason ?? null) : null,
    auth_state: auth === 'token' || auth === 'login' || auth === 'failed' ? auth : null,
    isolation_ok: !!r?.isolation_ok_at,
    live_conversations: r?.live_conversations ?? 0,
    last_heartbeat_at: last,
  };
}
