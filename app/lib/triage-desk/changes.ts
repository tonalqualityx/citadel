/**
 * Every change a session makes through the triage-desk lane leaves a mark on the card: an internal note by the Bast user stamped with the lane
 * (Comment.actor_lane = 'triage-desk', set here from the lane, never from a request body), whose text starts "Changed by a session: ". The card
 * payload reads those notes back as `session_changes`, and the card shows "changed by a session". The release tap's revision hook is called
 * from the same place (lib/tasks/triage-rev-hook.ts).
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { bumpTriageRev } from '@/lib/tasks/triage-rev-hook';
import { TRIAGE_DESK_LANE } from './identity';

export const SESSION_CHANGE_PREFIX = 'Changed by a session: ';
export const SESSION_CHANGES_SHOWN = 3;

type Db = Pick<PrismaClient, 'comment'>;

/** One plain line (no line breaks, at most 240 characters). */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function recordSessionChange(userId: string, taskId: string, what: string, db: Db = prisma): Promise<void> {
  const line = oneLine(what);
  await db.comment.create({
    data: { task_id: taskId, user_id: userId, content: `${SESSION_CHANGE_PREFIX}${line}`, mentioned_user_ids: [], is_internal: true, client_visible: false, client_question: false, actor_lane: TRIAGE_DESK_LANE },
  });
  await bumpTriageRev(taskId, 'session', line);
}

export interface SessionChange {
  at: string;
  line: string;
}

/** The newest session changes of these cards, newest first, at most SESSION_CHANGES_SHOWN each. Only notes stamped with the lane count. */
export async function sessionChangesFor(db: Db, taskIds: string[]): Promise<Map<string, SessionChange[]>> {
  const out = new Map<string, SessionChange[]>();
  if (taskIds.length === 0) return out;
  const rows = await db.comment.findMany({
    where: { task_id: { in: taskIds }, is_deleted: false, is_internal: true, actor_lane: TRIAGE_DESK_LANE, content: { startsWith: SESSION_CHANGE_PREFIX } },
    select: { task_id: true, content: true, created_at: true },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  for (const r of rows) {
    const list = out.get(r.task_id) ?? [];
    if (list.length >= SESSION_CHANGES_SHOWN) continue;
    list.push({ at: r.created_at.toISOString(), line: r.content.slice(SESSION_CHANGE_PREFIX.length) });
    out.set(r.task_id, list);
  }
  return out;
}
