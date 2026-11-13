/**
 * "Overdue by others" (Dox, PLAN addendum 2 item 3): the owner's list of open work that someone else is late on. A list he looks at, not an
 * alert: nothing here creates a notification, and Dox raises no question about it.
 *
 * A row is an open task (not_started, in_progress, review or blocked; never Triage, done or abandoned) that
 *   - is assigned to a person other than the owner (never a bot user, never nobody), and
 *   - is late by a full day: its due day (the picked day, stored as midnight UTC and read as that calendar day, lib/services/due-day.ts) is two or more
 *     days before today's date in the owner's zone, so it first appears at the start of the second day after its due day, and
 *   - sits on a live project (ready, in_progress or review) or on no project at all.
 * Most overdue first. Only the owner gets the section; everyone else gets null.
 */
import type { HomeDb } from './state';
import type { HomePastDateOthers, HomePastDateRow } from './types';
import { BOT_USER_IDS, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { DEFAULT_DISPLAY_TIMEZONE } from '@/lib/timezone';
import { dueDay, daysBetween } from '@/lib/services/due-day';
import { getZonedDateString } from '@/lib/utils/time';

/** A task shows from the start of the second day after its due day: today's date minus the due day is at least this many days. */
export const OVERDUE_MIN_DAYS = 2;
const CANDIDATES_MAX = 2000;
export const LIVE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
export const OVERDUE_OPEN_STATUSES = ['not_started', 'in_progress', 'review', 'blocked'] as const;
const ROWS_MAX = 200;

export function isOverdueOwner(userId: string): boolean {
  return userId === MIKE_USER_ID;
}

/** Whole calendar days between the due day and today's date in the zone. */
export function daysOverdue(due: Date, now: Date, zone: string = DEFAULT_DISPLAY_TIMEZONE): number {
  return daysBetween(dueDay(due, zone), getZonedDateString(now, zone));
}

export async function loadOverdueByOthers(db: HomeDb, userId: string, now: Date = new Date(), zone: string = DEFAULT_DISPLAY_TIMEZONE): Promise<HomePastDateOthers | null> {
  if (!isOverdueOwner(userId)) return null;
  const where = {
    is_deleted: false,
    status: { in: [...OVERDUE_OPEN_STATUSES] },
    assignee_id: { not: null, notIn: [MIKE_USER_ID, ...BOT_USER_IDS] },
    // Loose pre-filter in the database (anything not in the future); the calendar-day test below decides.
    due_date: { lt: now },
    OR: [{ project_id: null }, { project: { is: { is_deleted: false, status: { in: [...LIVE_PROJECT_STATUSES] } } } }],
  } as const;
  const found = (await db.task.findMany({
    where: where as never,
    orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
    take: CANDIDATES_MAX,
    select: {
      id: true,
      title: true,
      due_date: true,
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
  })) as unknown as { id: string; title: string; due_date: Date; assignee: { id: string; name: string } | null; project: { id: string; name: string } | null }[];
  const late = found
    .map((t) => ({ t, days: daysOverdue(t.due_date, now, zone) }))
    .filter((x) => x.days >= OVERDUE_MIN_DAYS)
    .sort((a, b) => b.days - a.days || a.t.due_date.getTime() - b.t.due_date.getTime() || (a.t.id < b.t.id ? -1 : 1));
  const out: HomePastDateRow[] = late.slice(0, ROWS_MAX).map(({ t, days }) => ({
    task_id: t.id,
    title: t.title,
    href: `/tasks/${t.id}`,
    who: t.assignee?.name ?? 'Unassigned',
    who_id: t.assignee?.id ?? null,
    project_id: t.project?.id ?? null,
    project_name: t.project?.name ?? null,
    due_date: t.due_date.toISOString(),
    days_past: days,
  }));
  return { count: late.length, rows: out };
}
