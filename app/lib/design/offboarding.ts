/**
 * Designer Portal: what happens to a designer's live sessions when she is taken off a project (W8.2 H2).
 *
 * Her access ends at once without this module: every design path checks a CURRENT ProjectTeamAssignment
 * (access.ts currentSessionAccess). This closes the sessions themselves, so the worker stops spending, the
 * task claim is released and the box removes the worktree:
 *  - a system `status` event in the session's chat says why;
 *  - an unconfirmed publish intent (awaiting_confirmation) expires, so its token is dead;
 *  - the automatic timer stops;
 *  - a DesignCommand(close) goes to the daemon (it ends the live query and removes the worktree; the branch is kept);
 *  - from awaiting_input, paused_budget or stopped the session moves to closed or abandoned (by publish
 *    history) through closeSession(), the same legal-table move the close route makes when the daemon is
 *    offline, which releases the claim.
 * Sessions in other states are left to the daemon's close: `pending` and `active` (a turn is running; the
 * table has no server move to a terminal state from there) and `publishing` (a confirmed publish is running;
 * the daemon refuses a close then, so no command is written). She cannot reach any of them either way.
 *
 * Nothing happens while the user is still on the project through another function, or when she is not a
 * designer (an admin's sessions do not depend on the team).
 */
import type { DesignSessionStatus, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { designerOnProject } from './access';
import { createCommand } from './commands';
import { unshareForUnassignedDesigner } from './drive-share';
import { appendWorkerEvents } from './events';
import { isUuid } from './helpers';
import { closeSession } from './sessions';
import { stopTimer } from './timer';

const CLOSABLE_NOW: readonly DesignSessionStatus[] = ['awaiting_input', 'paused_budget', 'stopped'];
export const UNASSIGNED_CLOSE_TEXT = 'You were removed from this project, so this session was closed.';

export interface UnassignResult {
  /** Sessions moved to closed or abandoned now. */
  closed: string[];
  /** Sessions left for the daemon (pending, active, publishing). */
  left_to_worker: string[];
}

export async function closeSessionsForUnassignedDesigner(
  projectId: string,
  userId: string,
  opts: { byUserId: string },
  db: PrismaClient = defaultDb,
): Promise<UnassignResult> {
  const result: UnassignResult = { closed: [], left_to_worker: [] };
  if (!isUuid(projectId) || !isUuid(userId)) return result;
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== 'designer') return result;
  if (await designerOnProject(userId, projectId, db)) return result;
  // D11: take her off the project's Drive folder too (unless another of her projects still uses it).
  await unshareForUnassignedDesigner(projectId, userId, opts.byUserId, db);

  const live = await db.designSession.findMany({
    where: { project_id: projectId, designer_id: userId, status: { notIn: ['closed', 'abandoned'] } },
    orderBy: { created_at: 'asc' },
  });
  for (const session of live) {
    await appendWorkerEvents(session.id, { events: [{ role: 'system', kind: 'status', payload: { text: UNASSIGNED_CLOSE_TEXT, reason: 'designer_unassigned' } }] }, db);
    await db.designPublish.updateMany({
      where: { session_id: session.id, status: 'awaiting_confirmation' },
      data: { status: 'expired', confirmation_token_hash: null },
    });
    await stopTimer(session, db);
    if (session.status === 'publishing') {
      result.left_to_worker.push(session.id);
      continue;
    }
    await createCommand({ sessionId: session.id, verb: 'close', payload: { reason: 'designer_unassigned' }, createdById: opts.byUserId }, db);
    if (CLOSABLE_NOW.includes(session.status)) {
      try {
        await closeSession(session.id, db);
        result.closed.push(session.id);
      } catch {
        // Moved under us (the worker started a turn): the queued close command finishes it.
        result.left_to_worker.push(session.id);
      }
    } else {
      result.left_to_worker.push(session.id);
    }
  }
  return result;
}
