/**
 * Home Slice 9a: the only writer of a TimeEntry from the sent-mail cards. It is called only from POST /api/home/reconcile (session only),
 * so no automatic path and no chat call can reach it. Nothing is added to the table: the entry says in its description that it is an
 * estimate logged after the fact. Undo is a soft delete (is_deleted true) that holds only while duration and started_at are unchanged.
 */
import type { PrismaClient } from '@prisma/client';
import { shortDay } from './copy';
import { clampMinutes } from './estimate';
import { zonedToUtc } from '../act';

export const TIME_DESCRIPTION = (sent: Date, zone?: string): string => `Estimated, logged after the fact from your email of ${shortDay(sent, zone)}.`;

export interface TimeEntryInput {
  user_id: string;
  task_id: string;
  project_id: string | null;
  /** The send time of his email: the entry ends then (Track it) or on the end of that day (Log time). */
  ended_at: Date;
  minutes: number;
  billable: boolean;
  sent: Date;
  timezone: string;
}

/** Creates the one entry. `db` is a transaction client. */
export async function createEstimatedEntry(db: PrismaClient, a: TimeEntryInput): Promise<{ id: string; started_at: Date; duration: number }> {
  const minutes = Math.max(1, Math.min(1440, Math.round(a.minutes)));
  const started = new Date(a.ended_at.getTime() - minutes * 60000);
  const row = await db.timeEntry.create({
    data: {
      user_id: a.user_id,
      task_id: a.task_id,
      project_id: a.project_id,
      started_at: started,
      ended_at: a.ended_at,
      duration: minutes,
      is_running: false,
      description: TIME_DESCRIPTION(a.sent, a.timezone),
      is_billable: a.billable,
      hourly_rate: null,
    },
    select: { id: true, started_at: true, duration: true },
  });
  return row;
}

export interface LogTimeResult {
  action_id: string;
  undo_until: string;
  message: string;
}

/** The end of a day his email was sent on: 17:00 his time, but never in the future. */
export function endOfEmailDay(day: string, now: Date, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const five = zonedToUtc(y, m, d, 17, 0, timezone);
  return five.getTime() > now.getTime() ? now : five;
}

export { clampMinutes };
