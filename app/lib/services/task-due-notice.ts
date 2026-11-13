/**
 * The day-before notice (Dox, PLAN addendum 2 item 3): once per task, one day before its due date, the assignee is told through createNotification.
 *
 * Who is told: a staff user (an active user, never a client contact, since clients are never users) who is not a bot and is not the owner (his
 * own tasks are his list, not a notice). Which task: open (not_started, in_progress, review or blocked; never Triage, done or abandoned), on a live
 * project (ready, in_progress, review) or on none. When: the due date's calendar day is tomorrow's date in the assignee's time zone (the picked day is stored as midnight UTC and is read as that calendar day, never shifted
 * into a zone; a due date carrying a real time of day is read in the zone: lib/services/due-day.ts). How often: once for
 * a given due date. The due date that was announced is kept on the task (due_notice_for), claimed with a conditional write before the notice goes
 * out, so two runs at the same time, or a run every hour, never tell twice; a task whose due date moves is told again for the new date.
 */
import { prisma } from '@/lib/db/prisma';
import { BOT_USER_IDS, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { resolveUserTimezone } from '@/lib/services/user-timezone';
import { getZonedDateString } from '@/lib/utils/time';
import { dueDay } from '@/lib/services/due-day';
import { notifyTaskDueSoon } from '@/lib/services/notifications';

export const DUE_NOTICE_OPEN_STATUSES = ['not_started', 'in_progress', 'review', 'blocked'] as const;
export const DUE_NOTICE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;
const HOUR_MS = 3600 * 1000;

/** The calendar day after `now` in the zone, YYYY-MM-DD. */
export function tomorrowIn(now: Date, zone: string): string {
  // Noon of today's zoned date plus 24 hours is tomorrow's date in the zone, whatever the offset changes (DST) in between.
  const today = getZonedDateString(now, zone);
  return getZonedDateString(new Date(new Date(`${today}T12:00:00Z`).getTime() + 24 * HOUR_MS), 'UTC');
}

/** True when the due date's calendar day is tomorrow's date in the zone. */
export function isDayBefore(due: Date, now: Date, zone: string): boolean {
  return dueDay(due, zone) === tomorrowIn(now, zone);
}

export interface DueNoticeResult {
  tasksChecked: number;
  notificationsSent: number;
}

export async function runTaskDueNotices(now: Date = new Date()): Promise<DueNoticeResult> {
  // Candidates: a window wide enough for every zone's "tomorrow" (a midnight-UTC due date can sit 24 hours behind now, or 48 ahead); the day check below decides.
  const from = new Date(now.getTime() - 36 * HOUR_MS);
  const to = new Date(now.getTime() + 60 * HOUR_MS);
  const candidates = await prisma.task.findMany({
    where: {
      is_deleted: false,
      status: { in: [...DUE_NOTICE_OPEN_STATUSES] },
      assignee_id: { not: null, notIn: [MIKE_USER_ID, ...BOT_USER_IDS] },
      assignee: { is: { is_active: true } },
      due_date: { gte: from, lte: to },
      OR: [{ project_id: null }, { project: { is: { is_deleted: false, status: { in: [...DUE_NOTICE_PROJECT_STATUSES] } } } }],
    },
    select: { id: true, assignee_id: true, due_date: true, due_notice_for: true },
    orderBy: { due_date: 'asc' },
    take: 2000,
  });

  const zones = new Map<string, string>();
  let sent = 0;
  for (const t of candidates) {
    const due = t.due_date;
    const assignee = t.assignee_id;
    if (!due || !assignee) continue;
    if (t.due_notice_for && t.due_notice_for.getTime() === due.getTime()) continue;
    let zone = zones.get(assignee);
    if (!zone) {
      zone = await resolveUserTimezone(assignee);
      zones.set(assignee, zone);
    }
    if (!isDayBefore(due, now, zone)) continue;
    // Claim this due date first: only the run that flips the marker sends. A failed send gives the claim back, so the next run tries again.
    const claim = await prisma.task.updateMany({
      where: { id: t.id, due_date: due, OR: [{ due_notice_for: null }, { due_notice_for: { not: due } }] },
      data: { due_notice_for: due },
    });
    if (claim.count !== 1) continue;
    try {
      await notifyTaskDueSoon(t.id, assignee);
      sent++;
    } catch (error) {
      await prisma.task.updateMany({ where: { id: t.id, due_notice_for: due }, data: { due_notice_for: t.due_notice_for } });
      console.error('task-due-soon: notice failed for task', t.id, error);
    }
  }
  return { tasksChecked: candidates.length, notificationsSent: sent };
}
