/**
 * The three Work-mode blocks and the ritual's feed (specs/citadel-shape-SPEC.md 4.2 and 4.3).
 *
 *   Blocking today  waits on Mike that block a client, due today or earlier. Project approvals
 *                   first, then the longest client wait. Five rows, then "and N more".
 *   Due this week   Mike's other waits and his tasks due in the next 7 days, by date. Seven rows.
 *   Admin           the existing admin-soon filter, five rows, so admin and ad-hoc work never
 *                   competes with client rows.
 *
 * Nothing here reads the focus flag. Pure functions over plain rows: the Prisma loader is
 * lib/waits/load-blocks.ts, and the Work view and GET /api/waits/mine render the same output.
 */

import { businessDaysLate, calendarDaysSince, endOfZonedDay } from './business-days';

export const BLOCKING_CAP = 5;
export const DUE_WEEK_CAP = 7;
export const ADMIN_CAP = 5;
export const DUE_WINDOW_DAYS = 7;
/** How many overflow rows ride along so "and N more" can expand without another request. */
export const OVERFLOW_ROWS = 50;

/** A wait resolved to its owner, as the loader hands it over. */
export interface WaitCandidate {
  id: string;
  kind: string;
  state: string;
  title: string;
  due_at: Date;
  blocks_client: boolean;
  client_waiting_since: Date | null;
  nag_level: number;
  project_id: string | null;
  task_id: string | null;
  approval_request_id: string | null;
  client: { id: string; name: string } | null;
  /** The user who must act, from lib/waits/owner.ts. */
  resolved_user_id: string;
}

export interface TaskCandidate {
  id: string;
  title: string;
  due_date: Date;
  promised_to: string | null;
  client: { id: string; name: string } | null;
}

export interface AdminCandidate {
  id: string;
  title: string;
  due_date: string | null;
  client: { id: string; name: string } | null;
}

export type RowAction =
  | { type: 'task'; id: string }
  | { type: 'approval'; id: string }
  | { type: 'project'; id: string }
  | { type: 'wait'; id: string };

export interface BlockingRow {
  id: string;
  title: string;
  kind: string;
  state: string;
  client: { id: string; name: string } | null;
  project_id: string | null;
  due_at: string;
  client_waiting_since: string | null;
  /** Whole days the client has waited, from client_waiting_since. */
  waiting_days: number | null;
  nag_level: number;
  business_days_late: number;
  /** "waiting 8 days", or at level 3 "SAPCC has heard nothing for 8 days". */
  label: string;
  countdown: boolean;
  is_project_approval: boolean;
  action: RowAction;
}

export interface DueRow {
  id: string;
  type: 'wait' | 'task';
  title: string;
  due_at: string;
  client: { id: string; name: string } | null;
  state: string | null;
  action: RowAction;
}

export interface AdminRow {
  id: string;
  title: string;
  due_date: string | null;
  client: { id: string; name: string } | null;
}

export interface RitualBlocks {
  blocking_today: { rows: BlockingRow[]; more: number; total: number; overflow: BlockingRow[] };
  due_this_week: { rows: DueRow[]; more: number; total: number };
  admin: { rows: AdminRow[]; more: number; total: number };
  generated_at: string;
}

const BLOCKING_STATES = ['waiting', 'needs_human', 'blocked_by_switch'];
const MS_DAY = 86_400_000;

export function actionFor(w: Pick<WaitCandidate, 'id' | 'task_id' | 'approval_request_id' | 'project_id'>): RowAction {
  if (w.task_id) return { type: 'task', id: w.task_id };
  if (w.approval_request_id) return { type: 'approval', id: w.approval_request_id };
  if (w.project_id) return { type: 'project', id: w.project_id };
  return { type: 'wait', id: w.id };
}

function blockingRow(w: WaitCandidate, now: Date): BlockingRow {
  const since = w.client_waiting_since;
  const days = since ? calendarDaysSince(since, now) : null;
  const late = businessDaysLate(w.due_at, now);
  const countdown = w.nag_level >= 3 && days != null;
  const who = w.client?.name ?? 'The client';
  const label =
    days == null
      ? 'waiting'
      : countdown
        ? `${who} has heard nothing for ${days} ${days === 1 ? 'day' : 'days'}`
        : `waiting ${days} ${days === 1 ? 'day' : 'days'}`;
  return {
    id: w.id,
    title: w.title,
    kind: w.kind,
    state: w.state,
    client: w.client,
    project_id: w.project_id,
    due_at: w.due_at.toISOString(),
    client_waiting_since: since ? since.toISOString() : null,
    waiting_days: days,
    nag_level: w.nag_level,
    business_days_late: late,
    label,
    countdown,
    is_project_approval: w.kind === 'approval' && !!w.project_id,
    action: actionFor(w),
  };
}

/**
 * Blocking today. Project approvals first, then the oldest client_waiting_since (a missing
 * date sorts last), then the earliest due date, then the title so ties never shuffle.
 */
export function selectBlockingToday(waits: WaitCandidate[], mikeId: string, now: Date) {
  const endOfToday = endOfZonedDay(now).getTime();
  const picked = waits
    .filter(
      (w) =>
        w.resolved_user_id === mikeId &&
        w.blocks_client &&
        BLOCKING_STATES.includes(w.state) &&
        w.due_at.getTime() <= endOfToday
    )
    .sort((a, b) => {
      const pa = a.kind === 'approval' && a.project_id ? 0 : 1;
      const pb = b.kind === 'approval' && b.project_id ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const sa = a.client_waiting_since?.getTime() ?? Infinity;
      const sb = b.client_waiting_since?.getTime() ?? Infinity;
      if (sa !== sb) return sa - sb;
      const da = a.due_at.getTime() - b.due_at.getTime();
      if (da !== 0) return da;
      return a.title.localeCompare(b.title);
    });
  const rows = picked.slice(0, BLOCKING_CAP).map((w) => blockingRow(w, now));
  const overflow = picked.slice(BLOCKING_CAP, BLOCKING_CAP + OVERFLOW_ROWS).map((w) => blockingRow(w, now));
  return { rows, more: Math.max(0, picked.length - BLOCKING_CAP), total: picked.length, overflow, pickedIds: new Set(picked.map((w) => w.id)) };
}

/**
 * Due this week: Mike's waits that are not in Blocking today, due within 7 days, plus his tasks
 * due in that window, by date. A task a shown wait points at appears once, as the wait.
 */
export function selectDueThisWeek(
  waits: WaitCandidate[],
  tasks: TaskCandidate[],
  mikeId: string,
  now: Date,
  blockingIds: Set<string>
) {
  const limit = endOfZonedDay(new Date(now.getTime() + DUE_WINDOW_DAYS * MS_DAY)).getTime();
  const mine = waits.filter(
    (w) =>
      w.resolved_user_id === mikeId &&
      ['waiting', 'needs_human', 'blocked_by_switch'].includes(w.state) &&
      !blockingIds.has(w.id) &&
      w.due_at.getTime() <= limit
  );
  const taskIdsWithWait = new Set(
    waits.filter((w) => w.resolved_user_id === mikeId && w.task_id).map((w) => w.task_id as string)
  );
  const rows: DueRow[] = [
    ...mine.map<DueRow>((w) => ({
      id: w.id,
      type: 'wait',
      title: w.title,
      due_at: w.due_at.toISOString(),
      client: w.client,
      state: w.state,
      action: actionFor(w),
    })),
    ...tasks
      .filter((t) => t.due_date.getTime() <= limit && !taskIdsWithWait.has(t.id))
      .map<DueRow>((t) => ({
        id: t.id,
        type: 'task',
        title: t.title,
        due_at: t.due_date.toISOString(),
        client: t.client,
        state: null,
        action: { type: 'task', id: t.id },
      })),
  ].sort((a, b) => a.due_at.localeCompare(b.due_at) || a.title.localeCompare(b.title));
  return { rows: rows.slice(0, DUE_WEEK_CAP), more: Math.max(0, rows.length - DUE_WEEK_CAP), total: rows.length };
}

export function selectAdmin(admin: AdminCandidate[]) {
  return {
    rows: admin.slice(0, ADMIN_CAP).map<AdminRow>((t) => ({ id: t.id, title: t.title, due_date: t.due_date, client: t.client })),
    more: Math.max(0, admin.length - ADMIN_CAP),
    total: admin.length,
  };
}

export function buildRitualBlocks(input: {
  waits: WaitCandidate[];
  tasks: TaskCandidate[];
  admin: AdminCandidate[];
  mikeId: string;
  now: Date;
}): RitualBlocks {
  const blocking = selectBlockingToday(input.waits, input.mikeId, input.now);
  return {
    blocking_today: { rows: blocking.rows, more: blocking.more, total: blocking.total, overflow: blocking.overflow },
    due_this_week: selectDueThisWeek(input.waits, input.tasks, input.mikeId, input.now, blocking.pickedIds),
    admin: selectAdmin(input.admin),
    generated_at: input.now.toISOString(),
  };
}

/** The ritual's overview line: "5 blocking a client, 3 more behind them". Never lists them all. */
export function blockingSummary(b: RitualBlocks['blocking_today']): string {
  if (b.total === 0) return 'Nothing is blocking a client today.';
  const shown = b.rows.length;
  return b.more > 0
    ? `${shown} blocking a client, ${b.more} more behind them.`
    : `${shown} blocking a client.`;
}
