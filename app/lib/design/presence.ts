/**
 * Designer Portal D10 hook. W2.7 (timer) fills this in; until then it is a no-op so the routes can call it.
 *
 * Called by GET /api/design/sessions/:id (workspace open, visible = true) and GET .../feed (visible from
 * `?visible=1|0`). `actor` is passed so the timer can honour "the session's own user only". The return
 * value feeds the feed's `timer` projection: null means "no timer" ({running:false, elapsed_s:0}).
 */
import type { DesignSession } from '@prisma/client';
import type { DesignActor } from './helpers';

export interface TimerView {
  running: boolean;
  elapsed_s: number;
}

// TODO(W2.7): start/resume/keep alive the automatic timer here and return its view.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function onPresence(
  _session: Pick<DesignSession, 'id' | 'designer_id' | 'task_id' | 'site_id' | 'timer_presence_at'>,
  _visible: boolean,
  _actor?: Pick<DesignActor, 'userId' | 'role'>,
): Promise<TimerView | null> {
  return null;
}
