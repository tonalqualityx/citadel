/**
 * triage_rev: a per-card revision number that goes up on every change the owner should see before releasing (kind, linked project, shape,
 * sitemap, dates, questions added, withdrawn or settled, and every plan write). It is part of release_version, so a Release tap after an
 * unseen change is refused with 409 card_changed and a short "what changed" line built from the last change lines kept here.
 * Once a card has left Triage the number stops moving (nothing is waiting on a tap) but the change line is still kept: the plan header
 * reads "when it last changed and by whom" from it.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import type { AuthPayload } from '@/lib/auth/middleware';

type Db = PrismaClient | Prisma.TransactionClient;
type ActorAuth = Pick<AuthPayload, 'userId' | 'via' | 'lane' | 'laneEnforced'>;

export interface Actor {
  /** How the line names who did it: "Mike", "the chat", "Dox", "a session", or a name. */
  by: string;
  userId: string | null;
  lane: string | null;
}

/** Who made this call, in words a card line can carry. */
export async function actorOf(auth: ActorAuth, db: Pick<PrismaClient, 'user'> = prisma): Promise<Actor> {
  const lane = auth.lane ? auth.lane.slice(0, 40) : null;
  const base = { userId: auth.userId ?? null, lane };
  if (auth.via === 'session') {
    if (auth.userId === MIKE_USER_ID) return { ...base, by: 'Mike' };
    const u = await db.user.findUnique({ where: { id: auth.userId }, select: { name: true } }).catch(() => null);
    return { ...base, by: (u?.name || 'a team member').slice(0, 60) };
  }
  if (lane) {
    const names = lane.split(',').map((l) => l.trim());
    if (names.includes('bast-chat')) return { ...base, by: 'the chat' };
    if (names.includes('dox')) return { ...base, by: 'Dox' };
    if (names.includes('bast')) return { ...base, by: 'a worker session' };
    return { ...base, by: `the ${names[0]} lane`.slice(0, 60) };
  }
  return { ...base, by: auth.userId === MIKE_USER_ID ? 'Mike' : 'a session' };
}

export const CHANGE_LINES_SHOWN = 3;

/**
 * Record one change on a card. Inside the caller's transaction when it has one. Bumps triage_rev only while the card is in Triage.
 * Returns the card's rev after the change.
 */
export async function recordTriageChange(db: Db, taskId: string, area: string, line: string, actor: Actor, note?: string | null): Promise<number> {
  await db.task.updateMany({ where: { id: taskId, status: 'triage' }, data: { triage_rev: { increment: 1 } } });
  const t = await db.task.findUnique({ where: { id: taskId }, select: { triage_rev: true } });
  const rev = t?.triage_rev ?? 0;
  await db.triageChange.create({
    data: { task_id: taskId, rev, area: area.slice(0, 40), line: line.slice(0, 240), note: note ? note.slice(0, 240) : null, by: actor.by.slice(0, 60), by_user_id: actor.userId, by_lane: actor.lane },
  });
  return rev;
}

export interface ChangeLine {
  line: string;
  at: string;
}

/** The last few change lines of each card, newest first. One query for any number of cards. */
export async function recentChanges(db: Pick<PrismaClient, '$queryRaw'>, taskIds: string[], n: number = CHANGE_LINES_SHOWN): Promise<Map<string, ChangeLine[]>> {
  const out = new Map<string, ChangeLine[]>();
  if (taskIds.length === 0) return out;
  const rows = await db.$queryRaw<{ task_id: string; line: string; created_at: Date }[]>`
    SELECT task_id::text AS task_id, line, created_at FROM (
      SELECT task_id, line, created_at, row_number() OVER (PARTITION BY task_id ORDER BY created_at DESC, id DESC) AS rn
      FROM triage_changes WHERE task_id = ANY(${taskIds}::uuid[])
    ) x WHERE rn <= ${n}::int ORDER BY created_at DESC`;
  for (const r of rows) out.set(r.task_id, [...(out.get(r.task_id) ?? []), { line: r.line, at: r.created_at.toISOString() }]);
  return out;
}

/** The short "what changed" sentence for a refused Release: the last change lines, distinct, joined. '' when nothing was recorded. */
export function whatChanged(lines: ChangeLine[]): string {
  const seen: string[] = [];
  for (const l of lines) if (!seen.includes(l.line)) seen.push(l.line);
  return seen.join('; ');
}
