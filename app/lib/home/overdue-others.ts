/**
 * "Overdue by others" (Dox, PLAN addendum 2 item 3): the owner's list of open work that someone else is late on. A list he looks at, not an
 * alert: nothing here creates a notification, and Dox raises no question about it.
 *
 * A row is an open task (not_started, in_progress, review or blocked; never Triage, done or abandoned) that
 *   - is assigned to a person other than the owner (never a bot user, never nobody), and
 *   - has a due date more than one day in the past (a one-day grace: due_date older than 24 hours), and
 *   - sits on a live project (ready, in_progress or review) or on no project at all.
 * Most overdue first. Only the owner gets the section; everyone else gets null.
 */
import type { HomeDb } from './state';
import type { HomeOverdueOthers, HomeOverdueRow } from './types';
import { BOT_USER_IDS, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

export const OVERDUE_GRACE_MS = 24 * 3600 * 1000;
export const LIVE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
export const OVERDUE_OPEN_STATUSES = ['not_started', 'in_progress', 'review', 'blocked'] as const;
const ROWS_MAX = 200;
const DAY_MS = 24 * 3600 * 1000;

export function isOverdueOwner(userId: string): boolean {
  return userId === MIKE_USER_ID;
}

export function daysOverdue(due: Date, now: Date): number {
  return Math.floor((now.getTime() - due.getTime()) / DAY_MS);
}

export async function loadOverdueByOthers(db: HomeDb, userId: string, now: Date = new Date()): Promise<HomeOverdueOthers | null> {
  if (!isOverdueOwner(userId)) return null;
  const cutoff = new Date(now.getTime() - OVERDUE_GRACE_MS);
  const where = {
    is_deleted: false,
    status: { in: [...OVERDUE_OPEN_STATUSES] },
    assignee_id: { not: null, notIn: [MIKE_USER_ID, ...BOT_USER_IDS] },
    due_date: { lt: cutoff },
    OR: [{ project_id: null }, { project: { is: { is_deleted: false, status: { in: [...LIVE_PROJECT_STATUSES] } } } }],
  } as const;
  const [count, rows] = await Promise.all([
    db.task.count({ where: where as never }),
    db.task.findMany({
      where: where as never,
      orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
      take: ROWS_MAX,
      select: {
        id: true,
        title: true,
        due_date: true,
        assignee: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
  ]);
  const out: HomeOverdueRow[] = (rows as unknown as { id: string; title: string; due_date: Date; assignee: { id: string; name: string } | null; project: { id: string; name: string } | null }[]).map((t) => ({
    task_id: t.id,
    title: t.title,
    href: `/tasks/${t.id}`,
    who: t.assignee?.name ?? 'Unassigned',
    who_id: t.assignee?.id ?? null,
    project_id: t.project?.id ?? null,
    project_name: t.project?.name ?? null,
    due_date: t.due_date.toISOString(),
    days_overdue: daysOverdue(t.due_date, now),
  }));
  return { count, rows: out };
}
