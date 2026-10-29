/**
 * Designer Portal D10 hook. Called by GET /api/design/sessions/:id (workspace open, visible = true) and GET .../feed
 * (visible from `?visible=1|0`). The timer belongs to the session's own user only; anyone else (a pm, another
 * admin) gets null, which the feed projects as {running:false, elapsed_s:0}.
 */
import type { DesignSession } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { DesignActor } from './helpers';
import { ensureTimer, observeTimer, sweepLapsedTimers, type TimerView } from './timer';

export type { TimerView };

/** The daemon sweeps on every heartbeat (10 s); if it has been silent this long, any feed request sweeps. */
export const HEARTBEAT_STALE_MS = 30_000;

export async function onPresence(
  session: Pick<DesignSession, 'id' | 'designer_id' | 'task_id' | 'site_id'>,
  visible: boolean,
  actor?: Pick<DesignActor, 'userId' | 'role'>,
): Promise<TimerView | null> {
  const now = new Date();
  const state = await prisma.designWorkerState.findUnique({ where: { id: 1 }, select: { last_heartbeat_at: true } });
  if (!state?.last_heartbeat_at || now.getTime() - state.last_heartbeat_at.getTime() > HEARTBEAT_STALE_MS) {
    await sweepLapsedTimers(now);
  }
  return visible ? ensureTimer(session, actor, now) : observeTimer(session, actor, now);
}
